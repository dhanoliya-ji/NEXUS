// DELETE /api/docs/:id — remove a document, all its parts and its meaning-search vectors

import { json } from "../../../lib/db.js";
import { forget } from "../../../lib/semantic.js";

export async function onRequestDelete(context) {
  const db = context.env.DB;
  await db.batch([
    db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?").bind(context.params.id),
    db.prepare("DELETE FROM docs WHERE id = ?").bind(context.params.id),
  ]);
  await forget(context.env, "doc:" + context.params.id).catch(() => {});
  return json({ ok: true });
}
