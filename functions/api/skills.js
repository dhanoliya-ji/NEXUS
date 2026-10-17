// /api/skills — GET all skills (built-in + yours), POST {icon, name, prompt} to make your own

import { newId, json } from "../../lib/db.js";
import { BUILTIN_SKILLS } from "../../lib/skills.js";

export async function onRequestGet(context) {
  const mine = await context.env.DB.prepare("SELECT id, icon, name, prompt FROM skills ORDER BY created").all();
  return json(BUILTIN_SKILLS.map((s) => ({ ...s, builtin: true })).concat(mine.results));
}

export async function onRequestPost(context) {
  const { icon, name, prompt } = await context.request.json();
  if (!name || !prompt) return json({ error: "A skill needs a name and instructions." }, 400);
  const id = "my-" + newId();
  await context.env.DB.prepare("INSERT INTO skills (id, icon, name, prompt, created) VALUES (?, ?, ?, ?, ?)")
    .bind(id, (icon || "⭐").slice(0, 4), name.slice(0, 40), prompt.slice(0, 4000), Date.now()).run();
  return json({ id: id });
}
