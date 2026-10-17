// ============================================================
//  /api/cards — 🃏 flashcards
// ============================================================
//  GET  ?due=1      → cards to review now (due ≤ now); without ?due → all cards (for deck counts)
//  POST {deck, text} → a fast model turns the text (an answer, a note…) into 5–10 Q/A cards
//  POST {deck, cards:[{front, back}]} → save cards you wrote yourself
//  (Scheduling uses FSRS in your browser — see web/learn.js.)

import { newId, json } from "../../lib/db.js";
import { askHelper } from "../../lib/memory.js";

// Read the model's JSON list. Formulas like $\sigma^2$ put single backslashes inside JSON text,
// which is invalid JSON ("\s" is not an allowed escape) — so if the first try fails, double them.
function parseCards(answer) {
  const match = String(answer).match(/\[[\s\S]*\]/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { /* fix backslashes below */ }
  try { return JSON.parse(match[0].replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch (e) { return null; }
}

export async function onRequestGet(context) {
  const due = new URL(context.request.url).searchParams.get("due");
  const db = context.env.DB;
  const rows = due
    ? await db.prepare("SELECT * FROM cards WHERE due <= ? ORDER BY due LIMIT 50").bind(Date.now()).all()
    : await db.prepare("SELECT id, deck, due FROM cards").all();
  return json(rows.results);
}

export async function onRequestPost(context) {
  const env = context.env;
  let { deck, text, cards } = await context.request.json();
  deck = String(deck || "General").slice(0, 60);

  if (!cards && text) {
    const prompt = [
      {
        role: "system",
        content:
          "Make 5-10 high-quality flashcards for studying the text (AI/ML/software). Each card tests ONE idea: definitions, " +
          "intuition, formulas (LaTeX with $...$, backslashes doubled for JSON), when-to-use, pitfalls. Front: a short question. " +
          "Back: a short, precise answer (1-3 sentences). Reply ONLY with JSON: [{\"front\": \"...\", \"back\": \"...\"}]",
      },
      { role: "user", content: String(text).slice(0, 12000) },
    ];
    // If one AI's reply can't be read, ask the next one
    for (const prefer of [["groq"], ["cloudflare"], ["gemini"], ["nvidia"], ["openrouter"]]) {
      cards = parseCards(await askHelper(env, prompt, 2500, prefer));
      if (cards && cards.length) break;
    }
    if (!cards || !cards.length) return json({ error: "Could not make cards from this text. Try again." }, 502);
  }

  cards = (cards || []).filter((c) => c && c.front && c.back).slice(0, 20);
  const now = Date.now();
  const dueNow = now - 60000;    // a minute ago, so a phone/laptop clock that's a bit behind still sees them as due
  if (cards.length) {
    await env.DB.batch(cards.map((c) => env.DB.prepare("INSERT INTO cards (id, deck, front, back, fsrs, due, created) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(newId(), deck, String(c.front).slice(0, 1000), String(c.back).slice(0, 3000), "", dueNow, now)));
  }
  return json({ added: cards.length, cards: cards });
}
