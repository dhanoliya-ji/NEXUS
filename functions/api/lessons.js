// GET /api/lessons — what NEXUS learned about how you like answers
// DELETE /api/lessons?id=3 — remove one lesson

import { json } from "../../lib/db.js";
import { getLessons } from "../../lib/lessons.js";

export async function onRequestGet(context) {
  return json(await getLessons(context.env.DB));
}

export async function onRequestDelete(context) {
  const id = new URL(context.request.url).searchParams.get("id");
  await context.env.DB.prepare("DELETE FROM lessons WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
