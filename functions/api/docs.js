// ============================================================
//  /api/docs — your documents library
// ============================================================
//  GET  → list your documents
//  POST {name, text} → save a document. The browser already turned the PDF/Word
//       file into text. Here we cut it into parts of ~1500 characters, because
//       search works best on small parts: NEXUS then adds only the RIGHT parts
//       of the RIGHT document to its instructions (that's "RAG").

import { newId, json } from "../../lib/db.js";

const PART_SIZE = 1500;
const MAX_CHARS = 400000;

export async function onRequestGet(context) {
  const result = await context.env.DB.prepare("SELECT id, name, chars, created FROM docs ORDER BY created DESC").all();
  return json(result.results);
}

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { name, text } = await context.request.json();
  if (!text || !text.trim()) return json({ error: "The document is empty." }, 400);

  const parts = cutIntoParts(text.slice(0, MAX_CHARS));
  const id = newId();

  await db.prepare("INSERT INTO docs (id, name, chars, created) VALUES (?, ?, ?, ?)")
    .bind(id, name.slice(0, 120), text.length, Date.now()).run();

  // Save the parts in groups of 50 (one database trip per group)
  for (let i = 0; i < parts.length; i += 50) {
    await db.batch(parts.slice(i, i + 50).map((part, j) =>
      db.prepare("INSERT INTO doc_chunks (doc_id, part, text) VALUES (?, ?, ?)").bind(id, i + j, part)
    ));
  }
  return json({ id: id, parts: parts.length });
}

// Cut text into parts of about PART_SIZE characters, at paragraph or sentence ends when possible
function cutIntoParts(text) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + PART_SIZE, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n", end);
      const sentence = text.lastIndexOf(". ", end);
      const cut = paragraph > start + PART_SIZE / 2 ? paragraph : sentence > start + PART_SIZE / 2 ? sentence + 1 : end;
      end = cut;
    }
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}
