// ============================================================
//  /api/docs — your documents library
// ============================================================
//  GET  → list your documents (notes are listed in 🗒️ Notes, not here)
//  POST {name, text} → save a document. The browser already turned the PDF/Word
//       file into text; lib/chunks.js cuts it into parts and indexes them.

import { newId, json } from "../../lib/db.js";
import { saveSearchable } from "../../lib/chunks.js";

export async function onRequestGet(context) {
  const result = await context.env.DB.prepare("SELECT id, name, chars, created FROM docs WHERE id NOT LIKE 'note-%' ORDER BY created DESC").all();
  return json(result.results);
}

export async function onRequestPost(context) {
  const { name, text } = await context.request.json();
  if (!text || !text.trim()) return json({ error: "The document is empty." }, 400);
  const id = newId();
  const parts = await saveSearchable(context.env, (p) => context.waitUntil(p), id, name, text);
  return json({ id: id, parts: parts });
}
