// ============================================================
//  POST /api/chat — the main brain: you send a message, NEXUS answers
// ============================================================
//  Steps:
//   1. save your message
//   2. build instructions (profile + memories from old chats)
//   3. ask the best model; if it fails, try the next one (fallback)
//   4. stream the answer back word by word

import { saveMessage, json } from "../../lib/db.js";
import { planRoute } from "../../lib/router.js";
import { callModel } from "../../lib/providers.js";
import { getProfile, searchMemory, buildSystemPrompt } from "../../lib/memory.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, model } = await context.request.json();
  // messages = [{role:"user", content:"..."}, {role:"assistant", ...}, ...]

  // 1. Save your newest message
  const last = messages[messages.length - 1];
  await saveMessage(env.DB, chatId, "user", last.content, "");

  // 2. Instructions: what NEXUS knows about you + related old messages
  const profile = await getProfile(env.DB);
  const memories = await searchMemory(env.DB, last.content, chatId);
  const fullMessages = [{ role: "system", content: buildSystemPrompt(profile, memories) }].concat(messages);

  // 3. Try models one by one until one answers
  const plan = planRoute(env, messages, model);
  if (plan.length === 0) return json({ error: "No API keys found. Add keys to .dev.vars (see SETUP.md)." }, 400);

  const errors = [];
  const skip = new Set();   // providers whose key is wrong or limit is reached
  for (const step of plan) {
    if (skip.has(step.provider.id)) continue;
    try {
      const res = await callModel(env, step.provider, step.model, fullMessages, true);
      if (res.ok) {
        // 4. Pass the stream straight to your browser (no extra work here = fast + free)
        return new Response(res.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "x-nexus-model": step.provider.name + " · " + step.model,
            "x-nexus-memories": String(memories.length),
          },
        });
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
