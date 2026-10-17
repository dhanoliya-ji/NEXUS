// ============================================================
//  POST /api/messages — save a message the browser finished showing
// ============================================================
//  After NEXUS finishes answering, the browser sends the full answer here.
//  Then, in the background (you don't wait):
//   • facts about you are updated + the exchange is stored as a memory (lib/facts.js)
//   • long chats get a summary (lib/summary.js)

import { saveMessage, json } from "../../lib/db.js";
import { learnFromExchange } from "../../lib/facts.js";
import { updateSummary } from "../../lib/summary.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, role, content, model, userText } = await context.request.json();

  await saveMessage(env.DB, chatId, role, content, model);

  // waitUntil = "do this after replying, don't make the user wait"
  if (role === "assistant" && userText) {
    context.waitUntil(learnFromExchange(env, chatId, userText, content).catch(() => {}));
    context.waitUntil(updateSummary(env, chatId).catch(() => {}));   // only does work for long chats
  }
  return json({ ok: true });
}
