// POST /api/login {password} → {token}   (the browser keeps the token, not the password)

import { json } from "../../lib/db.js";
import { clientIp, isLocked, addFail, clearFails, newSession } from "../../lib/auth.js";

export async function onRequestPost(context) {
  const env = context.env;
  const db = env.DB;
  const ip = clientIp(context.request);

  if (await isLocked(db, ip)) return json({ error: "Too many wrong passwords. Try again in 15 minutes." }, 429);

  const { password } = await context.request.json();
  if (!env.NEXUS_PASSWORD || password !== env.NEXUS_PASSWORD) {
    await addFail(db, ip);
    return json({ error: "Wrong password" }, 401);
  }

  await clearFails(db, ip);
  const device = context.request.headers.get("user-agent") || "unknown device";
  return json({ token: await newSession(db, device) });
}
