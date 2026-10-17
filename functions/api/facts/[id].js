// DELETE /api/facts/:id — forget a fact completely (also removes it from history)

import { json } from "../../../lib/db.js";

export async function onRequestDelete(context) {
  await context.env.DB.prepare("DELETE FROM facts WHERE id = ?").bind(context.params.id).run();
  return json({ ok: true });
}
