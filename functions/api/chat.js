// ============================================================
//  POST /api/chat — the main brain: you send a message, NEXUS answers
// ============================================================
//  Steps:
//   1. pick the models to try (router)
//   2. prepare: save your message, profile + memories + documents + tools + skill
//   3. ask the models one by one until one answers, stream it back word by word

import { json } from "../../lib/db.js";
import { planRoute, planVision } from "../../lib/router.js";
import { prepare, infoHeaders } from "../../lib/prepare.js";
import { streamFirst } from "../../lib/run.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, model, tools, images, skill } = await context.request.json();
  // messages = [{role:"user", content:"..."}, {role:"assistant", ...}, ...]
  // images   = ["data:image/jpeg;base64,...", ...]  (only for the newest message)

  // 1. Pictures need a model that can see; otherwise the normal router decides
  const hasImages = images && images.length > 0;
  const plan = hasImages ? planVision(env) : planRoute(env, messages, model);
  if (plan.length === 0) return json({ error: "No API keys found. Add keys to .dev.vars (see SETUP.md)." }, 400);

  // 2. Save message + build instructions
  const prep = await prepare(env, chatId, messages, { tools: tools, images: images, skill: skill });

  // 3. First model that works answers. Its stream goes straight to your browser.
  const { res, step, errors } = await streamFirst(env, plan, prep.fullMessages);
  if (!res) return json({ error: "All models failed", details: errors }, 502);
  return new Response(res.body, { headers: infoHeaders(step.provider.name + " · " + step.model, prep) });
}
