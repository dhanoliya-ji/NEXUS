// ============================================================
//  prepare.js — everything that happens BEFORE an AI answers
// ============================================================
//  Used by /api/chat, /api/council, /api/careful and /api/context:
//   1. save your new message
//   2. at the same time: profile, old chats, documents, tools, skill, summary
//   3. build the full message list: [instructions, ...conversation]
//
//  options = { tools: true/false, images: [...], skill: "teacher" }

import { saveMessage } from "./db.js";
import { getProfile, searchMemory, searchDocs, buildSystemPrompt } from "./memory.js";
import { useTools } from "./tools.js";
import { getSkillPrompt } from "./skills.js";
import { getSummary } from "./summary.js";

const NO_TOOLS = { used: [], text: "" };

export async function prepare(env, chatId, messages, options) {
  const last = messages[messages.length - 1];
  const images = options.images || [];

  // Images are not saved in the database (too big) — just a note that there were some
  const note = images.length ? "\n[📎 " + images.length + " image(s) attached]" : "";
  await saveMessage(env.DB, chatId, "user", last.content + note, "");

  // Promise.all = do everything at once (faster than one after another)
  const [profile, memories, docs, tools, skill, summary] = await Promise.all([
    getProfile(env.DB),
    searchMemory(env.DB, last.content, chatId),
    searchDocs(env.DB, last.content),
    options.tools !== false ? useTools(env, messages).catch(() => NO_TOOLS) : NO_TOOLS,
    getSkillPrompt(env.DB, options.skill),
    getSummary(env.DB, chatId),
  ]);

  const system = buildSystemPrompt({ profile, memories, toolText: tools.text, docs, skill, summary });

  // With images, the last message becomes a list: text + pictures (the "vision" format)
  let conversation = messages;
  if (images.length) {
    const withImages = {
      role: "user",
      content: [{ type: "text", text: last.content }].concat(
        images.map((url) => ({ type: "image_url", image_url: { url: url } }))
      ),
    };
    conversation = messages.slice(0, -1).concat([withImages]);
  }

  return {
    system: system,
    fullMessages: [{ role: "system", content: system }].concat(conversation),
    memories: memories,
    docs: docs,
    toolsUsed: tools.used,
  };
}

// Extra info sent back to the browser with every answer.
// encodeURIComponent: headers only allow plain English letters, so "·" and "→" must be encoded
export function infoHeaders(modelName, prep) {
  return {
    "Content-Type": "text/event-stream",
    "x-nexus-model": encodeURIComponent(modelName),
    "x-nexus-memories": String(prep.memories.length),
    "x-nexus-docs": encodeURIComponent([...new Set(prep.docs.map((d) => d.name))].join(", ")),
    "x-nexus-tools": prep.toolsUsed.join(", "),
  };
}
