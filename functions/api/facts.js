// /api/facts — what NEXUS knows about you
//   GET  → {current: [...], past: [...]}   (past = facts that changed or ended, with dates)
//   POST {text} → add a fact yourself

import { json } from "../../lib/db.js";
import { getFacts, getPastFacts, addFact } from "../../lib/facts.js";

export async function onRequestGet(context) {
  return json({ current: await getFacts(context.env.DB), past: await getPastFacts(context.env.DB, 30) });
}

export async function onRequestPost(context) {
  const { text } = await context.request.json();
  if (!text || !text.trim()) return json({ error: "Write a fact first." }, 400);
  await addFact(context.env.DB, text.trim());
  return json({ ok: true });
}
