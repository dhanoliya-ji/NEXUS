// DELETE /api/docs/:id — remove a document and all its parts

import { json } from "../../../lib/db.js";

export async function onRequestDelete(context) {
  const db = context.env.DB;
  await db.batch([
    db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?").bind(context.params.id),
    db.prepare("DELETE FROM docs WHERE id = ?").bind(context.params.id),
  ]);
  return json({ ok: true });
}
