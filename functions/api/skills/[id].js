// DELETE /api/skills/:id — remove one of your own skills

import { json } from "../../../lib/db.js";

export async function onRequestDelete(context) {
  await context.env.DB.prepare("DELETE FROM skills WHERE id = ?").bind(context.params.id).run();
  return json({ ok: true });
}
