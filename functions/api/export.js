// GET /api/export — everything (chats, messages, profile, documents, skills) as one JSON file.
// Your laptop downloads this every day and saves it on the D drive.

import { json } from "../../lib/db.js";

const TABLES = ["chats", "messages", "profile", "docs", "doc_chunks", "skills", "chat_summaries"];

export async function onRequestGet(context) {
  const db = context.env.DB;
  const data = { exported: new Date().toISOString() };
  for (const table of TABLES) {
    data[table] = (await db.prepare("SELECT * FROM " + table).all()).results;
  }
  return json(data);
}
