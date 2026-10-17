// GET /api/gallery — every picture NEXUS made for you (newest first)

import { json } from "../../lib/db.js";

export async function onRequestGet(context) {
  const rows = (await context.env.DB.prepare(
    "SELECT content, chat_id, created FROM messages WHERE role = 'assistant' AND model LIKE 'Pollinations%' ORDER BY id DESC LIMIT 100"
  ).all()).results;

  // Each image message looks like: ![prompt](https://image.pollinations.ai/...)
  const images = [];
  for (const r of rows) {
    const m = r.content.match(/!\[([^\]]*)\]\((https:\/\/[^)]+)\)/);
    if (m) images.push({ prompt: m[1], url: m[2], chatId: r.chat_id, created: r.created });
  }
  return json(images);
}
