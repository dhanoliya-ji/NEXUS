// ============================================================
//  GET /api/doctor — checks which of your API keys actually work
// ============================================================
//  (Idea borrowed from the REA repo's "doctor" command.)
//  Sends a tiny "Say OK" to every provider and reports the result.

import { json } from "../../lib/db.js";
import { PROVIDERS, isReady, askModel } from "../../lib/providers.js";

export async function onRequestGet(context) {
  const env = context.env;

  const checks = PROVIDERS.map(async (p) => {
    if (!isReady(p, env)) return { name: p.name, status: "no key", key: p.key };
    const started = Date.now();
    try {
      await askModel(env, p, p.models[0], [{ role: "user", content: "Say OK" }], 5);
      return { name: p.name, status: "ok", model: p.models[0], ms: Date.now() - started };
    } catch (e) {
      return { name: p.name, status: "error", model: p.models[0], error: e.message };
    }
  });

  return json(await Promise.all(checks));
}
