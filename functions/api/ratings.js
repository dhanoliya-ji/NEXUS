// GET /api/ratings — every model's Elo score, wins/losses, 👍👎 and weekly test score

import { json } from "../../lib/db.js";
import { allRatings } from "../../lib/ratings.js";

export async function onRequestGet(context) {
  return json(await allRatings(context.env.DB));
}
