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

// Coding / ML-library questions: models that are best at code go first
const CODE_ORDER = ["groq", "cloudflare", "zai", "nvidia", "openrouter", "mistral", "cerebras", "gemini", "ollama"];

// For code, some providers have a better model than their default — try that one first
const CODE_MODELS = {
  // (Cloudflare qwen3.8-27b was tested: good code but thinks for ~3 minutes — too slow)
  groq: "openai/gpt-oss-120b",
};

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

// Words that hint the message is about code (incl. ML libraries)
const CODE_WORDS = ["```", "code", "function", "error", "bug", "python", "javascript", "html", "css", "sql", "script", "debug", "api",
  "pytorch", "torch", "tensorflow", "keras", "numpy", "pandas", "sklearn", "scikit", "traceback", "exception", "implement",
  "def ", "class ", "import ", "jupyter", "notebook", "cuda", "dataframe", "huggingface", "transformers"];

// Returns a list like [ {provider, model}, {provider, model}, ... ]
// NEXUS tries them one by one until one works.
//   choice  = "auto"            → NEXUS decides
//   choice  = "groq/llama-3.3…" → you picked a model, try it first
//   options = { scores: {groq: 1040, ...}  → your ratings (ratings.js): best-rated first
//               avoid: "groq"               → 🔄 regenerate: try a DIFFERENT AI first
//               fast: true }                → small talk: the quickest small model first
export function planRoute(env, messages, choice, options) {
  const opts = options || {};
  const plan = basePlan(env, messages, choice, opts.scores || {}, opts.code);
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

// forceCode: the 🔬 deep modes always write code (checks, experiments) → use the code order
function basePlan(env, messages, choice, scores, forceCode) {
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

  const isCode = forceCode || CODE_WORDS.some((w) => lastText.includes(w));
  let order = byScore(DEFAULT_ORDER, scores);
  if (totalChars > 300000) order = LONG_ORDER;                     // only Gemini can read that much: keep it first
  else if (isCode) order = byScore(CODE_ORDER, scores);

  // 3. Add every provider that has a key, with all its models (default first; for code, its code model first).
  //    chat.js skips the rest of a provider if its key or limit fails.
  for (const id of order) {
    const provider = getProvider(id);
    if (provider && isReady(provider, env)) {
      const models = isCode && CODE_MODELS[id] ? [CODE_MODELS[id]].concat(provider.models.filter((m) => m !== CODE_MODELS[id])) : provider.models;
      for (const model of models) plan.push({ provider: provider, model: model });
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
