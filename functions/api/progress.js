// /api/progress — 🗺️ which roadmap topics you're learning or have finished
//   GET → {"Deep learning › Core topics › Dropout": "done", ...}
//   PUT {topic, status} → status = "learning" | "done" | "" (empty = not started)

import { json } from "../../lib/db.js";

export async function onRequestGet(context) {
  const rows = (await context.env.DB.prepare("SELECT topic, status FROM progress").all()).results;
  return json(Object.fromEntries(rows.map((r) => [r.topic, r.status])));
}

export async function onRequestPut(context) {
  const db = context.env.DB;
  const { topic, status } = await context.request.json();
  if (!status) await db.prepare("DELETE FROM progress WHERE topic = ?").bind(topic).run();
  else await db.prepare("INSERT OR REPLACE INTO progress (topic, status, updated) VALUES (?, ?, ?)").bind(String(topic).slice(0, 300), status, Date.now()).run();
  return json({ ok: true });
}
