# NEXUS

My personal AI agent. It's built only from free tools, so it costs ₹0 to run.

NEXUS connects many free AI models (Groq, Gemini, GLM, Mistral, Cerebras, OpenRouter, GitHub Models, Ollama…) behind one clean, Claude-style chat page. It picks the best model for each question. If one hits its limit it switches to the next, and it remembers you across all your chats.

## Features

| Feature | How it works | Idea from |
|---|---|---|
| **10 free AI providers** | One simple function talks to all of them | OpenAI-compatible APIs |
| **Smart router + auto-fallback** | Code questions go to code models, long chats go to Gemini (1M tokens), and it moves to the next model when one is busy | FrugalGPT, RouteLLM papers |
| **Council mode** | 3 AIs answer, then a judge combines the best answer | Mixture-of-Agents paper |
| **Memory across chats** | An auto-updating "About me" profile, plus a search over old chats before every answer | MemGPT, RAG papers |
| **Image generation** | Type `/image a cat astronaut` | Pollinations.ai (free) |
| **Doctor** | Checks which API keys work | REA repo |
| **Daily backup to D drive** | `local/backup.py` | — |
| **Works on phone** | Open the link, then "Add to Home screen" | — |

## Quick start

- **First time:** follow [SETUP.md](SETUP.md).
- **To understand the code:** read [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

```bash
npm install          # once
npm run dev          # run on your laptop → http://localhost:8788
npm run deploy       # upload to Cloudflare (your public link)
npm run check        # check code for mistakes and leaked keys
```

## Folders

```
web/         the website (HTML, CSS, JS) — what you see
functions/   the backend — each file is one /api/... address
lib/         shared brain code: providers, router, memory, database
local/       laptop-only scripts (D drive backup)
scripts/     code checker
```
