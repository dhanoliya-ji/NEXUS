// ============================================================
//  /api/notes — 🗒️ your study notes
// ============================================================
//  GET  ?q=word       → list notes (newest first), optionally searching title/topic/text
//  POST {title, topic, content} → save a new note
//  Every note is ALSO saved as a searchable document (lib/chunks.js),
//  so NEXUS uses your notes when answering later questions.

import { newId, json } from "../../lib/db.js";
import { saveSearchable } from "../../lib/chunks.js";

export async function onRequestGet(context) {
  const q = new URL(context.request.url).searchParams.get("q");
  const db = context.env.DB;
  const rows = q
    ? await db.prepare("SELECT id, title, topic, updated, length(content) AS chars FROM notes WHERE title LIKE ?1 OR topic LIKE ?1 OR content LIKE ?1 ORDER BY updated DESC LIMIT 300")
        .bind("%" + q + "%").all()
    : await db.prepare("SELECT id, title, topic, updated, length(content) AS chars FROM notes ORDER BY updated DESC LIMIT 300").all();
  return json(rows.results);
}

export async function onRequestPost(context) {
  const env = context.env;
  const { title, topic, content } = await context.request.json();
  if (!content || !content.trim()) return json({ error: "The note is empty." }, 400);
  const id = newId();
  const now = Date.now();
  const t = String(title || "Untitled note").slice(0, 120);
  const tp = String(topic || "General").slice(0, 60);
  await env.DB.prepare("INSERT INTO notes (id, title, topic, content, created, updated) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, t, tp, content, now, now).run();
  await saveSearchable(env, (p) => context.waitUntil(p), "note-" + id, "Note: " + t + " (" + tp + ")", content);
  return json({ id: id });
}
