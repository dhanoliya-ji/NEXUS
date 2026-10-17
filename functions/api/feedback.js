// POST /api/feedback {provider, model, label, good, note, question, answer}
//   👍 / 👎 on an answer → updates that model's rating (ratings.js);
//   👎 also teaches NEXUS a lesson about how you like answers (lessons.js), in the background.
//   Old answers (loaded from the database) only have a label like "Groq · openai/gpt-oss-120b",
//   so we work out provider + model from that.

import { json } from "../../lib/db.js";
import { PROVIDERS } from "../../lib/providers.js";
import { thumbs } from "../../lib/ratings.js";
import { learnLesson } from "../../lib/lessons.js";

export async function onRequestPost(context) {
  const env = context.env;
  let { provider, model, label, good, note, question, answer } = await context.request.json();

  if (!provider && label && label.includes(" · ")) {
    const [name, rest] = label.split(" · ");
    const p = PROVIDERS.find((x) => x.name === name.trim());
    if (p) { provider = p.id; model = rest.split(" ")[0]; }
  }
  if (provider && model) await thumbs(env.DB, provider, model, Boolean(good));
  if (!good && (note || answer)) context.waitUntil(learnLesson(env, note || "", question || "", answer || "").catch(() => {}));
  return json({ ok: true });
}
