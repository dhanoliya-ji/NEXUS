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
| **10 free tools** | Web search, read web page, Wikipedia, weather, currency, crypto, dictionary, news, arXiv papers, books. A small model decides which ones a question needs. Every tool has backup sources | Toolformer, ReAct papers; public-apis repo |
| **Deep Research** | `/research topic`: plan → search → read 8 pages → report with [1] citations | gpt-researcher repo, STORM paper |
| **💻 My PC models** | On your laptop, the website can also use Ollama models: private and offline | — |
| **Image generation** | Type `/image a cat astronaut` | Pollinations.ai (free) |
| **🎤 Voice + 🔊 read aloud** | Speak in Hindi or English (Groq Whisper), and NEXUS reads answers aloud | — |
| **📎 Attachments** | Images (vision models), PDF, Word, code and text files | — |
| **📚 Documents library** | Upload once; every chat searches the matching parts | RAG paper |
| **✅ Careful mode** | One model drafts, another checks and fixes it | Chain-of-Verification, Reflexion papers |
| **🧩 Skills** | Teacher, Coder, Hinglish, Quiz me… or make your own | REA skills, Voyager paper |
| **📝 Long-chat summaries** | Older parts of long chats are summarized automatically | MemGPT paper |
| **⬇️ Export** | Download a chat as Markdown or PDF | — |
| **⏰ Reminders** | "Remind me tomorrow at 9…" sends a phone push via ntfy.sh, checked every 10 minutes by a GitHub Action | — |
| **🎨 Images window** | Styles, sizes, prompt improvement and a gallery | Pollinations.ai |
| **📊 Usage** | Answers per AI today vs. its free daily limit, plus a 7-day chart | — |
| **🔐 Safety** | Browsers keep a login token, not your password. Log out everywhere. 10 wrong passwords = 15-minute lock | — |
| **📱 Phone app** | Installable, opens offline, "Share to NEXUS" from other apps | PWA |
| **➗ Math** | Formulas are drawn with KaTeX | — |
| **📊 Charts** | NEXUS writes a small chart description and the site draws it (Chart.js), with a table view and PNG download | — |
| **▶ Run Python** | Python code in answers runs in your browser (Pyodide, with numpy, pandas and matplotlib) | — |
| **📌 Pins and 📁 folders** | Organize chats in the sidebar | — |
| **⚡ Live progress** | The answer bubble shows each step ("🔎 Searching the web…") immediately | — |
| **🤖 Weekly bot** | A GitHub Action checks every key each Monday and opens an issue if one breaks | — |
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

## Credits

NEXUS reuses open-source work. Thank you to:

| Project | Used for | License |
|---|---|---|
| [danielmiessler/fabric](https://github.com/danielmiessler/fabric) | 250+ expert prompts in the 🧩 skills library | MIT |
| [f/prompts.chat](https://github.com/f/prompts.chat) | 300 "act as…" personas in the skills library | CC0 |
| [alirezadir/AIMLInterviews](https://github.com/alirezadir/AIMLInterviews) | 🗺️ roadmap topics and interview questions | MIT |
| [karpathy/micrograd](https://github.com/karpathy/micrograd), [nanoGPT](https://github.com/karpathy/nanoGPT), [minbpe](https://github.com/karpathy/minbpe) | 📚 tiny reference implementations shown by the 🔍 source mode (fetched live, not copied) | MIT |
| [labmlai/annotated_deep_learning_paper_implementations](https://github.com/labmlai/annotated_deep_learning_paper_implementations) | 📚 annotated paper implementations (fetched live) | MIT |
| [Sourcegraph](https://sourcegraph.com/search) public code search | finding where a class or function lives in PyTorch, scikit-learn, transformers… | free service |
| Hugging Face models via Cloudflare Workers AI | Qwen3-Embedding (meaning search), BAAI bge-reranker | Apache-2.0 / MIT |
| Ideas from research papers | Mem0, Zep, LongMemEval, CRAG, Adaptive-RAG, RAG-Fusion, Mixture-of-Thought cascades, SelfCheckGPT, Chatbot Arena, ACE, Universal Self-Consistency, STORM | — |
