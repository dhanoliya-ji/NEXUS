// ============================================================
//  prepare.js — everything that happens BEFORE an AI answers
// ============================================================
//  Used by /api/chat, /api/council and /api/context:
//   1. save your new message
//   2. at the same time: load profile, search old chats, run tools
//   3. build the full message list: [instructions, ...conversation]

import { saveMessage } from "./db.js";
import { getProfile, searchMemory, buildSystemPrompt } from "./memory.js";
import { useTools } from "./tools.js";

export async function prepare(env, chatId, messages, toolsOn) {
  const last = messages[messages.length - 1];
  await saveMessage(env.DB, chatId, "user", last.content, "");

  // Promise.all = do all three at once (faster than one after another)
  const [profile, memories, tools] = await Promise.all([
    getProfile(env.DB),
    searchMemory(env.DB, last.content, chatId),
    toolsOn ? useTools(env, messages).catch(() => ({ used: [], text: "" })) : { used: [], text: "" },
  ]);

  const system = buildSystemPrompt(profile, memories, tools.text);
  return {
    system: system,
    fullMessages: [{ role: "system", content: system }].concat(messages),
    memories: memories,
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
    "x-nexus-tools": prep.toolsUsed.join(", "),
  };
}
