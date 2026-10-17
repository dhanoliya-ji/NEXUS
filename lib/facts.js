// ============================================================
//  facts.js — what NEXUS knows about you, as separate facts that update themselves
// ============================================================
//  Ideas from two 2025 papers:
//   • Mem0  — after each exchange, a model compares what you said with the facts
//             it already has and decides: ADD a new fact, UPDATE one that changed,
//             DELETE one that's no longer true (or do nothing).
//   • Zep   — facts have dates: when a fact changes, the old one is NOT erased but
//             marked "ended", so NEXUS can answer "where did I live before?".
//  The same model call also writes 1–3 short "key facts" about the exchange; they're
//  used as search labels for that memory (idea from the LongMemEval paper).

import { askHelper } from "./memory.js";
import { rememberExchange } from "./semantic.js";

const day = (ms) => new Date(ms + 5.5 * 3600000).toISOString().slice(0, 10);   // India date

// Facts that are true now (and, separately, ones that ended)
export async function getFacts(db) {
  await migrateOldProfile(db);
  return (await db.prepare("SELECT id, text, valid_from FROM facts WHERE invalid_at IS NULL ORDER BY id").all()).results;
}
export async function getPastFacts(db, limit) {
  return (await db.prepare("SELECT id, text, valid_from, invalid_at FROM facts WHERE invalid_at IS NOT NULL ORDER BY invalid_at DESC LIMIT ?")
    .bind(limit || 15).all()).results;
}

// The text that goes into NEXUS's instructions
export async function factsForPrompt(db) {
  const now = await getFacts(db);
  const past = await getPastFacts(db, 10);
  let text = now.map((f) => "- " + f.text).join("\n");
  if (past.length) {
    text += "\nNo longer true (history):\n" + past.map((f) => "- " + f.text + " (until " + day(f.invalid_at) + ")").join("\n");
  }
  return text;
}

// Same fact, written slightly differently? ("User likes tea." = "likes tea")
const same = (a, b) => {
  const clean = (s) => s.toLowerCase().replace(/^user('s)?\s+/, "").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return clean(a) === clean(b);
};

export async function addFact(db, text) {
  const current = (await db.prepare("SELECT text FROM facts WHERE invalid_at IS NULL").all()).results;
  if (current.some((f) => same(f.text, text))) return;          // already known
  const now = Date.now();
  await db.prepare("INSERT INTO facts (text, valid_from, created) VALUES (?, ?, ?)").bind(text.slice(0, 300), now, now).run();
}
const endFact = (db, id) => db.prepare("UPDATE facts SET invalid_at = ? WHERE id = ? AND invalid_at IS NULL").bind(Date.now(), id).run();

// After each answer (in the background): update facts + store the exchange as a memory
export async function learnFromExchange(env, chatId, userText, replyText) {
  const db = env.DB;
  const facts = await getFacts(db);
  let keys = [];

  if (userText.trim().length >= 12) {
    const answer = await askHelper(env, [
      {
        role: "system",
        content:
          "You manage a memory of lasting facts about the USER (name, family, location, job, studies, projects, goals, " +
          "preferences, habits, health, important dates). Compare the NEW EXCHANGE with the CURRENT FACTS and decide:\n" +
          '- ADD a new lasting fact: {"op":"ADD","text":"..."}\n' +
          '- UPDATE a fact that changed: {"op":"UPDATE","id":3,"text":"new version"}\n' +
          '- DELETE a fact the user says is wrong or no longer true: {"op":"DELETE","id":5}\n' +
          "Ignore one-time questions and facts about the assistant. Each fact: one short sentence starting with 'User'.\n" +
          "Also write 1-3 short KEYS: what this exchange was about (any topic, e.g. 'planned Ladakh trip budget 40k').\n" +
          'Reply with ONLY JSON: {"ops":[...],"keys":["..."]}  (ops can be empty)',
      },
      {
        role: "user",
        content: "CURRENT FACTS:\n" + (facts.map((f) => f.id + ". " + f.text).join("\n") || "(none)") +
          "\n\nNEW EXCHANGE:\nUser: " + userText.slice(0, 3000) + "\nAssistant: " + replyText.slice(0, 1500),
      },
    ], 600, ["cloudflare", "groq", "gemini", "nvidia"]);

    try {
      const result = JSON.parse(answer.match(/\{[\s\S]*\}/)[0]);
      keys = (result.keys || []).map(String).slice(0, 3);
      const known = new Set(facts.map((f) => f.id));
      for (const op of (result.ops || []).slice(0, 8)) {
        if (op.op === "ADD" && op.text) await addFact(db, String(op.text));
        if (op.op === "UPDATE" && known.has(op.id) && op.text) { await endFact(db, op.id); await addFact(db, String(op.text)); }
        if (op.op === "DELETE" && known.has(op.id)) await endFact(db, op.id);
      }
    } catch (e) { /* the model didn't return clean JSON — skip this time */ }
  }

  await rememberExchange(env, chatId, userText, replyText, keys);
}

// One-time move: the old "About me" text (one big profile) becomes separate facts
async function migrateOldProfile(db) {
  const count = await db.prepare("SELECT COUNT(*) AS n FROM facts").first();
  if (count.n > 0) return;
  const old = await db.prepare("SELECT text FROM profile WHERE id = 1").first();
  if (!old || !old.text) return;
  for (const line of old.text.split("\n")) {
    const text = line.replace(/^[\s\-*•\d.]+/, "").trim();
    if (text.length > 3) await addFact(db, text);
  }
}
