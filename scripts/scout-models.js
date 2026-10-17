// ============================================================
//  scout-models.js — are NEXUS's models still available? any new free ones?
// ============================================================
//  Runs weekly on GitHub (.github/workflows/model-scout.yml), or by hand:
//    GROQ_API_KEY=... node scripts/scout-models.js
//  1. Reads the model names configured in lib/providers.js
//  2. Asks each provider for its CURRENT model list (using your keys from GitHub secrets)
//  3. Reports: ❌ configured models that disappeared (retired / renamed)
//              💡 new free models worth adding
//              🆕 free providers NEXUS doesn't use yet (from mnfst/awesome-free-llm-apis)
//  Writes scout-report.md and scout-broken.txt (number of missing models).

const fs = require("fs");
const env = process.env;

// --- 1. what NEXUS uses (simple text reading of providers.js) ---
function configuredModels() {
  const text = fs.readFileSync("lib/providers.js", "utf8");
  const result = {};
  const blocks = text.split(/\n  \{\n/).slice(1);
  for (const block of blocks) {
    const id = (block.match(/id: "([^"]+)"/) || [])[1];
    const list = (block.match(/models: \[([\s\S]*?)\]/) || [])[1];
    if (id && list) result[id] = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }
  return result;
}

async function getJson(url, headers) {
  const res = await fetch(url, { headers: { "User-Agent": "NEXUS-model-scout", ...(headers || {}) } });
  if (!res.ok) throw new Error(res.status + " " + url);
  return res.json();
}
const bearer = (key) => ({ Authorization: "Bearer " + key });

// --- 2. what each provider offers right now ---
const LISTS = {
  groq: async () => env.GROQ_API_KEY && (await getJson("https://api.groq.com/openai/v1/models", bearer(env.GROQ_API_KEY))).data.map((m) => m.id),
  openrouter: async () => (await getJson("https://openrouter.ai/api/v1/models")).data.map((m) => m.id),
  nvidia: async () => env.NVIDIA_API_KEY && (await getJson("https://integrate.api.nvidia.com/v1/models", bearer(env.NVIDIA_API_KEY))).data.map((m) => m.id),
  gemini: async () => env.GEMINI_API_KEY &&
    (await getJson("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + env.GEMINI_API_KEY)).models.map((m) => m.name.replace("models/", "")),
  cloudflare: async () => env.CF_API_TOKEN && env.CF_ACCOUNT_ID &&
    (await getJson("https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/ai/models/search?per_page=300", bearer(env.CF_API_TOKEN))).result.map((m) => m.name),
  zai: async () => env.ZAI_API_KEY && (await getJson("https://api.z.ai/api/paas/v4/models", bearer(env.ZAI_API_KEY))).data.map((m) => m.id),
};

const SKIP = /whisper|guard|orpheus|tts|embed|rerank|safeguard|vision-?only|moderation|image|flux|stable-diffusion|clip/i;

// Some providers don't LIST all their models (Z.ai hides its free ones), so before calling a
// model "missing" we send it a tiny real request. Only models that really fail are reported.
const CHAT = {
  groq: () => ["https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY],
  openrouter: () => ["https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY],
  nvidia: () => ["https://integrate.api.nvidia.com/v1/chat/completions", env.NVIDIA_API_KEY],
  gemini: () => ["https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", env.GEMINI_API_KEY],
  cloudflare: () => ["https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/ai/v1/chat/completions", env.CF_API_TOKEN],
  zai: () => ["https://api.z.ai/api/paas/v4/chat/completions", env.ZAI_API_KEY],
};
async function reallyWorks(id, model) {
  const [url, key] = CHAT[id]();
  if (!key) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bearer(key) },
    body: JSON.stringify({ model: model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 20 }),
  }).catch(() => null);
  return Boolean(res && (res.ok || res.status === 429));   // 429 = busy, but the model exists
}

(async () => {
  const mine = configuredModels();
  let report = "# 🔭 NEXUS model scout — " + new Date().toISOString().slice(0, 10) + "\n\n";
  let missingCount = 0;

  for (const [id, models] of Object.entries(mine)) {
    if (!LISTS[id]) continue;                      // ollama, mistral, cerebras… not checked
    let live;
    try { live = await LISTS[id](); } catch (e) { report += "## " + id + "\n⚠️ Could not get the model list: " + e.message + "\n\n"; continue; }
    if (!live) { report += "## " + id + "\n➖ No key in GitHub secrets — skipped\n\n"; continue; }

    const liveSet = new Set(live);
    const unlisted = models.filter((m) => !liveSet.has(m) && !/-latest$/.test(m));   // "-latest" aliases aren't listed
    const missing = [];
    for (const m of unlisted) if (!(await reallyWorks(id, m))) missing.push(m);
    missingCount += missing.length;
    let extra = live.filter((m) => !models.includes(m) && !SKIP.test(m));
    if (id === "openrouter") extra = extra.filter((m) => m.endsWith(":free"));        // NEXUS only uses free ones
    report += "## " + id + "\n" +
      (missing.length ? "❌ **Missing (retired or renamed):** " + missing.map((m) => "`" + m + "`").join(", ") + "\n" : "✅ All configured models are available\n") +
      (extra.length ? "💡 Other models available: " + extra.slice(0, 15).map((m) => "`" + m + "`").join(", ") + (extra.length > 15 ? " …" : "") + "\n" : "") + "\n";
  }

  // --- 3. free providers NEXUS doesn't use yet ---
  try {
    const data = await getJson("https://raw.githubusercontent.com/mnfst/awesome-free-llm-apis/main/data.json");
    const known = ["groq", "google", "gemini", "openrouter", "nvidia", "cloudflare", "z.ai", "zhipu", "mistral", "cerebras", "ollama"];
    const fresh = data.providers.filter((p) => p.category === "provider_api" && !known.some((k) => p.name.toLowerCase().includes(k)));
    report += "## 🆕 Other free providers (from mnfst/awesome-free-llm-apis, updated " + (data.lastUpdated || "?") + ")\n" +
      fresh.slice(0, 12).map((p) => "- **" + p.name + "** — " + (p.description || "").slice(0, 140) + " ([link](" + p.url + "))").join("\n") + "\n";
  } catch (e) {
    report += "## 🆕 Other free providers\n⚠️ Could not read the free-provider list: " + e.message + "\n";
  }

  report += "\n---\nTo fix a ❌: edit the `models:` list for that provider in `lib/providers.js`, then deploy.\n";
  fs.writeFileSync("scout-report.md", report);
  fs.writeFileSync("scout-broken.txt", String(missingCount));
  console.log(report);
})();
