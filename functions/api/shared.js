// GET /api/shared?t=TOKEN — the public, read-only view of ONE shared chat (no login needed)

import { json } from "../../lib/db.js";

export async function onRequestGet(context) {
  const db = context.env.DB;
  const token = new URL(context.request.url).searchParams.get("t") || "";
  const share = await db.prepare("SELECT chat_id FROM shares WHERE token = ?").bind(token).first();
  if (!share) return json({ error: "This link doesn't exist or was turned off." }, 404);
  const chat = await db.prepare("SELECT title FROM chats WHERE id = ?").bind(share.chat_id).first();
  const messages = (await db.prepare("SELECT role, content, model FROM messages WHERE chat_id = ? ORDER BY id").bind(share.chat_id).all()).results;
  return json({ title: chat ? chat.title : "Shared chat", messages: messages });
}
