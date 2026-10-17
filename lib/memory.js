// ============================================================
//  memory.js — searching what you said before + the fast "helper" models
// ============================================================
//
//  No AI model remembers you by itself. NEXUS remembers in 3 ways:
//   1. FACTS    — separate facts about you that update themselves (facts.js)
//   2. SEARCH   — before answering, your OLD chats and DOCUMENTS are searched
//                 by words (BM25) AND by meaning (semantic.js), then reranked
//   3. SUMMARY  — long chats get a summary of their older part (summary.js)

import { PROVIDERS, isReady, askModel } from "./providers.js";
import { hasSemantic, meaningSearch, fuse, rerank } from "./semantic.js";

// Fast + cheap models for background jobs (in this order)
const HELPERS = [
  ["groq", "openai/gpt-oss-20b"],
  ["gemini", "gemini-flash-lite-latest"],
  ["cloudflare", "@cf/openai/gpt-oss-20b"],
  ["nvidia", "openai/gpt-oss-20b"],
  ["cerebras", "llama-3.3-70b"],
  ["zai", "glm-4.5-flash"],
  ["mistral", "mistral-small-latest"],
];

// Ask the first working helper model. Returns text or "" if all fail.
// prefer = list of provider ids to try first (spreads work so no single free limit runs out)
export async function askHelper(env, messages, maxTokens, prefer) {
  const order = prefer
    ? HELPERS.filter(([id]) => prefer.includes(id)).sort((a, b) => prefer.indexOf(a[0]) - prefer.indexOf(b[0]))
        .concat(HELPERS.filter(([id]) => !prefer.includes(id)))
    : HELPERS;
  for (const [id, model] of order) {
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

// ---------- Searching old chats and documents ----------

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

// Run a search but never let it break the chat
async function safely(promise) {
  try { return await promise; } catch (e) { return []; }
}

// 📚 Find the best matching parts of your uploaded documents → [{name, text}]
//    keyword search + meaning search → merged (RRF) → reranked (see semantic.js)
export async function searchDocs(env, text) {
  const query = searchQuery(text);
  const keyword = !query ? [] : await safely(env.DB
    .prepare(`SELECT doc_chunks_fts.text AS text, docs.name AS name FROM doc_chunks_fts
              JOIN docs ON docs.id = doc_chunks_fts.doc_id
              WHERE doc_chunks_fts MATCH ? ORDER BY rank LIMIT 8`)
    .bind(query).all().then((r) => r.results));
  const meaning = hasSemantic(env) ? await safely(meaningSearch(env, text, "doc", 8)) : [];
  if (!keyword.length && !meaning.length) return [];
  return rerank(env, text, fuse([keyword, meaning]).slice(0, 10), 4);
}

// ⏳ Does the question mention a time? ("yesterday", "last week", "3 days ago", "in March")
// Returns {from, to} as "YYYY-MM-DD" (India dates), or null.  (Idea: LongMemEval's time-aware search)
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function timeWindow(text) {
  const t = text.toLowerCase();
  const dayOf = (msAgo) => new Date(Date.now() + 5.5 * 3600000 - msAgo).toISOString().slice(0, 10);
  const D = 86400000;
  if (/\byesterday\b/.test(t)) return { from: dayOf(D), to: dayOf(D) };
  if (/\btoday\b|\bthis morning\b/.test(t)) return { from: dayOf(0), to: dayOf(0) };
  if (/\b(last|past|this) week\b/.test(t)) return { from: dayOf(7 * D), to: dayOf(0) };
  if (/\b(last|past|this) month\b/.test(t)) return { from: dayOf(31 * D), to: dayOf(0) };
  const ago = t.match(/\b(\d+) (day|days|week|weeks) ago\b/);
  if (ago) {
    const days = Number(ago[1]) * (ago[2].startsWith("week") ? 7 : 1);
    return { from: dayOf((days + 1) * D), to: dayOf((days - 1) * D) };
  }
  const month = MONTHS.findIndex((m) => new RegExp("\\b(in|during|on) " + m + "\\b").test(t));
  if (month >= 0) {
    const now = new Date();
    const year = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear();
    const mm = String(month + 1).padStart(2, "0");
    return { from: year + "-" + mm + "-01", to: year + "-" + mm + "-31" };
  }
  return null;
}

// 🧠 Find related messages from your OTHER chats → [{text, day, role?}]
//    keyword + meaning search → (time filter) → merged (RRF) → reranked
export async function searchMemory(env, text, currentChatId) {
  const query = searchQuery(text);
  const keyword = !query ? [] : await safely(env.DB
    .prepare(`SELECT m.content AS text, m.role AS role, m.created AS created FROM messages_fts f
              JOIN messages m ON m.id = f.rowid
              WHERE messages_fts MATCH ? AND f.chat_id != ? ORDER BY rank LIMIT 8`)
    .bind(query, currentChatId).all()
    .then((r) => r.results.map((row) => ({ ...row, day: new Date(row.created + 5.5 * 3600000).toISOString().slice(0, 10) }))));
  let meaning = hasSemantic(env)
    ? (await safely(meaningSearch(env, text, "msg", 15))).filter((m) => m.chat_id !== currentChatId)
    : [];

  // A time in the question → keep only memories from those days,
  // and also add what you wrote on those days (for "what did we discuss yesterday?")
  const window = timeWindow(text);
  const inWindow = (m) => !window || (m.day >= window.from && m.day <= window.to);
  let byDate = [];
  if (window) {
    const start = Date.parse(window.from + "T00:00:00Z") - 5.5 * 3600000;
    const end = Date.parse(window.to + "T23:59:59Z") - 5.5 * 3600000;
    byDate = await safely(env.DB
      .prepare("SELECT content AS text, role, created FROM messages WHERE created BETWEEN ? AND ? AND chat_id != ? AND role = 'user' ORDER BY id DESC LIMIT 8")
      .bind(start, end, currentChatId).all()
      .then((r) => r.results.map((row) => ({ ...row, day: new Date(row.created + 5.5 * 3600000).toISOString().slice(0, 10) }))));
  }
  const merged = fuse([keyword.filter(inWindow), meaning.filter(inWindow), byDate]).slice(0, 10);
  if (!merged.length) return [];
  return rerank(env, text, merged, 5);
}

// Build the "system message" = the instructions NEXUS reads before every answer.
// Important things go at the START (idea from "Lost in the Middle" paper).
//   parts = { profile, memories, toolText, docs, skill, summary, warning, lessons }
export function buildSystemPrompt(parts) {
  const { profile, memories, toolText, docs, skill, summary, lessons } = parts;
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
    "- CHARTS: when a chart helps (or the user asks for one), add a ```chart code block with JSON like " +
    '{"type":"bar","title":"...","labels":["A","B"],"series":[{"name":"...","data":[1,2]}],"x":"x-axis label","y":"y-axis label"} ' +
    "(type: bar, line, pie, doughnut; max 8 series; numbers only in data). The website draws it.\n" +
    "- PYTHON: for calculations or data work the user may want to run, write a ```python block; the user can press ▶ Run " +
    "(runs in the browser with numpy, pandas, matplotlib; print() the results; no internet or file access).\n" +
    "- DIAGRAMS: for model architectures, pipelines, data flows or processes, add a ```mermaid block " +
    "(e.g. flowchart TD; short labels; put labels with symbols in quotes like A[\"Linear (d→4d)\"]). The website draws it.\n" +
    "- THE USER is learning AI/ML, deep learning, NLP and software engineering: give the intuition first, then the math " +
    "when it helps, then runnable code (PyTorch for deep learning, scikit-learn for classic ML, NumPy for fundamentals). " +
    "Mention trade-offs and common mistakes.\n" +
    "- ERRORS: when the user pastes an error or traceback: 1) what it means, 2) the most likely cause in their code, " +
    "3) the fix as code, 4) how to avoid it next time.\n" +
    "- PAPERS: when a paper's FULL TEXT is in the tool results and the user wants it explained, use: # Title (authors, year, link); " +
    "## TL;DR; ## Problem; ## Core idea (intuition); ## Method (key equations in LaTeX, each symbol explained, and a ```mermaid " +
    "architecture diagram); ## Results (table); ## Why it matters; ## Limitations; ## How to implement it (PyTorch-style sketch). " +
    "Only state numbers that appear in the paper.\n" +
    "- Be honest: if you are not sure, say so.\n" +
    "Files the user attaches appear between <<FILE: name>> and <<END FILE>>. Read them carefully.\n";

  // The active skill goes near the top: it changes HOW NEXUS answers
  if (skill) text += "\nACTIVE SKILL — follow these instructions for every answer:\n" + skill + "\n";

  // Lessons learned from your 👎 feedback (lessons.js)
  if (lessons) text += "\nHOW THIS USER LIKES ANSWERS (learned from their feedback — follow these):\n" + lessons + "\n";

  if (profile) text += "\nFACTS YOU KNOW ABOUT THE USER (use naturally, don't recite them):\n" + profile + "\n";

  if (summary) text += "\nSUMMARY OF THE EARLIER PART OF THIS CHAT:\n" + summary + "\n";

  if (docs && docs.length > 0) {
    text += "\nRELEVANT PARTS OF THE USER'S DOCUMENTS (mention the document name when you use them):\n";
    for (const d of docs) text += "--- from \"" + d.name + "\":\n" + d.text + "\n";
  }

  if (memories.length > 0) {
    // "Chain-of-Note" idea: pick the relevant notes first, then answer
    text += "\nNOTES FROM EARLIER CHATS (dated). First decide silently which notes are really relevant; " +
      "use only those, and ignore the rest:\n";
    for (const m of memories) text += "- (" + (m.day || "") + (m.role ? ", " + m.role : "") + ") " + m.text.slice(0, 700) + "\n";
  }

  if (parts.warning) text += "\nNOTE: " + parts.warning + "\n";

  if (toolText) {
    text += "\nFRESH RESULTS FROM TOOLS (trust these over your training for current facts; " +
      "mention sources as markdown links):\n" + toolText + "\n";
  }
  return text;
}
