// ============================================================
//  chunks.js — save a text so NEXUS can search it (documents AND notes)
// ============================================================
//  Long text is cut into parts of ~1500 characters (at paragraph or sentence ends).
//  Each part is saved for keyword search (doc_chunks) and meaning search (Vectorize).
//  Then, in every chat, NEXUS adds only the parts that match your question ("RAG").

import { rememberDoc, forget } from "./semantic.js";

const PART_SIZE = 1500;

export function cutIntoParts(text) {
  const parts = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + PART_SIZE, text.length);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n", end);
      const sentence = text.lastIndexOf(". ", end);
      end = paragraph > start + PART_SIZE / 2 ? paragraph : sentence > start + PART_SIZE / 2 ? sentence + 1 : end;
    }
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }
  return parts;
}

// Save (or replace) a searchable text. Returns the number of parts.
// waitUntil = context.waitUntil, so meaning-search indexing happens in the background.
export async function saveSearchable(env, waitUntil, id, name, text) {
  const db = env.DB;
  await removeSearchable(env, id);
  const parts = cutIntoParts(text.slice(0, 400000));
  await db.prepare("INSERT INTO docs (id, name, chars, created) VALUES (?, ?, ?, ?)").bind(id, name.slice(0, 120), text.length, Date.now()).run();
  for (let i = 0; i < parts.length; i += 50) {
    await db.batch(parts.slice(i, i + 50).map((part, j) =>
      db.prepare("INSERT INTO doc_chunks (doc_id, part, text) VALUES (?, ?, ?)").bind(id, i + j, part)));
  }
  waitUntil(rememberDoc(env, id, name, parts).catch(() => {}));
  return parts.length;
}

export async function removeSearchable(env, id) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM doc_chunks WHERE doc_id = ?").bind(id),
    env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(id),
  ]);
  await forget(env, "doc:" + id).catch(() => {});
}
