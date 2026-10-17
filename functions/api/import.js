// ============================================================
//  POST /api/import — 📥 bring old chats into NEXUS (e.g. from ChatGPT)
// ============================================================
//  The browser reads your ChatGPT export (conversations.json) and sends chats here
//  in small groups: {chats: [{title, created, messages: [{role, content, created}]}]}
//  After importing, meaning-search can be added with /api/reindex.

import { newId, json } from "../../lib/db.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { chats } = await context.request.json();
  let count = 0;
  for (const c of (chats || []).slice(0, 25)) {
    const msgs = (c.messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && m.content && m.content.trim());
    if (!msgs.length) continue;
    const id = newId();
    const created = Number(c.created) || Date.now();
    const statements = [
      db.prepare("INSERT INTO chats (id, title, created, updated, folder) VALUES (?, ?, ?, ?, ?)")
        .bind(id, String(c.title || "Imported chat").slice(0, 60), created, Number(msgs[msgs.length - 1].created) || created, "Imported"),
    ];
    for (const m of msgs.slice(0, 400)) {
      statements.push(db.prepare("INSERT INTO messages (chat_id, role, content, model, created) VALUES (?, ?, ?, ?, ?)")
        .bind(id, m.role, String(m.content).slice(0, 100000), "imported", Number(m.created) || created));
    }
    for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
    count++;
  }
  return json({ imported: count });
}
