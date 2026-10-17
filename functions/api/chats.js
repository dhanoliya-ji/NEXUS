// ============================================================
//  /api/chats — list your chats (GET) or start a new one (POST)
// ============================================================

import { newId, json } from "../../lib/db.js";

// GET → newest chats first (with 📌 pinned and 📁 folder)
export async function onRequestGet(context) {
  const result = await context.env.DB
    .prepare("SELECT id, title, updated, pinned, folder FROM chats ORDER BY updated DESC LIMIT 300")
    .all();
  return json(result.results);
}

// POST {title} → creates a chat and returns its id
export async function onRequestPost(context) {
  const { title } = await context.request.json();
  const id = newId();
  const now = Date.now();
  await context.env.DB
    .prepare("INSERT INTO chats (id, title, created, updated) VALUES (?, ?, ?, ?)")
    .bind(id, (title || "New chat").slice(0, 60), now, now)
    .run();
  return json({ id: id });
}
