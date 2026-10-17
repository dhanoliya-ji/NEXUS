// GET /api/export — everything (chats, messages, profile) as one JSON file.
// Your laptop downloads this every day and saves it on the D drive.

import { json } from "../../lib/db.js";

export async function onRequestGet(context) {
  const db = context.env.DB;
  const chats = await db.prepare("SELECT * FROM chats").all();
  const messages = await db.prepare("SELECT * FROM messages ORDER BY id").all();
  const profile = await db.prepare("SELECT * FROM profile").all();
  return json({
    exported: new Date().toISOString(),
    chats: chats.results,
    messages: messages.results,
    profile: profile.results,
  });
}
