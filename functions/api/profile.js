// /api/profile — see (GET) or edit (PUT) what NEXUS remembers about you

import { json } from "../../lib/db.js";
import { getProfile, setProfile } from "../../lib/memory.js";

export async function onRequestGet(context) {
  return json({ text: await getProfile(context.env.DB) });
}

export async function onRequestPut(context) {
  const { text } = await context.request.json();
  await setProfile(context.env.DB, text || "");
  return json({ ok: true });
}
