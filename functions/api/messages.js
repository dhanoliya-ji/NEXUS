// ============================================================
//  POST /api/messages — save a message the browser finished showing
// ============================================================
//  After NEXUS finishes answering, the browser sends the full answer here.
//  Then, in the background, NEXUS updates your "About me" profile.

import { saveMessage, json } from "../../lib/db.js";
import { updateProfile } from "../../lib/memory.js";
import { updateSummary } from "../../lib/summary.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, role, content, model, userText } = await context.request.json();

  await saveMessage(env.DB, chatId, role, content, model);

  // waitUntil = "do this after replying, don't make the user wait"
  if (role === "assistant" && userText) {
    context.waitUntil(updateProfile(env, userText, content).catch(() => {}));
    context.waitUntil(updateSummary(env, chatId).catch(() => {}));   // only does work for long chats
  }
  return json({ ok: true });
}
