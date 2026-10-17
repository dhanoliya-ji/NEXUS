// ============================================================
//  _middleware.js — runs BEFORE every /api/... request
// ============================================================
//  Job 1: make sure the database tables exist
//  Job 2: check you're allowed in (login token or password — see lib/auth.js)

import { setupDatabase, json } from "../../lib/db.js";
import { clientIp, isLocked, addFail, validToken } from "../../lib/auth.js";

// These work without logging in: logging in itself, and viewing a chat someone shared with a link
const OPEN = ["/api/login", "/api/shared"];

export async function onRequest(context) {
  const env = context.env;
  const request = context.request;
  await setupDatabase(env.DB);

  // No password set (e.g. on your laptop) or an open route → let it through
  const path = new URL(request.url).pathname;
  if (!env.NEXUS_PASSWORD || OPEN.includes(path)) return context.next();

  const ip = clientIp(request);
  if (await isLocked(env.DB, ip)) return json({ error: "Too many wrong passwords. Try again in 15 minutes." }, 429);

  const password = request.headers.get("x-nexus-password");   // scripts
  const token = request.headers.get("x-nexus-key");           // browsers

  if (password) {
    if (password === env.NEXUS_PASSWORD) return context.next();
    await addFail(env.DB, ip);
  } else if (token && (await validToken(env.DB, token))) {
    return context.next();
  }
  return json({ error: "login needed" }, 401);
}
