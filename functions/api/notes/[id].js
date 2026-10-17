// /api/notes/:id
//   GET    → the full note
//   PUT    {title, topic, content} → update it (and its searchable copy)
//   DELETE → remove it (and its searchable copy)

import { json } from "../../../lib/db.js";
import { saveSearchable, removeSearchable } from "../../../lib/chunks.js";

export async function onRequestGet(context) {
  const note = await context.env.DB.prepare("SELECT * FROM notes WHERE id = ?").bind(context.params.id).first();
  return note ? json(note) : json({ error: "Note not found" }, 404);
}

export async function onRequestPut(context) {
  const env = context.env;
  const id = context.params.id;
  const { title, topic, content } = await context.request.json();
  const t = String(title || "Untitled note").slice(0, 120);
  const tp = String(topic || "General").slice(0, 60);
  await env.DB.prepare("UPDATE notes SET title = ?, topic = ?, content = ?, updated = ? WHERE id = ?").bind(t, tp, content, Date.now(), id).run();
  await saveSearchable(env, (p) => context.waitUntil(p), "note-" + id, "Note: " + t + " (" + tp + ")", content);
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  await context.env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(context.params.id).run();
  await removeSearchable(context.env, "note-" + context.params.id);
  return json({ ok: true });
}
