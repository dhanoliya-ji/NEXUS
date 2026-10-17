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

## 8. Password

`_middleware.js` runs before every `/api` request. If `NEXUS_PASSWORD` is set, the request must carry the header `x-nexus-key` with the same value. The browser remembers your password in `localStorage`.

## How to add things yourself

- **New AI provider:** copy a block in `lib/providers.js`, change the url, key, models and chars, then add its id to the orders in `lib/router.js`. Add the key to `.dev.vars`.
- **New API route:** create `functions/api/hello.js` with `export async function onRequestGet() { return new Response("hi") }`, then open `/api/hello`.
- **New look:** change the colors at the top of `web/style.css`.

## Papers behind the ideas

ReAct (2022), RAG (2020), MemGPT (2023), Lost in the Middle (2023), Mixture-of-Agents (2024), FrugalGPT (2023), RouteLLM (2024).
