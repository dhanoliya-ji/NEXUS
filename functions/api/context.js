// ============================================================
//  POST /api/context — instructions for a model running in your browser
// ============================================================
//  When you pick a "💻 My PC" model, your browser talks to Ollama on your
//  laptop directly (Cloudflare can't reach your laptop). But NEXUS still
//  saves your message and gives you memory + tools from here.

import { json } from "../../lib/db.js";
import { prepare } from "../../lib/prepare.js";

export async function onRequestPost(context) {
  const { chatId, messages, tools } = await context.request.json();
  const prep = await prepare(context.env, chatId, messages, tools !== false);
  return json({ system: prep.system, memories: prep.memories.length, tools: prep.toolsUsed });
}
