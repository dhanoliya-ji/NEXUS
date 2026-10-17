// ============================================================
//  _middleware.js — runs BEFORE every /api/... request
// ============================================================
//  Job 1: check your password, so strangers can't use your NEXUS
//  Job 2: make sure the database tables exist

import { setupDatabase, json } from "../../lib/db.js";

export async function onRequest(context) {
  const env = context.env;

  // Password check (skipped if you didn't set one, e.g. on your laptop)
  if (env.NEXUS_PASSWORD) {
    const sent = context.request.headers.get("x-nexus-key");
    if (sent !== env.NEXUS_PASSWORD) return json({ error: "wrong password" }, 401);
  }

  await setupDatabase(env.DB);
  return context.next();   // all good → continue to the real route
}
