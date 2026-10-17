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

    // Try each model; a removed model (404/410) means "try the next one"
    let last = null;
    for (const model of p.models) {
      const started = Date.now();
      try {
        await askModel(env, p, model, [{ role: "user", content: "Say OK" }], 20);
        return { name: p.name, status: "ok", model: model, ms: Date.now() - started };
      } catch (e) {
        last = { name: p.name, status: "error", model: model, error: e.message };
        if (!e.message.endsWith("404") && !e.message.endsWith("410")) break;
      }
    }
    return last;
  });

  return json(await Promise.all(checks));
}
