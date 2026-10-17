// ============================================================
//  /api/share — 🔗 share ONE chat as a read-only link
// ============================================================
//  POST   {chatId}  → makes (or reuses) a secret link like  /share?t=3f9a…
//  DELETE ?chatId=… → turns the link off
//  The link shows only that chat (no other chats, no memory, no settings).

import { json } from "../../lib/db.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { chatId } = await context.request.json();
  const existing = await db.prepare("SELECT token FROM shares WHERE chat_id = ?").bind(chatId).first();
  if (existing) return json({ token: existing.token });
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT INTO shares (token, chat_id, created) VALUES (?, ?, ?)").bind(token, chatId, Date.now()).run();
  return json({ token: token });
}

export async function onRequestDelete(context) {
  const chatId = new URL(context.request.url).searchParams.get("chatId");
  await context.env.DB.prepare("DELETE FROM shares WHERE chat_id = ?").bind(chatId).run();
  return json({ ok: true });
}
