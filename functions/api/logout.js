// POST /api/logout {everywhere: true/false}
//   false → log out only this browser
//   true  → log out ALL devices (every token is deleted)

import { json } from "../../lib/db.js";

export async function onRequestPost(context) {
  const db = context.env.DB;
  const { everywhere } = await context.request.json();
  if (everywhere) {
    await db.prepare("DELETE FROM sessions").run();
  } else {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(context.request.headers.get("x-nexus-key") || "").run();
  }
  return json({ ok: true });
}
