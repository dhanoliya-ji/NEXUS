// ============================================================
//  summary.js — keeps very long chats understandable for every model
// ============================================================
//  Gemini can read 1 million tokens, but other models only ~100k.
//  When a chat gets long, the oldest messages are dropped for those models
//  (see trimToFit in providers.js). So we keep a SHORT SUMMARY of the older
//  part of the chat and put it in the instructions — nothing important is lost.
//
//  The summary is made in the background after an answer, never slowing you down.

import { askHelper } from "./memory.js";

const LONG_CHAT = 40000;   // characters; shorter chats don't need a summary
const KEEP_RECENT = 12;    // the newest 12 messages are always sent in full

export async function getSummary(db, chatId) {
  const row = await db.prepare("SELECT summary FROM chat_summaries WHERE chat_id = ?").bind(chatId).first();
  return row ? row.summary : "";
}

export async function updateSummary(env, chatId) {
  const db = env.DB;
  const rows = (await db.prepare("SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id").bind(chatId).all()).results;

  const total = rows.reduce((sum, r) => sum + r.content.length, 0);
  if (total < LONG_CHAT) return;

  const older = rows.slice(0, -KEEP_RECENT);
  const existing = await db.prepare("SELECT upto FROM chat_summaries WHERE chat_id = ?").bind(chatId).first();
  if (existing && existing.upto >= older.length - 6) return;   // still fresh enough

  // Summarize the older messages (newest 150k characters of them)
  let text = older.map((r) => r.role.toUpperCase() + ": " + r.content).join("\n\n");
  text = text.slice(-150000);

  const summary = await askHelper(env, [
    { role: "system", content: "Summarize this conversation so another assistant can continue it. Keep: the user's goals, decisions made, important facts, numbers, names, code/file names and open questions. Max 400 words, bullet points." },
    { role: "user", content: text },
  ], 900);

  if (summary) {
    await db.prepare("INSERT OR REPLACE INTO chat_summaries (chat_id, summary, upto, updated) VALUES (?, ?, ?, ?)")
      .bind(chatId, summary, older.length, Date.now()).run();
  }
}
