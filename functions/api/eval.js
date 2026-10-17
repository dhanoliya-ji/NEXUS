// ============================================================
//  POST /api/eval?provider=groq — weekly quality test for one AI
// ============================================================
//  Idea from the MT-Bench / "LLM-as-a-Judge" paper (Zheng et al., 2023):
//   1. the AI answers 5 fixed questions (math, fact, code, logic, explaining)
//   2. a DIFFERENT AI grades each answer 1–10 against a reference answer
//   3. the average becomes its test_score (ratings.js) → the router uses it
//  Called by the weekly GitHub job (.github/workflows/weekly-check.yml), one provider at a time
//  (each call ≈ 10 requests, inside Cloudflare's free limit).

import { json } from "../../lib/db.js";
import { getProvider, isReady, askModel, PROVIDERS } from "../../lib/providers.js";
import { askHelper } from "../../lib/memory.js";

const TESTS = [
  { q: "Pens cost ₹12 each, or ₹50 for a pack of 5. What is the cheapest way to buy exactly 13 pens, and the total cost?",
    ref: "2 packs of 5 (₹100) + 3 single pens (₹36) = ₹136." },
  { q: "What is the capital of Australia, and why isn't it Sydney? Two sentences.",
    ref: "Canberra. It was purpose-built as a compromise between rivals Sydney and Melbourne." },
  { q: "Write a JavaScript function secondLargest(arr) that returns the second largest UNIQUE number in an array, or null if there isn't one.",
    ref: "Must ignore duplicates (e.g. [5,5,3] → 3, [7,7] → null), handle empty arrays; e.g. const u=[...new Set(arr)].sort((a,b)=>b-a); return u.length>1?u[1]:null;" },
  { q: "If all bloops are razzies and all razzies are lazzies, are all bloops definitely lazzies? Answer yes or no and explain in one sentence.",
    ref: "Yes — the relation is transitive: every bloop is a razzie and every razzie is a lazzie." },
  { q: "Explain what a SIP (systematic investment plan) in mutual funds is, to a beginner, in 3 sentences.",
    ref: "Investing a fixed amount regularly (e.g. monthly) into a mutual fund; builds discipline; rupee-cost averaging buys more units when prices are low; long-term compounding." },
];

export async function onRequestPost(context) {
  const env = context.env;
  const id = new URL(context.request.url).searchParams.get("provider");
  const provider = getProvider(id);
  if (!provider || !isReady(provider, env) || provider.id === "ollama") return json({ error: "unknown or unavailable provider" }, 400);
  const model = provider.models[0];

  // 1. Answer all questions (at the same time)
  const answers = await Promise.allSettled(TESTS.map((t) => askModel(env, provider, model, [{ role: "user", content: t.q }], 2000)));

  // 2. A different AI grades each answer
  const judges = PROVIDERS.filter((p) => p.id !== id && p.id !== "ollama" && isReady(p, env)).map((p) => p.id);
  const scores = [];
  for (let i = 0; i < TESTS.length; i++) {
    if (answers[i].status !== "fulfilled" || !answers[i].value.trim()) { scores.push(1); continue; }
    const grade = await askHelper(env, [
      { role: "system", content: "You grade an AI answer against a reference. Score 1-10 for correctness first, then clarity and following instructions. Reply ONLY with JSON: {\"score\": n}" },
      { role: "user", content: "QUESTION: " + TESTS[i].q + "\nREFERENCE: " + TESTS[i].ref + "\nANSWER TO GRADE:\n" + answers[i].value.slice(0, 4000) },
    ], 300, judges);
    const n = Number((grade.match(/"score"\s*:\s*(\d+(\.\d+)?)/) || [])[1]);
    if (n >= 1 && n <= 10) scores.push(n);
  }
  if (!scores.length) return json({ error: "no grades" }, 502);

  // 3. Save the average as this model's test score
  const avg = Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
  await env.DB.prepare("INSERT OR IGNORE INTO ratings (provider, model, elo) VALUES (?, ?, 1000)").bind(id, model).run();
  await env.DB.prepare("UPDATE ratings SET test_score = ?, tested = ? WHERE provider = ? AND model = ?").bind(avg, Date.now(), id, model).run();
  return json({ provider: id, model: model, scores: scores, average: avg });
}
