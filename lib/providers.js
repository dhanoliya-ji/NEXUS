// ============================================================
//  providers.js — the list of every free AI that NEXUS can use
// ============================================================
//
//  Almost every AI company accepts the SAME request format
//  (called "OpenAI-compatible"). So each provider only needs:
//    url    → where to send the question
//    key    → the name of its secret key in .dev.vars
//    models → model names we can ask for (first one = default)
//    chars  → how much text it can read at once (about 4 chars = 1 token)
//
//  To add a new provider: copy one block, change the values. That's it.

export const PROVIDERS = [
  {
    id: "groq",
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    key: "GROQ_API_KEY",
    models: ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"],
    chars: 400000,           // 131k tokens
  },
  {
    id: "gemini",
    name: "Google Gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    key: "GEMINI_API_KEY",
    models: ["gemini-flash-latest", "gemini-3.8-flash", "gemini-flash-lite-latest"],
    chars: 3500000,          // 1 million tokens — the biggest memory of all
  },
  {
    id: "zai",
    name: "Z.ai GLM",
    url: "https://api.z.ai/api/paas/v4/chat/completions",
    key: "ZAI_API_KEY",
    models: ["glm-4.7-flash", "glm-4.5-flash"],
    chars: 400000,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    key: "CEREBRAS_API_KEY",
    models: ["gpt-oss-120b", "llama-3.3-70b"],
    chars: 200000,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: "OPENROUTER_API_KEY",
    // only ":free" models! (list changes often: https://openrouter.ai/models?max_price=0)
    models: ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3-ultra-550b-a55b:free"],
    chars: 200000,
  },
  {
    id: "mistral",
    name: "Mistral",
    url: "https://api.mistral.ai/v1/chat/completions",
    key: "MISTRAL_API_KEY",
    models: ["mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
    chars: 400000,
  },
  {
    id: "nvidia",
    name: "NVIDIA NIM",
    url: "https://integrate.api.nvidia.com/v1/chat/completions",
    key: "NVIDIA_API_KEY",
    // free accounts: Nemotron + gpt-oss answer fast; DeepSeek/GLM are often slow (kept as backups)
    models: ["nvidia/nemotron-3-super-120b-a12b", "openai/gpt-oss-20b", "deepseek-ai/deepseek-v4.1-flash", "z-ai/glm-5.3"],
    chars: 200000,
  },
  {
    id: "cloudflare",
    name: "Cloudflare AI",
    url: (env) => `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1/chat/completions`,
    key: "CF_API_TOKEN",
    models: ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"],
    chars: 80000,
  },
  {
    // Only works when NEXUS runs on your laptop (Ollama lives on your PC)
    id: "ollama",
    name: "Ollama (my PC)",
    url: (env) => env.OLLAMA_URL,
    key: "OLLAMA_URL",       // no real key needed, we just check the URL is set
    noAuth: true,
    models: ["qwen3:4b", "qwen2.5:1.5b", "llama3.2:1b"],
    chars: 30000,
    wait: 120000,            // your PC needs time to load a model the first time
  },
];

// Find a provider by its id, e.g. getProvider("groq")
export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

// A provider is "ready" when its secret key exists
export function isReady(provider, env) {
  return Boolean(env[provider.key]);
}

// Send messages to one provider + model.
// stream = true  → the answer arrives word by word (for chatting)
// stream = false → we wait for the full answer (for background jobs)
export async function callModel(env, provider, model, messages, stream, maxTokens) {
  const url = typeof provider.url === "function" ? provider.url(env) : provider.url;

  const headers = { "Content-Type": "application/json" };
  if (!provider.noAuth) headers["Authorization"] = "Bearer " + env[provider.key];

  const body = { model: model, messages: trimToFit(messages, provider.chars), stream: stream };
  if (maxTokens) body.max_tokens = maxTokens;

  return fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(provider.wait || (stream ? 30000 : 60000)), // give up if no reply
  });
}

// Ask a model and wait for the full text answer (not streaming).
// Returns the text, or throws an error if it failed.
export async function askModel(env, provider, model, messages, maxTokens) {
  const res = await callModel(env, provider, model, messages, false, maxTokens);
  if (!res.ok) throw new Error(provider.name + " said " + res.status);
  const data = await res.json();
  return data.choices[0].message.content || "";
}

// If the chat is too long for this model, drop the OLDEST messages
// but always keep the system message (first) and the newest messages.
function trimToFit(messages, maxChars) {
  const system = messages[0].role === "system" ? [messages[0]] : [];
  const rest = messages.slice(system.length);

  let total = system.length ? system[0].content.length : 0;
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i--) {   // walk backwards from newest
    total += rest[i].content.length;
    if (total > maxChars && kept.length > 0) break;
    kept.unshift(rest[i]);
  }
  return system.concat(kept);
}
