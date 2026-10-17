// ============================================================
//  router.js — decides WHICH AI answers your message
// ============================================================
//
//  Idea from the FrugalGPT + RouteLLM papers:
//  send each question to the best free model for that job,
//  and if it fails (limit reached, server down) try the next one.

import { PROVIDERS, getProvider, isReady } from "./providers.js";

// Normal order: fastest first, then the rest as backups
const DEFAULT_ORDER = ["groq", "gemini", "cerebras", "zai", "mistral", "openrouter", "nvidia", "cloudflare", "ollama"];

// Coding questions: models that are best at code go first
const CODE_ORDER = ["groq", "zai", "nvidia", "openrouter", "mistral", "cerebras", "gemini", "cloudflare", "ollama"];

// Very long chats: only Gemini can read 1 million tokens, so it goes first
const LONG_ORDER = ["gemini", "groq", "zai", "mistral", "cerebras", "openrouter", "nvidia", "cloudflare", "ollama"];

// Messages with images: only models that can SEE (provider, model)
const VISION = [
  ["gemini", "gemini-flash-latest"],
  ["openrouter", "google/gemma-4-31b-it:free"],
  ["zai", "glm-4.6v-flash"],
  ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
  ["cloudflare", "@cf/meta/llama-3.2-11b-vision-instruct"],
];

export function planVision(env) {
  return VISION.map(([id, model]) => ({ provider: getProvider(id), model: model }))
    .filter((step) => isReady(step.provider, env));
}

// Words that hint the message is about code
const CODE_WORDS = ["```", "code", "function", "error", "bug", "python", "javascript", "html", "css", "sql", "script", "debug", "api"];

// Returns a list like [ {provider, model}, {provider, model}, ... ]
// NEXUS tries them one by one until one works.
//   choice  = "auto"            → NEXUS decides
//   choice  = "groq/llama-3.3…" → you picked a model, try it first
//   options = { scores: {groq: 1040, ...}  → your ratings (ratings.js): best-rated first
//               avoid: "groq"               → 🔄 regenerate: try a DIFFERENT AI first
//               fast: true }                → small talk: the quickest small model first
export function planRoute(env, messages, choice, options) {
  const opts = options || {};
  const plan = basePlan(env, messages, choice, opts.scores || {});
  if (opts.fast) {
    const groq = getProvider("groq");
    if (isReady(groq, env)) plan.unshift({ provider: groq, model: "openai/gpt-oss-20b" });
  }
  if (opts.avoid) return plan.filter((s) => s.provider.id !== opts.avoid).concat(plan.filter((s) => s.provider.id === opts.avoid));
  return plan;
}

// Sort providers by your ratings (unrated ones count as 1000; equal scores keep the original order)
function byScore(order, scores) {
  return order.map((id, i) => ({ id, i })).sort((a, b) => (scores[b.id] || 1000) - (scores[a.id] || 1000) || a.i - b.i).map((x) => x.id);
}

function basePlan(env, messages, choice, scores) {
  const plan = [];

  // 1. If you picked a specific model, put it at the front
  if (choice && choice !== "auto" && choice.includes("/")) {
    const slash = choice.indexOf("/");
    const provider = getProvider(choice.slice(0, slash));
    if (provider && isReady(provider, env)) {
      plan.push({ provider: provider, model: choice.slice(slash + 1) });
    }
  }

  // 2. Pick the order based on what the message looks like
  const lastText = messages[messages.length - 1].content.toLowerCase();
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);

  let order = byScore(DEFAULT_ORDER, scores);
  if (totalChars > 300000) order = LONG_ORDER;                     // only Gemini can read that much: keep it first
  else if (CODE_WORDS.some((w) => lastText.includes(w))) order = byScore(CODE_ORDER, scores);

  // 3. Add every provider that has a key, with all its models (default first).
  //    chat.js skips the rest of a provider if its key or limit fails.
  for (const id of order) {
    const provider = getProvider(id);
    if (provider && isReady(provider, env)) {
      for (const model of provider.models) plan.push({ provider: provider, model: model });
    }
  }
  return plan;
}

// Every model you can pick in the dropdown (only providers with keys)
export function availableModels(env) {
  const list = [];
  for (const p of PROVIDERS) {
    if (!isReady(p, env)) continue;
    for (const m of p.models) list.push({ id: p.id + "/" + m, provider: p.name, model: m });
  }
  return list;
}
