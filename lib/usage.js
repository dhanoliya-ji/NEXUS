// ============================================================
//  usage.js — counts how many times each AI answered (per day)
// ============================================================
//  Shown in the 📊 Usage window so you can see how close you are to
//  each provider's FREE daily limit. Limits below are approximate
//  (providers change them) — they're only for the progress bars.

export const DAILY_LIMITS = {
  groq: 1000,          // about 1,000 requests/day for big models
  gemini: 250,         // Flash free tier, roughly
  openrouter: 50,      // ":free" models without credits
  zai: null,           // no clear daily limit, but 1 request at a time
  nvidia: null,        // limited per minute (~40/min), not per day
  cloudflare: 300,     // 10,000 "neurons"/day ≈ a few hundred answers
  mistral: null,
  cerebras: null,
  ollama: null,        // your own PC: unlimited
};

// Today's date in India time, like "2026-10-17"
export function today() {
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}

// +1 for this provider + model today (never let a counting error break a chat)
export async function recordUse(env, providerId, model) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(`INSERT INTO usage (day, provider, model, count) VALUES (?, ?, ?, 1)
                          ON CONFLICT(day, provider, model) DO UPDATE SET count = count + 1`)
      .bind(today(), providerId, model).run();
  } catch (e) { /* ignore */ }
}
