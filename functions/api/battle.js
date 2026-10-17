// ============================================================
//  POST /api/battle — ⚔️ two AIs answer side by side, you pick the better one
// ============================================================
//  Idea from Chatbot Arena (LMSYS): blind comparisons → Elo ratings.
//  The answers are shown as "A" and "B" (names revealed after you vote),
//  your vote updates the ratings, and the router then prefers the winners.

import { json } from "../../lib/db.js";
import { planRoute } from "../../lib/router.js";
import { prepare } from "../../lib/prepare.js";
import { askModel } from "../../lib/providers.js";
import { liveStream } from "../../lib/live.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, tools, skill } = await context.request.json();

  // All providers (their main model), in random order so every AI gets a chance
  const candidates = [];
  for (const s of planRoute(env, messages, "auto").sort(() => Math.random() - 0.5)) {
    if (!candidates.some((x) => x.provider.id === s.provider.id) && s.model === s.provider.models[0]) candidates.push(s);
  }
  if (candidates.length < 2) return json({ error: "Battle needs at least 2 working providers." }, 400);

  return liveStream(context, async (live) => {
    const prep = await prepare(env, chatId, messages, { tools: tools, skill: skill, onStatus: live.status });
    live.status("⚔️ Two AIs are answering…");

    // Ask two at a time; if one fails (limit reached, down), the next candidate takes its place.
    // Only real answers fight — a failed AI must not "lose" a battle.
    const answers = [];
    while (answers.length < 2 && candidates.length) {
      const batch = candidates.splice(0, 2 - answers.length);
      const results = await Promise.allSettled(batch.map((s) => askModel(env, s.provider, s.model, prep.fullMessages, 4000)));
      results.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.trim()) {
          answers.push({ text: r.value, provider: batch[i].provider.id, model: batch[i].model, name: batch[i].provider.name + " · " + batch[i].model });
        }
      });
    }
    if (answers.length < 2) return live.send({ nexus_error: "Not enough AIs answered for a battle right now. Try again later." });
    await live.send({ nexus_battle: { a: answers[0], b: answers[1] } });
  });
}
