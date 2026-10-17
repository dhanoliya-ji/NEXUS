// ============================================================
//  /api/chats/:id — open (GET), rename (PATCH) or delete (DELETE) a chat
// ============================================================

import { json } from "../../../lib/db.js";

// GET → all messages of this chat, oldest first
export async function onRequestGet(context) {
  const result = await context.env.DB
    .prepare("SELECT role, content, model FROM messages WHERE chat_id = ? ORDER BY id")
    .bind(context.params.id)
    .all();
  return json(result.results);
}

// PATCH {title} → rename
export async function onRequestPatch(context) {
  const { title } = await context.request.json();
  await context.env.DB.prepare("UPDATE chats SET title = ? WHERE id = ?")
    .bind(title.slice(0, 60), context.params.id).run();
  return json({ ok: true });
}

// DELETE → remove the chat and its messages
export async function onRequestDelete(context) {
  const db = context.env.DB;
  await db.batch([
    db.prepare("DELETE FROM messages WHERE chat_id = ?").bind(context.params.id),
    db.prepare("DELETE FROM chats WHERE id = ?").bind(context.params.id),
  ]);
  return json({ ok: true });
}
