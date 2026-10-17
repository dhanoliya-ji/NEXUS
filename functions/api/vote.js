// POST /api/vote {winner: {provider, model}, loser: {provider, model}, tie}
//   ⚔️ battle result → Elo update for both models (ratings.js)

import { json } from "../../lib/db.js";
import { battle } from "../../lib/ratings.js";

export async function onRequestPost(context) {
  const { winner, loser, tie } = await context.request.json();
  if (!winner || !loser) return json({ error: "need winner and loser" }, 400);
  await battle(context.env.DB, winner, loser, Boolean(tie));
  return json({ ok: true });
}
