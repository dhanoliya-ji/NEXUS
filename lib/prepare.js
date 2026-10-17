// ============================================================
//  prepare.js — everything that happens BEFORE an AI answers
// ============================================================
//  Used by /api/chat, /api/council, /api/careful and /api/context:
//   1. save your new message
//   2. UNDERSTAND it (one fast call): rewritten question, how hard it is, which tools
//   3. search with the rewritten question: your facts, old chats, documents + run tools
//      (small talk skips searching — paper: Adaptive-RAG)
//   4. CHECK: is the found information enough to answer? If not, search the web
//      or tell the model not to guess (papers: Corrective RAG, Sufficient Context)
//   5. build the full message list: [instructions, ...conversation]
//
//  options = { tools: true/false, images: [...], skill: "teacher", onStatus: fn, regenerate: true/false }

import { saveMessage } from "./db.js";
import { searchMemory, searchDocs, buildSystemPrompt, askHelper } from "./memory.js";
import { factsForPrompt } from "./facts.js";
import { understand } from "./understand.js";
import { runTools } from "./tools.js";
import { getSkillPrompt } from "./skills.js";
import { getSummary } from "./summary.js";
import { lessonsForPrompt } from "./lessons.js";

const NO_TOOLS = { used: [], text: "" };

export async function prepare(env, chatId, messages, options) {
  const last = messages[messages.length - 1];
  const images = options.images || [];
  const toolsOn = options.tools !== false;
  const status = options.onStatus || (() => {});

  // 1. Save (images are not saved — too big — just a note)
  if (!options.regenerate) {
    const note = images.length ? "\n[📎 " + images.length + " image(s) attached]" : "";
    await saveMessage(env.DB, chatId, "user", last.content + note, "");
  }

  // 2. Understand the message, and load the things that don't depend on it — all at once
  status("🧠 Understanding your message…");
  const [plan, facts, skill, summary, lessons] = await Promise.all([
    understand(env, messages, toolsOn).catch(() => ({ query: last.content, complexity: 1, tools: [] })),
    factsForPrompt(env.DB).catch(() => ""),
    getSkillPrompt(env.DB, options.skill),
    getSummary(env.DB, chatId),
    lessonsForPrompt(env.DB).catch(() => ""),
  ]);

  // 3. Search + tools (skipped for small talk)
  let memories = [], docs = [], tools = NO_TOOLS;
  if (plan.complexity > 0) {
    status("🔎 Searching your memory and documents…");
    [memories, docs, tools] = await Promise.all([
      searchMemory(env, plan.query, chatId).catch(() => []),
      searchDocs(env, plan.query).catch(() => []),
      runTools(env, plan.tools, status).catch(() => NO_TOOLS),
    ]);
  }

  // 4. Is the found context enough? (only when we found notes and no tool already fetched fresh data)
  let warning = "";
  if ((memories.length || docs.length) && tools.used.length === 0) {
    const verdict = await isEnough(env, plan.query, memories, docs);
    if (verdict !== "YES") {
      warning = "The saved notes may not fully answer this. If a personal detail is not in the notes or facts, " +
        "say you don't know it instead of guessing.";
      const personal = /\b(my|me|i|mine|we|our)\b/i.test(plan.query);
      if (toolsOn && !personal) {
        const web = await runTools(env, [{ name: "web_search", input: plan.query }], status).catch(() => NO_TOOLS);
        tools = { used: tools.used.concat(web.used), text: tools.text + web.text };
      }
    }
  }

  // 5. Instructions + conversation
  const system = buildSystemPrompt({ profile: facts, memories, toolText: tools.text, docs, skill, summary, warning, lessons });

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
    complexity: plan.complexity,
    query: plan.query,
  };
}

// One fast call: can this question be answered with the notes found (plus general knowledge)?
async function isEnough(env, question, memories, docs) {
  const context = memories.map((m) => "- " + m.text.slice(0, 400)).concat(docs.map((d) => "- [" + d.name + "] " + d.text.slice(0, 400))).join("\n");
  const answer = await askHelper(env, [
    { role: "system", content: "Reply with exactly one word: YES (the notes plus general knowledge fully answer the question), PARTIAL, or NO." },
    { role: "user", content: "QUESTION: " + question + "\n\nNOTES:\n" + context.slice(0, 6000) },
  ], 300, ["groq", "cloudflare", "gemini"]);   // room for models that think before answering
  const word = (answer.match(/\b(YES|PARTIAL|NO)\b/i) || ["YES"])[0].toUpperCase();
  return word;
}

// Extra info sent back in headers (used by /api/context-style answers that don't stream live).
export function infoHeaders(modelName, prep) {
  return {
    "Content-Type": "text/event-stream",
    "x-nexus-model": encodeURIComponent(modelName),
    "x-nexus-memories": String(prep.memories.length),
    "x-nexus-docs": encodeURIComponent([...new Set(prep.docs.map((d) => d.name))].join(", ")),
    "x-nexus-tools": prep.toolsUsed.join(", "),
  };
}
