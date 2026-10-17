# How NEXUS works: explained so you can write it yourself

## The big picture

```
 ┌──────────── your browser (web/) ─────────────┐
 │  index.html  = the page layout               │
 │  style.css   = colors, fonts, spacing        │
 │  app.js      = buttons, sending, showing     │
 └──────────────────────┬───────────────────────┘
                        │ fetch("/api/chat")
 ┌──────────── Cloudflare (functions/) ─────────┐
 │  _middleware.js  checks password             │
 │  chat.js         the main brain              │
 │      uses lib/router.js    → which AI?       │
 │      uses lib/providers.js → call the AI     │
 │      uses lib/memory.js    → remember you    │
 │      uses lib/db.js        → save to D1      │
 └──────────────────────┬───────────────────────┘
                        │ fetch("https://api.groq.com/...")
              Groq · Gemini · GLM · Mistral · ...
```

**Rule of Cloudflare Pages:** the file `functions/api/chat.js` automatically answers the web address `/api/chat`. Inside it, `onRequestPost` handles POST requests and `onRequestGet` handles GET requests. That's the whole routing system.

## 1. Talking to an AI (the most important idea)

Every provider accepts the same request. Here it is with nothing else around it:

```js
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + MY_KEY },
  body: JSON.stringify({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: "You are a helpful assistant." },   // instructions
      { role: "user", content: "What is 2+2?" }                      // your question
    ]
  })
});
const data = await res.json();
console.log(data.choices[0].message.content);   // → "2+2 equals 4."
```

To use a different provider, **change only the URL, key and model name.** That's why `lib/providers.js` is just a list.

**The AI has no memory.** Each request must include the whole conversation in `messages`, with `user` and `assistant` messages taking turns. NEXUS sends the full history every time.

## 2. Streaming (words appear one by one)

Add `stream: true` to the request. Instead of one JSON answer, you get many small lines:

```
data: {"choices":[{"delta":{"content":"2+2"}}]}
data: {"choices":[{"delta":{"content":" equals"}}]}
data: [DONE]
```

`app.js` reads these lines in a loop (`reader.read()`), adds each `delta.content` to the answer, and redraws the message. The backend doesn't touch the stream. It passes `res.body` straight to the browser, which keeps it fast and inside Cloudflare's free limits.

## 3. The router (`lib/router.js`)

1. If you picked a model in the dropdown, it goes first.
2. Otherwise NEXUS picks an order:
   - The chat is longer than about 300k characters → **Gemini** first, because it can read 1M tokens.
   - The message has code words → **GLM / Groq** first.
   - Everything else → **Groq** first, because it's the fastest.
3. `chat.js` tries each one in a `for` loop. When one works, it returns that answer. When one fails:
   - **401/403** (bad key) or **429** (limit reached) → skip that provider completely.
   - **404** (model not found) → try the same provider's next model.

## 4. Memory (`lib/memory.js`)

**Layer 1, the profile:** after every answer, `messages.js` calls `updateProfile()` in the background (`waitUntil`). A small, fast model reads your message and answers with an updated bullet list of facts about you, or `NO_CHANGE`. The list is saved in the `profile` table. You can view and edit it with the 🧠 Memory button.

**Layer 2, search:**
1. Before answering, `searchMemory()` takes the important words from your message.
2. It searches all old messages using SQLite's full-text search (`messages_fts`, ranked by BM25).
3. The top 5 matches from other chats go into the instructions.

**The system prompt** (`buildSystemPrompt`) puts these first: who NEXUS is, today's date, your profile, and the related memories. Then comes the conversation. Models pay the most attention to the start and end of a long text (the "Lost in the Middle" paper), so important information goes at the start.

## 5. The database (`lib/db.js`)

D1 is SQLite running on Cloudflare, with 5 GB free.

| Table | Columns |
|---|---|
| `chats` | id, title, created, updated |
| `messages` | id, chat_id, role, content, model, created |
| `profile` | id=1, text |
| `messages_fts` | Search index. Two **triggers** keep it updated automatically whenever a message is added or deleted |

The tables are created automatically the first time (`CREATE TABLE IF NOT EXISTS`), so there's no manual setup.

SQL with `?` placeholders keeps the database safe:

```js
db.prepare("SELECT * FROM messages WHERE chat_id = ?").bind(chatId).all()
```

## 6. Council mode (`functions/api/council.js`)

1. `Promise.allSettled([...])` asks 3 models **at the same time** (non-streaming).
2. All 3 answers go to a "judge" model with this instruction: *"write one answer better than each of these"*.
3. The judge's answer is streamed back to you.

## 6b. Tools (`lib/tools.js`)

Each tool is a function: **text in, text out**. For example, `weather("Jaipur")` returns the forecast as text.

**How NEXUS decides which tools to use** (`useTools`):
1. A small, fast model gets the tool list plus your last messages, and replies with JSON such as `{"tools":[{"name":"weather","input":"Jaipur"}]}`.
2. The chosen tools run **at the same time** (`Promise.allSettled`).
3. Their results are added to the system prompt under "FRESH RESULTS FROM TOOLS".
4. The big model answers using them and cites the sources.

**Backups:** `firstWorking([way1, way2, way3])` tries each way until one works. Free services sometimes block Cloudflare's servers, so every tool has 2 or 3 sources. Search results also pass `looksRelevant()`, which throws away junk.

**Add a tool:** write `async function myTool(input) { ... return "text" }`, then add `my_tool: { about: "...", run: myTool }` to `TOOLS`. Test it at `/api/tool?name=my_tool&input=hello`.

## 6c. Deep Research (`functions/api/research.js`)

1. **Plan:** a fast model writes 4 search queries.
2. **Search:** all 4 at once, keeping the best 3 links each (8 max).
3. **Read:** Jina Reader downloads all 8 pages at once.
4. **Write:** Gemini (1M tokens) reads everything and writes a report citing [1], [2]…

## 6d. 💻 My PC models

Cloudflare can't reach your laptop, but your browser can.
1. When the page loads, `findMyPCModels()` asks `http://localhost:11434/api/tags`. If Ollama answers, its models appear in the dropdown.
2. When you choose one, the browser first calls `/api/context`. That saves your message and returns the system prompt with memory and tools.
3. The browser then streams the answer from Ollama directly.

For this to work, Ollama must trust the site. The Windows setting `OLLAMA_ORIGINS` lists the NEXUS link, and models are stored on `D:\OllamaModels` (`OLLAMA_MODELS`).

## 6e. Documents library (RAG): `functions/api/docs.js`

1. Your browser turns the PDF or Word file into text (the same code as 📎).
2. The server cuts it into parts of about 1,500 characters at paragraph ends and saves them in `doc_chunks`. A search index (`doc_chunks_fts`) updates itself through triggers.
3. Before every answer, `searchDocs()` finds the 4 best-matching parts and adds them to the instructions with the document's name.

Small parts work better than whole documents: NEXUS adds only the paragraphs that matter.

## 6f. Careful mode (`functions/api/careful.js`)

1. **Draft:** `askFirst()` gets an answer from the first model that works.
2. **Check:** a **different** provider gets the draft with this instruction: *"check facts, logic, math, code, then write the corrected final answer."*

It's slower, with two models instead of one, but it makes fewer mistakes.

## 6g. Skills (`lib/skills.js`)

A skill is extra instructions placed near the top of the system prompt. The built-in skills are a list in `lib/skills.js`, and your own skills are saved in the `skills` table. The browser remembers the active skill and sends its id with every message.

## 6h. Long-chat summaries (`lib/summary.js`)

1. After an answer, in the background, if the chat is longer than 40,000 characters, a helper model summarizes everything except the newest 12 messages.
2. The summary is saved in `chat_summaries` and added to the instructions.
3. So when a smaller model has to drop old messages (`trimToFit`), the important facts are still in the summary.

## 6i. `lib/run.js`

`streamFirst(plan, messages)` and `askFirst(...)` hold the "try each model until one works" loop, so chat, Careful mode and the others share it instead of copying it.

## 7. The website (`web/app.js`)

| Function | What it does |
|---|---|
| `api(path, method, body)` | Calls the backend and adds the password header. If the answer is 401, it shows the password pop-up |
| `loadChats()`, `drawChatList()` | Fill the sidebar |
| `openChat(id)` | Loads the messages and draws them |
| `send(text)` | Creates the chat if it's new, shows your message, then calls `askAI()` or `makeImage()` |
| `askAI()` | Reads the stream and draws the answer live, then saves it with `/api/messages` |
| `toHtml()` | Turns markdown into HTML with `marked`, then cleans it with `DOMPurify` so a bad answer can't run scripts |

`/image ...` doesn't need the backend at all. It builds a Pollinations.ai image URL, and the free service draws the picture.

## 8. Login and safety (`lib/auth.js`)

`_middleware.js` runs before every `/api` request.
- **Browsers** log in once at `/api/login`. The server checks the password and returns a long random **token**, saved in the `sessions` table. The browser keeps only the token and sends it as the `x-nexus-key` header.
- **Scripts** (the D drive backup and the GitHub bots) send the password as the `x-nexus-password` header.
- **Wrong passwords** are counted per internet address in `login_fails`. After 10 within 15 minutes, that address gets "429 locked".
- **Log out everywhere** deletes every row in `sessions`, so every device must log in again.

## 9. Math (KaTeX)

In `toHtml()` in `app.js`:
1. Code blocks are hidden first.
2. `$…$`, `$$…$$`, `\(…\)` and `\[…\]` are drawn with KaTeX, and each leaves a placeholder.
3. Markdown is converted.
4. The placeholders are replaced with the drawn formulas.

A `$` followed by a digit, or with a space just inside it, counts as money, so "$5 and $10" stays normal text.

## 10. Reminders (`lib/reminders.js`)

1. **The `set_reminder` tool:** the tool-picker gets the current India time, so "tomorrow at 9am" becomes `2026-10-18 09:00 | call Rohan`.
2. **Saving:** the reminder goes into the `reminders` table, with `due` stored in UTC milliseconds.
3. **Sending:** a GitHub Action (`.github/workflows/reminders.yml`) calls `/api/reminders/run` every 10 minutes. Due reminders are sent with `POST https://ntfy.sh/<your topic>`, and the ntfy app on your phone shows them.
4. **While the website is open**, it also checks every minute and shows a notification.

## 11. Usage (`lib/usage.js`)

`callModel()` adds 1 to the `usage` table (day, provider, model) after every successful answer. `/api/usage` adds up today's counts and compares them with the approximate free limits.

## 12a. Live progress (`lib/live.js`)

`liveStream()` returns the stream to the browser **immediately**, then sends small messages while it works:
- `data: {"nexus_status": "🔎 Searching the web…"}`: what NEXUS is doing right now
- `data: {"nexus_info": {model, memories, docs, tools}}`: which model answered
- `data: {"nexus_error": "..."}`: something failed

After that comes the AI provider's own stream, copied through with `live.pipe(res.body)`. `context.waitUntil()` keeps the server working after the first bytes have been sent. In `app.js`, the stream-reading loop shows a status line until the first words arrive.

## 12b. Charts and ▶ Python (`web/runners.js`)

- **Charts:** the system prompt tells models to write a ```` ```chart ```` block containing simple JSON (type, labels, series). `decorateCode()` finds `code.language-chart` and replaces it with a Chart.js chart. The colors come from a colorblind-checked palette, in a fixed order, with separate light and dark versions. 📋 Table shows the exact numbers.
- **Python:** every ```` ```python ```` block gets a ▶ Run button. Pyodide is Python compiled to run in the browser:
  1. The first run downloads it, which takes about 10 s.
  2. `loadPackagesFromImports()` fetches numpy, pandas and the like automatically.
  3. `print()` output and matplotlib charts (saved as PNG) appear under the code.
  4. It all runs on your device, with no server involved.

## 12c. Pins and folders

The `chats` table got two new columns: `pinned` and `folder`. `setupDatabase()` tries `ALTER TABLE … ADD COLUMN` and ignores the error if the column already exists. `PATCH /api/chats/:id` changes the title, pin or folder. `drawChatList()` groups the chats as 📌 Pinned, then each 📁 folder, then Recent.

## 12. Phone app (`web/sw.js`, `manifest.json`)

- The **service worker** keeps a copy of the website files. When you're online it loads the newest files and refreshes the copy; when you're offline it shows the saved copy. It never saves `/api` requests.
- `share_target` in the manifest puts "NEXUS" in the phone's Share menu, which opens `/?text=…`, and that text goes into the message box.

## How to add things yourself

- **New AI provider:** copy a block in `lib/providers.js`, change the url, key, models and chars, then add its id to the orders in `lib/router.js`. Add the key to `.dev.vars`.
- **New API route:** create `functions/api/hello.js` with `export async function onRequestGet() { return new Response("hi") }`, then open `/api/hello`.
- **New look:** change the colors at the top of `web/style.css`.

## Papers behind the ideas

ReAct (2022), RAG (2020), MemGPT (2023), Lost in the Middle (2023), Mixture-of-Agents (2024), FrugalGPT (2023), RouteLLM (2024).

## 13. Smarter memory (Phase 1)

| Piece | File | Idea from |
|---|---|---|
| **Facts that update themselves.** After each answer, one fast call returns ADD / UPDATE / DELETE operations on your facts. Changed facts get an end date (`invalid_at`) instead of being erased, so NEXUS knows your history | `lib/facts.js` | Mem0 (2025), Zep (2025) |
| **One memory per exchange.** Your message plus the reply is stored as one memory, with 1–3 key-fact labels and a date | `lib/semantic.js` → `rememberExchange` | LongMemEval (2024) |
| **Search by meaning.** Qwen3-Embedding-0.6B (Hugging Face) turns text into 1024 numbers, stored in Cloudflare Vectorize | `lib/semantic.js` | RAG |
| **Keyword + meaning merged** with Reciprocal Rank Fusion, then reordered by the bge-reranker model. Clearly unrelated notes are dropped | `fuse()`, `rerank()` | RAG-Fusion, Corrective RAG |
| **Document parts carry their document's name**, so a part that never names its topic is still found | `rememberDoc()` | Contextual Retrieval (Anthropic) |
| **Time-aware search.** "yesterday", "last week", "in March" filter memories by date | `timeWindow()` in `lib/memory.js` | LongMemEval |
| **Understand step.** One fast call rewrites follow-ups into full questions, rates difficulty (0 = small talk, so no search) and picks tools | `lib/understand.js` | Rewrite-Retrieve-Read, Adaptive-RAG, Toolformer |
| **Enough-to-answer check.** If the notes found aren't enough, NEXUS searches the web (general questions) or admits it doesn't know (personal details) | `isEnough()` in `lib/prepare.js` | CRAG, Sufficient Context (Google, 2025) |

To add meaning search for old data: `POST /api/reindex?kind=chats` (and `kind=docs`). Call it again with the returned `next` offset until it says `done`.

## 14. Better answers for less quota (Phase 2)

| Piece | File | Idea from |
|---|---|---|
| **Small talk** goes to the quickest model and skips searching | `planRoute(..., {fast})` | Adaptive-RAG |
| **Hard questions (Auto mode):** two different AIs answer separately. If they agree, the answer is shown as checked. If they disagree, a third AI works out which parts are right. A failed AI is replaced by the next one | `cascade()` in `functions/api/chat.js` | Mixture-of-Thought Cascades (ICLR 2024), SelfCheckGPT |
| "Hard" = the understand step says so, **or** the message has lots of numbers or words like "step by step", "calculate", "compare" | `looksHard()` in `lib/understand.js` | — |
| **👍 / 👎** change a model's Elo score. 👎 with a reason becomes a **lesson** ("final answer first") that NEXUS follows from then on | `lib/ratings.js`, `lib/lessons.js` | Chatbot Arena, ACE (2025) |
| **⚔️ Battle:** two AIs answer blind as "A" and "B". Your vote updates both Elo scores, and the router tries the best-rated AIs first | `functions/api/battle.js`, `byScore()` in `lib/router.js` | Chatbot Arena |
| **🔄 Regenerate** asks a different AI. **✏️ Edit** removes everything after your message and sends it again | `regenerate()`, `editMessage()` in `web/app.js` | Open WebUI |
| **Council** picks the most consistent answer and improves it, instead of blending everything | `functions/api/council.js` | Universal Self-Consistency (2023) |

The 🧠 Memory window shows your facts, their history, your lessons and your AI rankings.

## 15. Skills library (Phase 3)

`scripts/import-skills.js` downloads **fabric's** expert prompts (MIT) and the first 300 **prompts.chat** personas (CC0) into `web/skills-library.json`, about 840 KB. The 🧩 window loads that file the first time it opens, then searches it by name and content.

Library skills aren't stored on the server, so the browser sends the chosen skill's text as `skillPrompt`. `prepare.js` uses it when the skill id isn't a built-in or one of your own.

A GitHub Action (`update-skills.yml`) re-runs the script on the 1st of every month and opens a pull request when something changed.

## 16. Better Deep Research (Phase 4)

`functions/api/research.js` now works in rounds:
1. **Plan** 4 search queries.
2. **Search and read** the best 6 pages. A fast model **condenses each page** into up to 8 facts for the topic, and pages with nothing useful are dropped. *(Search-o1, "reason in documents")*
3. **Reflect:** "What important information is still missing?" Up to 2 more searches fill the gaps, reading 4 more pages. *(jina-ai/node-DeepResearch, dzhng/deep-research)*
4. **Write** the report from the condensed facts only, citing every claim as [n].

It uses about 30 outside requests, within the free plan's limit of 50 per request. Condensing is spread across Groq, Cloudflare and Gemini so no single free limit runs out. The website turns odd citation styles like `【1†L1】` into `[1]`.

## 17. Bots that maintain NEXUS (Phase 5)

| Bot | When | What it does |
|---|---|---|
| **Check code** (`check.yml`) | every push | Syntax check plus a scan for leaked keys |
| **Security** (`security.yml`) | every push, and Wednesdays | **Gitleaks** scans the history for keys; **OpenSSF Scorecard** gives a security score with tips |
| GitHub **secret scanning + push protection + CodeQL** | always | Switched on in repo settings. A push containing a key is blocked, and the code is scanned for security bugs |
| **AI code review** (`ai-review.yml`) | each code push by you | Google's **Gemini CLI** reads the change and opens an issue only if it finds a real bug |
| **Model scout** (`model-scout.yml`, `scripts/scout-models.js`) | Sundays | Compares NEXUS's models with every provider's live list and the community list **mnfst/awesome-free-llm-apis**. Lists missing models (each one double-checked with a real request) and new free models |
| **Weekly check + quality test** (`weekly-check.yml`, `functions/api/eval.js`) | Mondays | The Doctor checks every key. Then each AI answers 5 test questions, and another AI grades them 1–10 (MT-Bench / LLM-as-a-Judge). The score feeds the router |
| **Uptime** (`uptime.yml`) | every 30 min | Opens an issue if the site is down and closes it when it's back |
| **Update skills** (`update-skills.yml`) | monthly | Refreshes the skills library and opens a pull request |
| **Deploy** (`deploy.yml`) | after checks pass | Puts the site live with Cloudflare's wrangler-action, once you add the token (see SETUP.md) |
| **Dependabot** | monthly | Pull requests when a tool has an update |
| **Reminders** (`reminders.yml`) | every 10 min | Sends due reminders to your phone |

## 18. New abilities (Phase 6)

| Feature | File | How |
|---|---|---|
| **🎨 Cloudflare FLUX** image engine | `functions/api/image.js` | FLUX.1-schnell (Black Forest Labs) on Workers AI, about 150 free a day. The browser shrinks the 1 MB result to about 150 KB and stores it inside the chat |
| **🗣️ Natural voice** | `speakNatural()` in `web/app.js` | **Kokoro-82M** (Hugging Face) runs in your browser through **kokoro-js**. Sentences are generated one by one, preparing the next while the current one plays. The first use downloads about 90 MB |
| **🔗 Share a chat** | `functions/api/share.js`, `shared.js`, `web/share.html` | A secret token points to one chat. `/api/shared` is the only route that works without login, and it shows only that chat |
| **📥 Import ChatGPT** | `functions/api/import.js`, `web/app.js` | ChatGPT's `conversations.json` stores each chat as a tree. The browser walks from the last message back to the first, then sends 10 chats at a time to the 📁 Imported folder |
| **⌨️ Shortcuts** | `web/app.js` | Ctrl+K searches chats, Alt+N starts a new chat, "/" jumps to the message box |
| **💻 qwen3.5:2b** | Ollama on the D drive | The best small model for a 4 GB graphics card; it can also see images |
| **render.js** | `web/render.js` | Markdown and math rendering, shared by the main page and the share page |

## 19. AI/ML study partner, part 1: explain, diagrams, code, errors

| Feature | File | How |
|---|---|---|
| **🎓 Explain mode** (beginner, intermediate, advanced) | `explainPrompt()` in `web/app.js` | Sends a teaching structure as the skill: intuition, math (LaTeX), runnable code, Mermaid diagram, common mistakes, where it's used, and a quiz with hidden answers |
| **📐 Diagrams** | `renderMermaid()` in `web/runners.js` | **mermaid-js** (MIT) draws ```` ```mermaid ```` blocks. Each diagram has buttons to show its code and download it as SVG, and it's redrawn when the theme changes |
| **🧑‍💻 Code routing** | `CODE_WORDS` and `CODE_MODELS` in `lib/router.js` | ML library words (pytorch, sklearn, traceback…) count as code, and the strongest coding models go first |
| **🐞 Error explainer** | `errorLine()` in `lib/understand.js` + the `stackoverflow` tool | A pasted traceback always triggers a Stack Overflow search (top-voted accepted answers), and the answer follows: meaning, cause, fix, prevention |
| **New research tools** | `lib/tools.js` | `papers` (Hugging Face Papers, then Semantic Scholar with a free key, then arXiv), `trending_papers`, `hf_models`, `hf_datasets`, `github_repos`, `docs` (official docs only: PyTorch, scikit-learn, Transformers, NumPy…) |
| **Streaming timeout fix** | `callModel()` in `lib/providers.js` | The 30 s timer now covers only "start replying". Long answers are no longer cut off |

## 20. AI/ML study partner, part 2: notes, PDF and Word, templates

| Feature | File | How |
|---|---|---|
| **🗒️ Notes** | `functions/api/notes.js`, `web/notes.js` | "🗒️ Save" under any answer creates a note with a title and topic. The Notes window groups notes by topic and lets you search, preview or edit (markdown), and delete |
| **Notes become memory** | `lib/chunks.js` → `saveSearchable()` | Each note is also saved as a searchable document (`note-<id>`), with keyword and meaning search, so later answers use your notes |
| **📑 PDF** | `web/exporter.js` → `exportPdf()` | **html2pdf.js** (MIT) photographs the note exactly as it looks on screen (formulas, diagrams, charts, colored code) onto white A4 pages. The page is built inside an off-screen holder; the page itself must stay normal, or the PDF comes out blank |
| **📄 Word** | `exportDocx()` | **docx** (MIT): marked's lexer splits the markdown into blocks, and each becomes a real Word heading, paragraph, list, table or code block |
| **📘 Study guide** | `web/notes.js` | Tick several notes to get one PDF or Word file with a cover page, a contents page and each note on its own page |
| **📋 Templates** | `lib/skills.js` | Built-in skills: Study notes, Paper summary, Literature review, Cheat sheet, Project report |

## 21. AI/ML study partner, part 3: papers and literature reviews

| Feature | File | How |
|---|---|---|
| **📄 Paper explainer** | `lib/papers.js` → `readPaper()`, `read_paper` tool | Paste an arXiv link and NEXUS reads the **full paper** (arXiv's HTML version through Jina Reader, the PDF as backup, up to 40,000 characters) plus real metadata from Hugging Face. The answer follows: TL;DR, problem, core idea, method with equations and diagram, results, limitations, how to implement it |
| **📚 Literature review** (dropdown, or `/review topic`) | `functions/api/litreview.js` | Plan 3 searches, collect up to 14 real papers from Hugging Face Papers sorted by year, then write an intro, timeline, comparison table, themes, open problems, what to read first and references |
| **BibTeX** | `bibtex()` in `lib/papers.js` | Built by code from the real titles, authors, years and arXiv ids, never written by an AI, so references can't be invented |
| **Long answers finish** | `maxOut` in `lib/providers.js` | Groq and Gemini 32k tokens, the others 16k (Z.ai 8k, the most its free plan accepts). Thinking models count their thinking toward this limit, which is why reports used to stop mid-way |

## 22. AI/ML study partner, part 4: hands-on ML

| Feature | File | How |
|---|---|---|
| **▶ Train real models in the browser** | `web/runners.js` | Pyodide loads **scikit-learn**, pandas, SciPy and matplotlib automatically when your code imports them. The built-in datasets (iris, digits, wine, breast cancer, diabetes) work offline |
| **📊 Your data files** | `readFile()` in `web/app.js` | An attached CSV, TSV or JSON goes **in full** to Python's virtual disk, so `pd.read_csv("file.csv")` works, while the AI sees only a 40-line preview, which saves its reading space |
| **📓 Notebook export** | `exportNotebook()` in `web/exporter.js` | A chat or note becomes an `.ipynb`: text turns into markdown cells and Python blocks into code cells. Upload it to **Google Colab** for a free GPU when you need PyTorch or TensorFlow, which can't run in a browser |
| Library warnings hidden | `runPython()` | `warnings.filterwarnings('ignore')`, so your results come first |

Tested end to end on the live site with puppeteer: login, scikit-learn code then ▶ Run (accuracy printed), CSV then pandas then ▶ Run, save as note, notebook export.

## 23. AI/ML study partner, part 5: roadmap, flashcards, interview practice

| Feature | File | How |
|---|---|---|
| **🗺️ Roadmap** | `web/learn.js`, `web/learning.json` | 93 topics in 6 areas (Classic ML, Deep learning, Statistical ML, LLMs, Multimodal and GenAI…) imported from **alirezadir/AIMLInterviews** (MIT) by `scripts/import-learning.js`, refreshed monthly. Click ⚪ to go 🟡 → ✅ (saved in the `progress` table). Each area shows a % done and the next topic. 🎓 opens Explain mode on that topic |
| **🃏 Flashcards** | `functions/api/cards.js`, `web/learn.js` | 🃏 under any answer, on a note or on a roadmap topic: a fast AI writes 5–10 question/answer cards (if one AI's reply can't be read, the next one tries). **FSRS** (`ts-fsrs`, MIT) runs in the browser: rate Again, Hard, Good or Easy and it calculates when you'd be about to forget the card |
| **💼 Interview practice** | `web/learn.js` | Real questions in 3 categories (ML fundamentals, LLMs and GenAI, ML system design). Answer in chat and NEXUS grades it out of 10: what was good, what's missing, a model answer, and a follow-up question |

Tested end to end on the live site with puppeteer: roadmap → mark topic → flashcards from topic → review and rate → interview question → graded answer.

## 24. Understand deeply: the math, the code, and why it works

Pick a mode from **🔬 Understand deeply** in the model dropdown. Each mode is a strict set of instructions (`web/deep.js`) that forces one kind of explanation: every symbol defined, every shape stated, and no "it can be shown".

| Mode | What you get |
|---|---|
| 📐 Derive | Goal → prerequisites → numbered steps, each with **Why:** naming the rule used → result → intuition → NumPy code |
| 📜 Prove | Theorem, assumptions (and why each is needed), proof ending in ∎, and a counterexample when an assumption is dropped |
| 🔗 Equation ↔ code | A two-column grid: each formula next to the NumPy line that computes it, then a from-scratch implementation checked against scikit-learn / SciPy |
| 🔍 How it's really implemented | The **real library source**, quoted and explained line by line: call path, math ↔ code, design choices, plus a minimal version |
| 🔢 Tiny worked example | The whole computation on 2×2-sized real numbers, every intermediate result written out |
| 🐢 Step-through | A ◀ ▶ stepper that shows the algorithm's state after each step |
| 📏 Shape trace | Every line annotated with tensor shapes like `(B, T, C) → (B, T, n_head, head_dim)` |
| ❓ Why it works | The problem it solves, the mechanism, assumptions, inductive bias, the geometric and probabilistic views, and failure cases |
| 🧪 Ablation | A tiny experiment that trains with and without a component and plots both curves |
| 📊 Visualize | Plots that build intuition (loss landscapes, decision boundaries, transformations) |

**✔️ Python checks the math** (`web/python.js`). Answers end with a `verify` block that runs automatically in your browser: SymPy for algebra, NumPy for numbers, finite differences for gradients. The badge shows one of three results:
- ✔ verified
- ✘ a math check failed
- ⚠️ the check code itself is broken, which says nothing about the math

When a check fails, `functions/api/fixcode.js` reviews it once (idea from the *Self-Debugging* paper). An unfair check gets corrected, for example a too-tight tolerance on a random average or regularization left on in scikit-learn. Real math errors are kept and reported.

**🔍 Real source code** (`lib/source.js`, two tools the AI can also call on its own):
- `source_code` takes input like `torch | Dropout` or `sklearn | LogisticRegression.fit`. Sourcegraph's free code search finds the file and line; the file is downloaded from GitHub at that exact commit and just that class or method is cut out. Long docstrings are shortened, and the answer links to the exact lines.
- `reference_impl` takes a topic such as `attention`, `lora` or `backprop`. It returns a small from-scratch implementation from karpathy's micrograd, nanoGPT or minbpe, or from labml.ai's annotated papers (math and code side by side). All are MIT licensed, fetched live and credited.
- The 🔍 mode makes sure both tools run (`mustTools`). If the tool-picking model forgets `source_code`, `guessSourceInput()` reads the library and the name straight from your question.

**📏 Shapes button** on Python blocks runs the code with an AST tracer and shows each variable's shape next to the line that made it.

**🧮 Autograd lab** (sidebar, `web/autograd.js`). Write an expression with `Value` numbers, e.g. `L = (a*b + c).tanh()`, and see:
1. **The computation graph**: every number with its value and gradient (Mermaid).
2. **Every backward step with real numbers**: `a.grad += -3 × -2 → 6   (∂(a·b)/∂a = b)`. Visiting the nodes in reverse topological order is exactly what PyTorch's `loss.backward()` does.
3. **A check**: backprop gradients vs. numerical gradients `(L(x+h) − L(x−h)) / 2h`. Each input is nudged by re-running your code with that input moved by ±h.

The engine is about 150 readable lines in the style of micrograd (Andrej Karpathy, MIT); open "Read the engine's code" in the lab. Six examples teach one idea each: the chain rule, a tanh neuron, the logistic-regression loss, squared error, why gradients **add up** when a number is used twice (that's why it's `+=`), and how ReLU kills gradients.

Tested end to end on the live site with puppeteer: derive (2 checks verified), equation ↔ code grid, stepper (◀ ▶), shapes, and the source mode on PyTorch Dropout and scikit-learn StandardScaler (the real file and line links appeared in the answer).
