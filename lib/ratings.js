// ============================================================
//  ratings.js — which AI do YOU like best? (Elo ratings, like chess)
// ============================================================
//  Idea from the Chatbot Arena paper (LMSYS, 2024): people compare answers,
//  and every model gets an Elo score. Everyone starts at 1000.
//   • ⚔️ battle: the winner takes points from the loser (K = 32)
//   • 👍 / 👎: like winning / losing against an average model (K = 16)
//   • the weekly test bot adds a quality score (test_score, 1–10)
//  The router then tries the best-rated providers first (see router.js).

const START = 1000;

// Chance that A beats B, from their scores (the Elo formula)
const expected = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));

async function getRow(db, provider, model) {
  await db.prepare("INSERT OR IGNORE INTO ratings (provider, model, elo) VALUES (?, ?, ?)").bind(provider, model, START).run();
  return db.prepare("SELECT * FROM ratings WHERE provider = ? AND model = ?").bind(provider, model).first();
}

async function setElo(db, provider, model, elo, extra) {
  await db.prepare("UPDATE ratings SET elo = ?" + (extra ? ", " + extra : "") + " WHERE provider = ? AND model = ?")
    .bind(elo, provider, model).run();
}

// 👍 (good = true) or 👎 (good = false)
export async function thumbs(db, provider, model, good) {
  const row = await getRow(db, provider, model);
  const change = 16 * ((good ? 1 : 0) - expected(row.elo, START));
  await setElo(db, provider, model, row.elo + change, good ? "ups = ups + 1" : "downs = downs + 1");
}

// ⚔️ battle result (tie = both get half a win)
export async function battle(db, winner, loser, tie) {
  const w = await getRow(db, winner.provider, winner.model);
  const l = await getRow(db, loser.provider, loser.model);
  const score = tie ? 0.5 : 1;
  const change = 32 * (score - expected(w.elo, l.elo));
  await setElo(db, w.provider, w.model, w.elo + change, tie ? "" : "wins = wins + 1");
  await setElo(db, l.provider, l.model, l.elo - change, tie ? "" : "losses = losses + 1");
}

// One score per provider for the router: average Elo + bonus from the weekly test
// Only providers with some votes/tests count — the rest stay at 1000 (neutral).
export async function providerScores(db) {
  const rows = (await db.prepare("SELECT provider, elo, wins, losses, ups, downs, test_score FROM ratings").all()).results;
  const scores = {};
  for (const r of rows) {
    const votes = r.wins + r.losses + r.ups + r.downs;
    const test = r.test_score ? (r.test_score - 7) * 20 : 0;      // a 9/10 test = +40, a 5/10 = -40
    if (votes < 3 && !r.test_score) continue;
    const s = (votes >= 3 ? r.elo : START) + test;
    scores[r.provider] = scores[r.provider] === undefined ? s : (scores[r.provider] + s) / 2;
  }
  return scores;
}

export async function allRatings(db) {
  return (await db.prepare("SELECT * FROM ratings ORDER BY elo DESC").all()).results;
}
