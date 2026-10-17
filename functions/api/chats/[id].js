// ============================================================
//  /api/chats/:id — open (GET), rename (PATCH) or delete (DELETE) a chat
// ============================================================

import { json } from "../../../lib/db.js";
import { forget } from "../../../lib/semantic.js";

// GET → all messages of this chat, oldest first
export async function onRequestGet(context) {
  const result = await context.env.DB
    .prepare("SELECT role, content, model FROM messages WHERE chat_id = ? ORDER BY id")
    .bind(context.params.id)
    .all();
  return json(result.results);
}

// PATCH {title?, pinned?, folder?} → rename, pin/unpin, move to a folder
export async function onRequestPatch(context) {
  const db = context.env.DB;
  const id = context.params.id;
  const change = await context.request.json();
  if (change.title !== undefined) await db.prepare("UPDATE chats SET title = ? WHERE id = ?").bind(String(change.title).slice(0, 60), id).run();
  if (change.pinned !== undefined) await db.prepare("UPDATE chats SET pinned = ? WHERE id = ?").bind(change.pinned ? 1 : 0, id).run();
  if (change.folder !== undefined) await db.prepare("UPDATE chats SET folder = ? WHERE id = ?").bind(String(change.folder).trim().slice(0, 40), id).run();
  return json({ ok: true });
}

// DELETE → remove the chat and its messages
export async function onRequestDelete(context) {
  const db = context.env.DB;
  await db.batch([
    db.prepare("DELETE FROM messages WHERE chat_id = ?").bind(context.params.id),
    db.prepare("DELETE FROM chats WHERE id = ?").bind(context.params.id),
    db.prepare("DELETE FROM chat_summaries WHERE chat_id = ?").bind(context.params.id),
  ]);
  await forget(context.env, context.params.id).catch(() => {});   // its meaning-search memories too
  return json({ ok: true });
}
