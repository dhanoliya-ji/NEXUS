// POST /api/chats/:id/truncate {keep} — ✏️ edit: keep only the first `keep` messages of the chat
// (everything after the message you edited is removed, then your edited message is sent again)

import { json } from "../../../../lib/db.js";

export async function onRequestPost(context) {
  const { keep } = await context.request.json();
  await context.env.DB.prepare(
    "DELETE FROM messages WHERE chat_id = ? AND id NOT IN (SELECT id FROM messages WHERE chat_id = ? ORDER BY id LIMIT ?)"
  ).bind(context.params.id, context.params.id, Math.max(0, Number(keep) || 0)).run();
  return json({ ok: true });
}
