// ============================================================
//  POST /api/chat — the main brain: you send a message, NEXUS answers
// ============================================================
//  Steps:
//   1. prepare: save your message, profile + memories + tools
//   2. ask the best model; if it fails, try the next one (fallback)
//   3. stream the answer back word by word

import { json } from "../../lib/db.js";
import { planRoute } from "../../lib/router.js";
import { callModel } from "../../lib/providers.js";
import { prepare, infoHeaders } from "../../lib/prepare.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, model, tools } = await context.request.json();
  // messages = [{role:"user", content:"..."}, {role:"assistant", ...}, ...]

  const plan = planRoute(env, messages, model);
  if (plan.length === 0) return json({ error: "No API keys found. Add keys to .dev.vars (see SETUP.md)." }, 400);

  // 1. Save message + build instructions (tools are on unless the browser says false)
  const prep = await prepare(env, chatId, messages, tools !== false);

  // 2. Try models one by one until one answers
  const errors = [];
  const skip = new Set();   // providers whose key is wrong or limit is reached
  for (const step of plan) {
    if (skip.has(step.provider.id)) continue;
    try {
      const res = await callModel(env, step.provider, step.model, prep.fullMessages, true);
      if (res.ok) {
        // 3. Pass the stream straight to your browser (no extra work here = fast + free)
        return new Response(res.body, { headers: infoHeaders(step.provider.name + " · " + step.model, prep) });
      }
      errors.push(step.provider.name + " " + step.model + ": " + res.status);
      // 401/403 = bad key, 429 = daily limit → other models of this provider will fail too
      if ([401, 403, 429].includes(res.status)) skip.add(step.provider.id);
    } catch (e) {
      errors.push(step.provider.name + ": " + e.message);
      skip.add(step.provider.id);   // timeout / network down
    }
  }
  return json({ error: "All models failed", details: errors }, 502);
}
