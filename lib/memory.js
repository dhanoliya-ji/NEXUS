// ============================================================
//  memory.js — how NEXUS remembers you across ALL chats
// ============================================================
//
//  No AI model remembers you by itself. So we build memory in 2 layers
//  (ideas from the MemGPT and RAG papers):
//
//  1. PROFILE  — a short "About me" list (name, projects, likes).
//                After each answer, a small fast model reads the new
//                messages and updates the list if it learned something.
//
//  2. SEARCH   — before answering, NEXUS searches your OLD chats for
//                words from your new message and adds the best matches.

import { PROVIDERS, isReady, askModel } from "./providers.js";

// ---------- Layer 1: profile ----------

export async function getProfile(db) {
  const row = await db.prepare("SELECT text FROM profile WHERE id = 1").first();
  return row ? row.text : "";
}

export async function setProfile(db, text) {
  await db.prepare("INSERT OR REPLACE INTO profile (id, text, updated) VALUES (1, ?, ?)")
    .bind(text, Date.now()).run();
}

// Fast + cheap models for background jobs (in this order)
const HELPERS = [
  ["groq", "openai/gpt-oss-20b"],
  ["gemini", "gemini-flash-lite-latest"],
  ["cerebras", "llama-3.3-70b"],
  ["zai", "glm-4.5-flash"],
  ["mistral", "mistral-small-latest"],
];

// Ask the first working helper model. Returns text or "" if all fail.
export async function askHelper(env, messages, maxTokens) {
  for (const [id, model] of HELPERS) {
    const provider = PROVIDERS.find((p) => p.id === id);
    if (!isReady(provider, env)) continue;
    try {
      return await askModel(env, provider, model, messages, maxTokens);
    } catch (e) {
      // this helper failed, try the next one
    }
  }
  return "";
}

// Read the newest exchange and update the "About me" profile
export async function updateProfile(env, userText, replyText) {
  if (userText.length < 15) return;               // "hi", "ok" → nothing to learn

  const oldProfile = await getProfile(env.DB);
  const prompt = [
    {
      role: "system",
      content:
        "You maintain a short profile of facts about the USER (not the assistant). " +
        "Keep only lasting facts: name, location, job, skills, projects, goals, preferences, people in their life. " +
        "Ignore one-time questions. Write a bullet list, max 40 bullets, each under 20 words. " +
        "If the new messages add nothing lasting, reply with exactly: NO_CHANGE",
    },
    {
      role: "user",
      content:
        "CURRENT PROFILE:\n" + (oldProfile || "(empty)") +
        "\n\nNEW MESSAGE FROM USER:\n" + userText.slice(0, 4000) +
        "\n\nASSISTANT REPLY:\n" + replyText.slice(0, 2000) +
        "\n\nReturn the full updated profile, or NO_CHANGE.",
    },
  ];

  const answer = (await askHelper(env, prompt, 800)).trim();
  if (answer && !answer.includes("NO_CHANGE")) await setProfile(env.DB, answer);
}

// ---------- Layer 2: search old chats ----------

// Common words that don't help searching
const SKIP = new Set(["what", "which", "where", "when", "about", "there", "their", "would", "could", "should",
  "this", "that", "with", "from", "have", "your", "please", "tell", "make", "want", "does", "know", "like"]);

// Turn a message into a search query: "word1" OR "word2" OR ...  (real words with 4+ letters, max 12)
// Only the first 2000 characters are used (so a pasted file doesn't make a giant query)
export function searchQuery(text) {
  const words = text.slice(0, 2000).toLowerCase().match(/[a-z0-9ऀ-ॿ]{4,}/g) || [];
  const useful = [...new Set(words)].filter((w) => !SKIP.has(w)).slice(0, 12);
  return useful.map((w) => '"' + w + '"').join(" OR ");
}

// 📚 Find the best matching parts of your uploaded documents
export async function searchDocs(db, text) {
  const query = searchQuery(text);
  if (!query) return [];
  try {
    const result = await db
      .prepare(`SELECT doc_chunks_fts.text AS text, docs.name AS name FROM doc_chunks_fts
                JOIN docs ON docs.id = doc_chunks_fts.doc_id
                WHERE doc_chunks_fts MATCH ? ORDER BY rank LIMIT 4`)
      .bind(query)
      .all();
    return result.results;
  } catch (e) {
    return [];
  }
}

export async function searchMemory(db, text, currentChatId) {
  const query = searchQuery(text);
  if (!query) return [];
  try {
    const result = await db
      .prepare("SELECT content, role FROM messages_fts WHERE messages_fts MATCH ? AND chat_id != ? ORDER BY rank LIMIT 5")
      .bind(query, currentChatId)
      .all();
    return result.results;
  } catch (e) {
    return [];   // search failing should never stop the chat
  }
}

// Build the "system message" = the instructions NEXUS reads before every answer.
// Important things go at the START (idea from "Lost in the Middle" paper).
//   parts = { profile, memories, toolText, docs, skill, summary }
export function buildSystemPrompt(parts) {
  const { profile, memories, toolText, docs, skill, summary } = parts;
  const now = new Date().toUTCString();
  let text =
    "You are NEXUS, a smart, friendly personal AI assistant. Current date/time: " + now + ".\n" +
    "WRITING STYLE:\n" +
    "- Match the length to the question: short questions get short answers; go deep only when asked or needed.\n" +
    "- Use markdown well: headings and lists for longer answers, tables only for comparisons, code blocks for code. " +
    "Don't overuse bold.\n" +
    "- For real math formulas use LaTeX: $x^2$ inline or $$...$$ on its own line. Don't use LaTeX for plain numbers or simple text " +
    "(write 3x3, 50%, O(n) normally). Write money as ₹500 or $5 without spaces.\n" +
    "- Be natural and warm, not robotic. No filler like 'Great question!'.\n" +
    "- Be honest: if you are not sure, say so.\n" +
    "Files the user attaches appear between <<FILE: name>> and <<END FILE>>. Read them carefully.\n";

  // The active skill goes near the top: it changes HOW NEXUS answers
  if (skill) text += "\nACTIVE SKILL — follow these instructions for every answer:\n" + skill + "\n";

  if (profile) text += "\nWHAT YOU KNOW ABOUT THE USER:\n" + profile + "\n";

  if (summary) text += "\nSUMMARY OF THE EARLIER PART OF THIS CHAT:\n" + summary + "\n";

  if (docs && docs.length > 0) {
    text += "\nRELEVANT PARTS OF THE USER'S DOCUMENTS (mention the document name when you use them):\n";
    for (const d of docs) text += "--- from \"" + d.name + "\":\n" + d.text + "\n";
  }

  if (memories.length > 0) {
    text += "\nRELEVANT NOTES FROM EARLIER CHATS (use only if helpful):\n";
    for (const m of memories) text += "- (" + m.role + ") " + m.content.slice(0, 600) + "\n";
  }

  if (toolText) {
    text += "\nFRESH RESULTS FROM TOOLS (trust these over your training for current facts; " +
      "mention sources as markdown links):\n" + toolText + "\n";
  }
  return text;
}
