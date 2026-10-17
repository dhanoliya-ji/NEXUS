// ============================================================
//  POST /api/context — instructions for a model running in your browser
// ============================================================
//  When you pick a "💻 My PC" model, your browser talks to Ollama on your
//  laptop directly (Cloudflare can't reach your laptop). But NEXUS still
//  saves your message and gives you memory, documents, tools and skills from here.

import { json } from "../../lib/db.js";
import { prepare } from "../../lib/prepare.js";

export async function onRequestPost(context) {
  const { chatId, messages, tools, skill } = await context.request.json();
  const prep = await prepare(context.env, chatId, messages, { tools: tools, skill: skill });
  return json({
    system: prep.system,
    memories: prep.memories.length,
    docs: [...new Set(prep.docs.map((d) => d.name))].join(", "),
    tools: prep.toolsUsed,
  });
}
