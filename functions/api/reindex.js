// ============================================================
//  POST /api/reindex?kind=chats&offset=0 — add meaning-search for OLD data
// ============================================================
//  New messages and documents are indexed automatically. This is for things
//  saved before meaning-search existed. It works in small steps (to stay inside
//  Cloudflare's free limits); call it again with the "next" offset until done.
//    kind=chats → every (user message + reply) pair becomes one memory
//    kind=docs  → every document part

import { json } from "../../lib/db.js";
import { hasSemantic, rememberExchange, rememberDoc } from "../../lib/semantic.js";

export async function onRequestPost(context) {
  const env = context.env;
  if (!hasSemantic(env)) return json({ error: "Meaning search is not available here (needs Cloudflare AI + Vectorize)." }, 400);
  const url = new URL(context.request.url);
  const kind = url.searchParams.get("kind") || "chats";
  const offset = Number(url.searchParams.get("offset") || 0);

  if (kind === "docs") {
    const doc = await env.DB.prepare("SELECT id, name FROM docs ORDER BY created LIMIT 1 OFFSET ?").bind(offset).first();
    if (!doc) return json({ done: true });
    const parts = (await env.DB.prepare("SELECT text FROM doc_chunks WHERE doc_id = ? ORDER BY part").bind(doc.id).all()).results.map((r) => r.text);
    await rememberDoc(env, doc.id, doc.name, parts);
    return json({ done: false, next: offset + 1, indexed: doc.name });
  }

  // chats: take 20 messages at a time and pair each user message with the reply after it
  const rows = (await env.DB.prepare("SELECT chat_id, role, content FROM messages ORDER BY id LIMIT 20 OFFSET ?").bind(offset).all()).results;
  if (!rows.length) return json({ done: true });
  let count = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    if (rows[i].role === "user" && rows[i + 1].role === "assistant" && rows[i].chat_id === rows[i + 1].chat_id) {
      await rememberExchange(env, rows[i].chat_id, rows[i].content, rows[i + 1].content, []);
      count++;
    }
  }
  // step 19 (not 20) so a pair split across two steps is not lost
  return json({ done: false, next: offset + Math.max(1, rows.length - 1), indexed: count });
}
