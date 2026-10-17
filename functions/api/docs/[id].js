// DELETE /api/docs/:id — remove a document, all its parts and its meaning-search vectors

import { json } from "../../../lib/db.js";
import { removeSearchable } from "../../../lib/chunks.js";

export async function onRequestDelete(context) {
  await removeSearchable(context.env, context.params.id);
  return json({ ok: true });
}
