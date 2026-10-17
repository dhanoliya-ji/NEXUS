// GET /api/usage — answers per provider today (with free limits) and the last 7 days

import { json } from "../../lib/db.js";
import { PROVIDERS } from "../../lib/providers.js";
import { DAILY_LIMITS, today } from "../../lib/usage.js";

export async function onRequestGet(context) {
  const db = context.env.DB;
  const day = today();

  const byProvider = (await db.prepare("SELECT provider, SUM(count) AS count FROM usage WHERE day = ? GROUP BY provider").bind(day).all()).results;
  const byModel = (await db.prepare("SELECT provider, model, count FROM usage WHERE day = ? ORDER BY count DESC").bind(day).all()).results;
  const week = (await db.prepare("SELECT day, SUM(count) AS count FROM usage GROUP BY day ORDER BY day DESC LIMIT 7").all()).results;

  const name = (id) => (PROVIDERS.find((p) => p.id === id) || { name: id }).name;
  return json({
    day: day,
    providers: byProvider.map((r) => ({ id: r.provider, name: name(r.provider), count: r.count, limit: DAILY_LIMITS[r.provider] || null }))
      .sort((a, b) => b.count - a.count),
    models: byModel.map((r) => ({ name: name(r.provider), model: r.model, count: r.count })),
    week: week.reverse(),
  });
}
