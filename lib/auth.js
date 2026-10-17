// ============================================================
//  auth.js — who is allowed to use your NEXUS
// ============================================================
//  Two ways in:
//   1. Browser: log in once with the password → gets a random TOKEN.
//      The browser keeps only the token (header x-nexus-key), never the password.
//      "Log out everywhere" deletes all tokens.
//   2. Scripts (D drive backup, GitHub bot): send the password itself
//      (header x-nexus-password).
//  10 wrong passwords from one internet address → locked for 15 minutes.

const MAX_FAILS = 10;
const LOCK_MINUTES = 15;

export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "local";
}

export async function isLocked(db, ip) {
  const row = await db.prepare("SELECT count, first FROM login_fails WHERE ip = ?").bind(ip).first();
  if (!row) return false;
  if (Date.now() - row.first > LOCK_MINUTES * 60000) {      // old fails expire
    await db.prepare("DELETE FROM login_fails WHERE ip = ?").bind(ip).run();
    return false;
  }
  return row.count >= MAX_FAILS;
}

export async function addFail(db, ip) {
  await db.prepare(`INSERT INTO login_fails (ip, count, first) VALUES (?, 1, ?)
                    ON CONFLICT(ip) DO UPDATE SET count = count + 1`).bind(ip, Date.now()).run();
}

export async function clearFails(db, ip) {
  await db.prepare("DELETE FROM login_fails WHERE ip = ?").bind(ip).run();
}

// A long random token like "3f9a…" (impossible to guess)
export async function newSession(db, device) {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT INTO sessions (token, device, created, last_used) VALUES (?, ?, ?, ?)")
    .bind(token, device.slice(0, 120), Date.now(), Date.now()).run();
  return token;
}

export async function validToken(db, token) {
  const row = await db.prepare("SELECT token FROM sessions WHERE token = ?").bind(token).first();
  return Boolean(row);
}
