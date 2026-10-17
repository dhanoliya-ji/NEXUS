// ============================================================
//  app.js — everything that happens in your browser
// ============================================================
//  Read top to bottom:
//   1. small helpers (talk to the backend, find elements)
//   2. chat list on the left
//   3. showing messages
//   4. sending a message + reading the streamed answer
//   5. pop-ups (password, memory, doctor) and buttons

// ---------- 1. Helpers ----------

const $ = (id) => document.getElementById(id);   // $("input") = the element with id="input"

let currentChatId = null;   // which chat is open (null = new chat)
let history = [];           // messages of the open chat: [{role, content}]
let busy = false;           // true while NEXUS is answering

// Your login token (made when you log in; the password itself is never stored)
const token = () => localStorage.getItem("nexus-token") || "";

// Call our backend. Adds the login token automatically.
async function api(path, method, body) {
  const res = await fetch("/api/" + path, {
    method: method || "GET",
    headers: { "Content-Type": "application/json", "x-nexus-key": token() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 429) {   // not logged in (or locked) → show the login box
    askPassword(res.status === 429 ? "Too many wrong passwords. Try again in 15 minutes." : "");
    throw new Error("password needed");
  }
  return res;
}

// toHtml() (markdown + math → safe HTML) lives in render.js, shared with the share page

// ---------- 2. Chat list (left sidebar) ----------

let allChats = [];

async function loadChats() {
  const res = await api("chats");
  allChats = await res.json();
  drawChatList();
}

// The sidebar list: 📌 Pinned first, then each 📁 folder, then Recent
function drawChatList() {
  const filter = $("searchChats").value.toLowerCase();
  const chats = allChats.filter((c) => !filter || c.title.toLowerCase().includes(filter));
  $("chatList").innerHTML = "";

  const pinned = chats.filter((c) => c.pinned);
  const folders = [...new Set(chats.filter((c) => !c.pinned && c.folder).map((c) => c.folder))].sort();
  const recent = chats.filter((c) => !c.pinned && !c.folder);

  if (pinned.length) addGroup("📌 Pinned", pinned, true);
  for (const f of folders) addGroup("📁 " + f, chats.filter((c) => !c.pinned && c.folder === f), localStorage.getItem("nexus-fold-" + f) !== "closed", f);
  if (recent.length) addGroup("Recent", recent, true);
}

// One group of chats. Folders can be folded (remembered in this browser).
function addGroup(title, chats, open, folderName) {
  const group = document.createElement("details");
  group.className = "chat-group";
  group.open = open;
  group.innerHTML = "<summary class='list-label'></summary>";
  group.querySelector("summary").textContent = title + (folderName ? " (" + chats.length + ")" : "");
  if (folderName) group.ontoggle = () => localStorage.setItem("nexus-fold-" + folderName, group.open ? "open" : "closed");
  for (const chat of chats) group.appendChild(chatItem(chat));
  $("chatList").appendChild(group);
}

// One chat in the list, with buttons: 📌 pin, ✏️ rename, 📁 move, 🗑 delete
function chatItem(chat) {
  const item = document.createElement("div");
  item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
  item.innerHTML = '<span class="name"></span><span class="actions">' +
    '<button data-do="pin" title="Pin / unpin">📌</button><button data-do="rename" title="Rename">✏️</button>' +
    '<button data-do="move" title="Move to folder">📁</button><button data-do="delete" title="Delete">🗑</button></span>';
  item.querySelector(".name").textContent = chat.title;
  item.onclick = () => openChat(chat.id, chat.title);

  item.querySelectorAll(".actions button").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();          // don't also open the chat
      const action = btn.dataset.do;
      if (action === "delete") return deleteChat(chat.id);
      let change;
      if (action === "pin") change = { pinned: !chat.pinned };
      if (action === "rename") {
        const title = prompt("New name:", chat.title);
        if (!title) return;
        change = { title: title };
        if (chat.id === currentChatId) $("chatTitle").textContent = title;
      }
      if (action === "move") {
        const existing = [...new Set(allChats.map((c) => c.folder).filter(Boolean))];
        const folder = prompt("Folder name (empty = no folder)" + (existing.length ? "\nYour folders: " + existing.join(", ") : ""), chat.folder || "");
        if (folder === null) return;
        change = { folder: folder };
      }
      await api("chats/" + chat.id, "PATCH", change);
      loadChats();
    };
  });
  return item;
}

async function openChat(id, title) {
  currentChatId = id;
  $("chatTitle").textContent = title;
  const res = await api("chats/" + id);
  const rows = await res.json();

  history = rows.map((r) => ({ role: r.role, content: r.content }));
  $("messages").innerHTML = "";
  for (const r of rows) addMessage(r.role, r.content, r.model);

  drawChatList();
  closeMenu();
  scrollDown();
}

function newChat() {
  if (typeof interview !== "undefined") interview = null;   // leaving interview practice
  currentChatId = null;
  history = [];
  $("chatTitle").textContent = "";
  $("messages").innerHTML = "";
  $("messages").appendChild(welcome);
  drawChatList();
  closeMenu();
  $("input").focus();
}

async function deleteChat(id) {
  if (!confirm("Delete this chat?")) return;
  await api("chats/" + id, "DELETE");
  if (id === currentChatId) newChat();
  loadChats();
}

// ---------- 3. Showing messages ----------

const welcome = $("welcome");

// Your message bubble: the text, plus small chips for attached files instead of their whole content
function drawUserBubble(div, text, images) {
  const files = [];
  const visible = text.replace(FILE_BLOCK, (all, name) => { files.push(name); return ""; }).trim();

  div.innerHTML = '<button class="edit-msg" title="Edit and send again">✏️</button>' +
    '<div class="bubble"><div class="text"></div><div class="files"></div></div>';
  div.querySelector(".text").textContent = visible;
  div.querySelector(".edit-msg").onclick = () => editMessage(div);
  for (const name of files) {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    chip.textContent = "📄 " + name;
    div.querySelector(".files").appendChild(chip);
  }
  for (const url of images || []) {
    const img = document.createElement("img");
    img.className = "sent-image";
    img.src = url;
    div.querySelector(".bubble").appendChild(img);
  }
}

// Add one message to the screen. Returns its element.
function addMessage(role, text, model, images) {
  welcome.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;

  if (role === "user") {
    drawUserBubble(div, text, images);
  } else {
    div.innerHTML =
      '<img class="avatar" src="icon.svg" alt="">' +
      '<div class="body"><div class="content"></div>' +
      '<div class="meta"><span class="model"></span><button class="copy">Copy</button><button class="speak">🔊 Read</button>' +
      '<button class="up" title="Good answer">👍</button><button class="down" title="Bad answer (tell NEXUS why)">👎</button>' +
      '<button class="again" title="Answer again with a different AI">🔄</button><button class="save-note" title="Save as a study note">🗒️ Save</button><button class="make-cards" title="Make flashcards from this answer">🃏</button></div></div>';
    div.querySelector(".content").innerHTML = toHtml(text);
    div.querySelector(".model").textContent = model || "";
    div.dataset.label = model || "";
    div.querySelector(".copy").onclick = () => copyText(div.dataset.raw || text, div.querySelector(".copy"));
    div.querySelector(".speak").onclick = () => speak(div.dataset.raw || text, div.querySelector(".speak"));
    div.querySelector(".up").onclick = () => sendFeedback(div, true);
    div.querySelector(".down").onclick = () => sendFeedback(div, false);
    div.querySelector(".again").onclick = () => regenerate(div);
    div.querySelector(".save-note").onclick = () => saveAnswerAsNote(div);   // notes.js
    div.querySelector(".make-cards").onclick = () => makeCards(div.dataset.raw || div.querySelector(".content").innerText, $("chatTitle").textContent.slice(0, 40) || "General");   // learn.js
    decorateCode(div);
  }
  $("messages").appendChild(div);
  return div;
}

// Color code blocks + add a "Copy" button to each.
// Special blocks (see runners.js): ```chart becomes a chart, ```python gets a ▶ Run button.
function decorateCode(div) {
  div.querySelectorAll("pre code").forEach((block) => {
    if (block.classList.contains("language-chart")) return renderChart(block);
    if (block.classList.contains("language-mermaid")) return renderMermaid(block);
    // Special blocks from the 🔬 deep modes (python.js). Recognized by their label OR their content,
    // because some models label every block "python":
    const code = block.textContent;
    const fresh = div.dataset.fresh === "1";
    // the answer's other code, so a broken check can be repaired with full context
    const context = [...div.querySelectorAll("pre code")].map((b) => b.textContent).filter((t) => t !== code).join("\n\n");
    if (block.classList.contains("language-verify")) return renderVerify(block, fresh, context);
    if (block.classList.contains("language-python") && /\bassert\b/.test(code) && /✔/.test(code)) return renderVerify(block, fresh, context);
    if (block.classList.contains("language-eqcode") || (code.match(/\|\|\|/g) || []).length >= 2) return renderEqcode(block);
    if (block.classList.contains("language-steps") || (/^\s*\[\s*\{/.test(code) && /"(title|step)"/.test(code))) {
      renderSteps(block);
      if (!block.isConnected) return;          // it became a stepper
    }
    hljs.highlightElement(block);
    if (block.classList.contains("language-python")) addRunButton(block);
    const btn = document.createElement("button");
    btn.className = "copy-code";
    btn.textContent = "Copy";
    btn.onclick = () => copyText(block.innerText, btn);
    block.parentElement.appendChild(btn);
  });
}

function copyText(text, button) {
  navigator.clipboard.writeText(text);
  button.textContent = "Copied!";
  setTimeout(() => (button.textContent = "Copy"), 1500);
}

function scrollDown() {
  $("messages").scrollTop = $("messages").scrollHeight;
}

// ---------- 4. Sending a message ----------

async function send(text) {
  text = text.trim();
  if ((!text && pending.length === 0) || busy) return;
  busy = true;
  $("send").disabled = true;
  $("input").value = "";
  autoGrow();

  // Attached files: text files go INSIDE the message, images are sent separately
  const images = pending.filter((f) => f.image).map((f) => f.image);
  let content = text || "Please look at the attached file(s).";
  for (const f of pending.filter((f) => f.text !== undefined)) {
    content += "\n\n<<FILE: " + f.name + ">>\n" + f.text + "\n<<END FILE>>";
  }
  pending = [];
  drawPending();

  // New chat? Create it first (title = start of your first message)
  if (!currentChatId) {
    const title = (text || "Files").slice(0, 50);
    const res = await api("chats", "POST", { title: title });
    currentChatId = (await res.json()).id;
    $("chatTitle").textContent = title;
  }

  addMessage("user", content, "", images);
  history.push({ role: "user", content: content });
  scrollDown();

  try {
    if (text.startsWith("/image ")) await makeImage(text.slice(7));
    else if (text.startsWith("/research ")) await askAI(content, "research");
    else if (text.startsWith("/review ")) await askAI(content, "litreview");
    else if (images.length) await askAI(content, "auto", images);     // pictures → a model that can see
    else await askAI(content, $("modelPick").value);
  } catch (e) {
    if (e.message !== "password needed") addMessage("assistant", "⚠️ " + e.message);
  }

  busy = false;
  $("send").disabled = false;
  loadChats();
}

// What to show while waiting, for each mode
const WAITING = {
  council: "🏛️ Council is discussing…",
  research: "🔬 Researching the web: planning → searching → reading 8 pages → writing (about 30–60 s)…",
  careful: "✅ Writing a draft, then double-checking it…",
  battle: "⚔️ Two AIs are answering…",
  litreview: "📚 Finding papers and writing a literature review (about 30–60 s)…",
};
const SPECIAL_MODES = ["council", "research", "careful", "battle", "litreview"];

// Ask the AI and show the answer word by word as it arrives
//   choice = "auto" | "council" | "research" | "careful" | "battle" | "groq/model…" | "pc/qwen3:4b"
//   extra  = { regenerate: true, avoid: "groq" }  for 🔄
async function askAI(text, choice, images, extra) {
  const div = addMessage("assistant", "", images ? "👀 Looking at your image…" : WAITING[choice] || "Thinking…");
  const content = div.querySelector(".content");
  content.classList.add("typing");

  const body = {
    chatId: currentChatId, messages: history, model: choice, tools: toolsOn, images: images,
    skill: activeSkill ? activeSkill.id : null, skillPrompt: activeSkill ? activeSkill.prompt : null, ...(extra || {}),
  };
  // 💼 Interview practice: grade the answer (learn.js)
  if (typeof interview !== "undefined" && interview) {
    body.skill = null;
    body.skillPrompt = interviewPrompt();
  }
  // 🔬 Deep-understanding modes (deep.js): derive, prove, equation↔code, worked example…
  if (choice.startsWith("deep-")) {
    body.skill = null;
    body.skillPrompt = deepPrompt(choice.slice(5));
    body.model = "auto";
    choice = "auto";
  }
  // 🎓 Explain mode = a teaching "skill" at the chosen level, answered by the normal router
  if (choice.startsWith("explain-")) {
    body.skill = null;
    body.skillPrompt = explainPrompt(choice.slice(8));
    body.model = "auto";
    choice = "auto";
  }
  let res;
  if (choice.startsWith("pc/")) res = await askMyPC(choice.slice(3), body);
  else res = await api(SPECIAL_MODES.includes(choice) ? choice : "chat", "POST", body);

  const showError = (message, details) => {
    content.classList.remove("typing");
    content.innerHTML = '<p class="error-text">⚠️ ' + (message || "Something went wrong") +
      (details ? "<br><small>" + details.join("<br>") + "</small>" : "") + "</p>";
    history.pop();
  };
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return showError(err.error, err.details);
  }

  // "Who answered" line under the message. Our backend sends it as a nexus_info message
  // in the stream; for 💻 My PC answers we already know it (res.nexusModel…).
  let modelName = res.nexusModel || "";
  function showInfo(i) {
    modelName = i.model || "";
    div.dataset.provider = i.providerId || "";      // for 👍 👎 ratings and 🔄
    div.dataset.modelId = i.modelId || "";
    div.dataset.label = modelName;
    let text = modelName;
    if (i.memories > 0) text += " · used " + i.memories + " memories";
    if (i.docs) text += " · 📚 " + i.docs;
    div.querySelector(".model").textContent = text;
    if (i.tools) {
      const tag = document.createElement("span");
      tag.className = "used-tools";
      tag.textContent = " · 🛠 " + i.tools.replace(/_/g, " ");
      div.querySelector(".model").appendChild(tag);
    }
  }
  if (res.nexusModel) showInfo({ model: res.nexusModel, memories: res.nexusMemories, docs: res.nexusDocs, tools: res.nexusTools });

  // Read the stream. It arrives as lines like:  data: {"choices":[{"delta":{"content":"Hel"}}]}
  // plus our own lines: nexus_status (what NEXUS is doing), nexus_info, nexus_error
  let answer = "";
  let thinking = "";
  let failed = false;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let leftover = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = (leftover + decoder.decode(value, { stream: true })).split("\n");
    leftover = lines.pop();                      // last line may be incomplete, keep it for later

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const msg = JSON.parse(data);
        if (msg.nexus_status) {
          if (!answer) content.innerHTML = '<span class="status"></span>', content.querySelector(".status").textContent = msg.nexus_status;
          continue;
        }
        if (msg.nexus_info) { showInfo(msg.nexus_info); continue; }
        if (msg.nexus_error) { failed = true; showError(msg.nexus_error, msg.details); continue; }
        if (msg.nexus_battle) { failed = true; showBattle(div, msg.nexus_battle, text); continue; }   // ⚔️ handled by its own view
        const delta = msg.choices[0].delta || {};
        if (delta.content) answer += delta.content;
        if (delta.reasoning_content || delta.reasoning) thinking += delta.reasoning_content || delta.reasoning;
      } catch (e) { /* not JSON, skip */ }
    }

    if (!failed) showAnswer(div, answer, thinking);
    scrollDown();
  }

  if (failed) return;
  content.classList.remove("typing");
  answer = answer.replace(/<think>[\s\S]*?<\/think>/, "").trim();   // don't save the thinking part
  div.dataset.raw = answer;
  div.dataset.fresh = "1";              // new answer → ✔️ verification blocks run automatically
  decorateCode(div);

  // Save the answer (and let NEXUS update its memory in the background)
  history.push({ role: "assistant", content: answer });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: answer, model: modelName, userText: text });
}

// 🎓 The teaching structure used by Explain mode
function explainPrompt(level) {
  const depth = {
    beginner: "a BEGINNER (knows basic Python and school math). Use everyday analogies, keep math light and explain every symbol",
    intermediate: "an INTERMEDIATE learner (knows Python, linear algebra and basic ML). Include the key equations and why they work",
    advanced: "an ADVANCED learner. Go deep: derivations, complexity, design trade-offs, recent research and implementation details",
  }[level] || "an intermediate learner";
  return "You are an expert AI/ML and software teacher. Explain the user's topic for " + depth + ".\n" +
    "Use exactly these sections (skip one only if it truly doesn't apply):\n" +
    "## 💡 Intuition — the core idea in plain words with a real-life analogy.\n" +
    "## 📐 The math — key equations in LaTeX ($...$ / $$...$$), every symbol explained, step by step.\n" +
    "## 🧑‍💻 Code — a minimal, runnable, commented example (NumPy for fundamentals, PyTorch for deep learning, " +
    "scikit-learn for classic ML). If it uses only numpy/pandas/scikit-learn/matplotlib, say it can run here with ▶ Run.\n" +
    "## 📊 Diagram — a ```mermaid diagram when structure or flow matters (architectures, pipelines, algorithms).\n" +
    "## ⚠️ Common mistakes — 3-5 misconceptions or bugs people hit.\n" +
    "## 🔗 Where it's used & what to learn next.\n" +
    "## 🧪 Quick quiz — 3 questions, with the answers hidden inside <details><summary>Show answers</summary> ... </details>.";
}

// ---------- 👍 👎 🔄 ✏️ ⚔️  Feedback that teaches NEXUS ----------

// 👍 / 👎 → the model's rating goes up/down; 👎 also asks why, so NEXUS learns a lesson
async function sendFeedback(div, good) {
  const note = good ? "" : prompt("What was wrong? (optional — NEXUS learns from this)", "");
  if (note === null) return;                       // clicked Cancel
  const msgs = [...document.querySelectorAll("#messages .msg")];
  const i = msgs.indexOf(div);
  const question = i > 0 && history[i - 1] ? history[i - 1].content : "";
  await api("feedback", "POST", {
    provider: div.dataset.provider, model: div.dataset.modelId, label: div.dataset.label,
    good: good, note: note, question: question, answer: div.dataset.raw || div.querySelector(".content").innerText,
  });
  div.querySelector(good ? ".up" : ".down").classList.add("chosen");
  toast(good ? "👍 Thanks! NEXUS will prefer this AI a bit more." : "👎 Noted — NEXUS will learn from it.");
}

// 🔄 → answer the last message again with a DIFFERENT AI (only for the newest answer)
async function regenerate(div) {
  const msgs = [...document.querySelectorAll("#messages .msg")];
  if (msgs[msgs.length - 1] !== div) return toast("🔄 works on the newest answer only.");
  if (busy) return;
  busy = true;
  div.remove();
  history.pop();                                   // forget the old answer
  const lastUser = history[history.length - 1];
  try {
    await askAI(lastUser.content, "auto", null, { regenerate: true, avoid: div.dataset.provider || null });
  } catch (e) { /* password pop-up */ }
  busy = false;
}

// ✏️ → change one of your messages: everything after it is removed, then it's sent again
async function editMessage(div) {
  if (busy) return;
  const msgs = [...document.querySelectorAll("#messages .msg")];
  const i = msgs.indexOf(div);
  const old = history[i] ? history[i].content.replace(FILE_BLOCK, "") : "";
  const text = prompt("Edit your message:", old);
  if (text === null || !text.trim()) return;
  await api("chats/" + currentChatId + "/truncate", "POST", { keep: i });
  history = history.slice(0, i);
  msgs.slice(i).forEach((m) => m.remove());
  send(text);
}

// ⚔️ Battle view: two answers side by side ("A" and "B"), names shown after you vote
function showBattle(div, battle, question) {
  const content = div.querySelector(".content");
  content.classList.remove("typing");
  content.innerHTML =
    '<div class="battle"><div class="side"><b>Answer A</b><div class="a"></div></div>' +
    '<div class="side"><b>Answer B</b><div class="b"></div></div></div>' +
    '<div class="vote"><button data-v="a">👈 A is better</button><button data-v="tie">🤝 Tie</button><button data-v="b">B is better 👉</button></div>';
  content.querySelector(".a").innerHTML = toHtml(battle.a.text);
  content.querySelector(".b").innerHTML = toHtml(battle.b.text);
  decorateCode(div);
  div.querySelector(".model").textContent = "⚔️ Battle — names are hidden until you vote";

  content.querySelectorAll(".vote button").forEach((btn) => {
    btn.onclick = async () => {
      const v = btn.dataset.v;
      const winner = v === "b" ? battle.b : battle.a;
      const loser = v === "b" ? battle.a : battle.b;
      await api("vote", "POST", { winner: winner, loser: loser, tie: v === "tie" });
      content.querySelector(".vote").innerHTML = "✅ A = " + battle.a.name + " · B = " + battle.b.name;
      // The chosen answer becomes the answer of this chat (and NEXUS learns from it)
      div.dataset.raw = winner.text;
      div.dataset.provider = winner.provider;
      div.dataset.modelId = winner.model;
      history.push({ role: "assistant", content: winner.text });
      await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: winner.text, model: winner.name + " (⚔️ winner)", userText: question });
    };
  });
}

// ---------- 💻 My PC: Ollama models running on your laptop ----------
// Cloudflare can't reach your laptop, but your BROWSER can (when you're on it).
// So: NEXUS backend gives the instructions (memory + tools), then the browser
// asks Ollama on http://localhost:11434 directly.

const OLLAMA = "http://localhost:11434";

async function askMyPC(model, body) {
  const ctxRes = await api("context", "POST", body);
  const ctx = await ctxRes.json();
  const res = await fetch(OLLAMA + "/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model, stream: true, messages: [{ role: "system", content: ctx.system }].concat(history) }),
  });
  // Ollama doesn't send our info headers, so we attach the info ourselves
  res.nexusModel = "My PC · " + model;
  res.nexusMemories = ctx.memories;
  res.nexusTools = ctx.tools.join(", ");
  res.nexusDocs = ctx.docs;
  return res;
}

// Check if Ollama is running on this computer; if yes, add its models to the dropdown
async function findMyPCModels() {
  try {
    const res = await fetch(OLLAMA + "/api/tags", { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    if (!data.models.length) return;
    const group = document.createElement("optgroup");
    group.label = "💻 My PC (Ollama, private)";
    group.className = "models";
    for (const m of data.models) {
      const opt = document.createElement("option");
      opt.value = "pc/" + m.name;
      opt.textContent = m.name;
      group.appendChild(opt);
    }
    $("modelPick").appendChild(group);
  } catch (e) { /* Ollama not running or not on this computer — that's fine */ }
}

// Draw the answer (and the "thinking" part, if the model shows it)
function showAnswer(div, answer, thinking) {
  // Some models (Qwen3, DeepSeek-R1) write their thinking inside <think>...</think> in the answer itself
  if (answer.includes("<think>") || answer.includes("</think>")) {
    const end = answer.indexOf("</think>");
    if (end === -1) {                     // still thinking
      thinking += answer.replace("<think>", "");
      answer = "";
    } else {
      thinking += answer.slice(0, end).replace("<think>", "");
      answer = answer.slice(end + 8).trim();
    }
  }
  let html = "";
  if (thinking) {
    const open = answer ? "" : " open";
    html += '<details class="thinking"' + open + "><summary>💭 Thinking</summary><div></div></details>";
  }
  const content = div.querySelector(".content");
  content.innerHTML = html + toHtml(answer);
  if (thinking) content.querySelector(".thinking div").textContent = thinking;
}

// Create a picture. Two free engines:
//   Pollinations.ai        — unlimited, no key (the picture is loaded from their server)
//   Cloudflare FLUX         — FLUX.1-schnell on Workers AI, sharper, ~150 a day (saved inside the chat)
// Options come from the 🎨 window (style, size, engine, improve prompt); /image in chat uses the defaults.
let imageOptions = null;
async function makeImage(prompt) {
  const opt = imageOptions || { style: "", size: "1024x1024", enhance: true, engine: "pollinations" };
  imageOptions = null;
  const [width, height] = opt.size.split("x");
  const fullPrompt = opt.style ? prompt + ", " + opt.style : prompt;
  const alt = prompt.replace(/[\[\]]/g, "");
  let url, label;

  if (opt.engine === "flux") {
    const div = addMessage("assistant", "", "Cloudflare FLUX · image");
    div.querySelector(".content").innerHTML = '<span class="status">🎨 FLUX is painting… (about 5–10 s)</span>';
    const res = await api("image", "POST", { prompt: fullPrompt });
    const data = await res.json();
    div.remove();
    if (!res.ok) return addMessage("assistant", "⚠️ " + data.error + " — try the Pollinations engine.");
    url = await shrinkImage(await (await fetch("data:image/jpeg;base64," + data.image)).blob());   // ~1 MB → ~150 KB
    label = "Cloudflare FLUX · image";
  } else {
    url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(fullPrompt) +
      "?width=" + width + "&height=" + height + "&nologo=true" + (opt.enhance ? "&enhance=true" : "") +
      "&seed=" + Math.floor(Math.random() * 99999);
    label = "Pollinations.ai · image";
  }
  const answer = "![" + alt + "](" + url + ")\n\n*" + prompt + "*";

  addMessage("assistant", answer, label);
  history.push({ role: "assistant", content: answer });

  // Save both messages (the user one was not saved by /api/chat this time)
  await api("messages", "POST", { chatId: currentChatId, role: "user", content: "/image " + prompt });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: answer, model: label });
  scrollDown();
}

// ---------- 📎 Attachments ----------
// Files are read IN YOUR BROWSER (nothing is uploaded except the text or picture):
//   PDF  → text with pdf.js        Word (.docx) → text with mammoth.js
//   text / code files → read as-is  images → shrunk to max 1280 px, sent to a model that can see

let pending = [];   // files waiting to be sent: {name, text} or {name, image}
const dataFiles = {};   // attached CSV/TSV/JSON, full text, given to ▶ Run Python (runners.js)
const FILE_BLOCK = /\n*<<FILE: (.+?)>>\n[\s\S]*?\n<<END FILE>>/g;
const MAX_FILE_CHARS = 400000;   // about 100k tokens per file

$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").onchange = async () => {
  for (const file of $("fileInput").files) {
    try {
      pending.push(await readFile(file));
    } catch (e) {
      alert("Could not read " + file.name + ": " + e.message);
    }
    drawPending();
  }
  $("fileInput").value = "";
};

// You can also paste an image (Ctrl+V) straight into the message box
$("input").addEventListener("paste", async (e) => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith("image/")) {
      pending.push(await readFile(item.getAsFile()));
      drawPending();
    }
  }
});

async function readFile(file) {
  const name = file.name || "pasted-image.png";
  if (file.type.startsWith("image/")) return { name: name, image: await shrinkImage(file) };

  let text;
  if (name.toLowerCase().endsWith(".pdf")) text = await readPdf(file);
  else if (name.toLowerCase().endsWith(".docx")) text = await readDocx(file);
  else text = await file.text();

  // 📊 Data files: the FULL file goes to Python (▶ Run can do pd.read_csv("name.csv")),
  // the AI only gets a preview — saves its memory on big datasets
  if (/\.(csv|tsv|json)$/i.test(name)) {
    dataFiles[name] = text;
    const lines = text.split("\n");
    if (lines.length > 40) {
      text = lines.slice(0, 40).join("\n") + "\n…(preview: first 40 of " + lines.length + " lines. The full file is available to " +
        "▶ Run Python code as '" + name + "', e.g. pd.read_csv('" + name + "'))";
    }
  }

  if (text.length > MAX_FILE_CHARS) text = text.slice(0, MAX_FILE_CHARS) + "\n…(file cut here, too long)";
  return { name: name, text: text };
}

// Load a helper library only when it's first needed (keeps the page fast)
function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[src="' + url + '"]')) return resolve();
    const s = document.createElement("script");
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error("could not load " + url));
    document.head.appendChild(s);
  });
}

async function readPdf(file) {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  await loadScript(base + "pdf.min.js");
  pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += "\n[Page " + i + "]\n" + content.items.map((item) => item.str).join(" ");
  }
  if (!text.replace(/\[Page \d+\]/g, "").trim()) throw new Error("this PDF has no text (it may be scanned images)");
  return text;
}

async function readDocx(file) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return result.value;
}

// Make big photos smaller so they upload fast (max 1280 px, JPEG)
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("not a valid image"));
    img.src = URL.createObjectURL(file);
  });
}

// Show the active skill + waiting files as chips with an ✕ to remove
function drawPending() {
  $("attachments").innerHTML = "";
  if (activeSkill) {
    const chip = document.createElement("span");
    chip.className = "file-chip skill-chip";
    chip.innerHTML = "<span></span><button title='Turn skill off'>✕</button>";
    chip.querySelector("span").textContent = "🧩 " + activeSkill.icon + " " + activeSkill.name;
    chip.querySelector("button").onclick = () => setSkill(null);
    $("attachments").appendChild(chip);
  }
  pending.forEach((f, i) => {
    const chip = document.createElement("span");
    chip.className = "file-chip";
    chip.innerHTML = (f.image ? '<img alt="">' : "📄") + "<span></span><button title='Remove'>✕</button>";
    if (f.image) chip.querySelector("img").src = f.image;
    chip.querySelector("span").textContent = f.name + (f.text ? " (" + Math.round(f.text.length / 1000) + "k chars)" : "");
    chip.querySelector("button").onclick = () => { pending.splice(i, 1); drawPending(); };
    $("attachments").appendChild(chip);
  });
}

// ---------- 🧩 Skills ----------
// The chosen skill is remembered in this browser and sent with every message.

let activeSkill = null;
try { activeSkill = JSON.parse(localStorage.getItem("nexus-skill")); } catch (e) { /* none */ }

function setSkill(skill) {
  // Library skills (fabric / personas) aren't stored on the server, so we keep their text here
  const fromLibrary = skill && (skill.group === "fabric" || skill.group === "persona");
  activeSkill = skill ? { id: skill.id, icon: skill.icon, name: skill.name, prompt: fromLibrary ? skill.prompt : undefined } : null;
  localStorage.setItem("nexus-skill", JSON.stringify(activeSkill));
  drawPending();
}

// The big library (fabric patterns + prompts.chat personas) loads the first time you open Skills
let skillLibrary = null;
let skillGroup = "all";

$("skillBtn").onclick = async () => {
  $("skillsBox").showModal();
  $("skillSearch").value = "";
  await drawSkills();
  $("skillSearch").focus();
};
$("skillSearch").oninput = () => drawSkills();
document.querySelectorAll(".skill-tabs button").forEach((tab) => {
  tab.onclick = () => {
    skillGroup = tab.dataset.group;
    document.querySelectorAll(".skill-tabs button").forEach((t) => t.classList.toggle("on", t === tab));
    drawSkills();
  };
});

async function drawSkills() {
  const mine = await (await api("skills")).json();                 // built-in + your own
  mine.forEach((s) => (s.group = s.builtin ? "builtin" : "mine"));
  if (!skillLibrary) {
    try {
      skillLibrary = await (await fetch("skills-library.json")).json();
      $("skillsCredit").innerHTML = "Library: " + skillLibrary.sources.map((s) => '<a href="' + s.url + '" target="_blank">' + s.name + "</a> (" + s.license + ")").join(" · ");
    } catch (e) { skillLibrary = { skills: [] }; }
  }

  const words = $("skillSearch").value.toLowerCase().split(/\s+/).filter(Boolean);
  const skills = mine.concat(skillLibrary.skills).filter((s) =>
    (skillGroup === "all" || s.group === skillGroup) &&
    words.every((w) => (s.name + " " + s.prompt.slice(0, 400)).toLowerCase().includes(w))
  );

  $("skillsList").innerHTML = skills.length ? "" : "<p class='muted'>No skill found.</p>";
  for (const s of skills.slice(0, 80)) {                         // show at most 80 at once
    if (s.group === "fabric" || s.group === "persona") s.builtin = true;   // library skills can't be deleted
    const card = document.createElement("button");
    card.className = "skill-card" + (activeSkill && activeSkill.id === s.id ? " active" : "");
    card.title = s.prompt;
    card.textContent = s.icon + " " + s.name;
    card.onclick = () => {
      setSkill(activeSkill && activeSkill.id === s.id ? null : s);   // click again = turn off
      $("skillsBox").close();
    };
    if (!s.builtin) {                     // your own skills can be deleted
      const del = document.createElement("span");
      del.className = "del";
      del.textContent = "✕";
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Delete skill " + s.name + "?")) return;
        await api("skills/" + s.id, "DELETE");
        if (activeSkill && activeSkill.id === s.id) setSkill(null);
        drawSkills();
      };
      card.appendChild(del);
    }
    $("skillsList").appendChild(card);
  }
}

$("saveSkill").onclick = async () => {
  const skill = { icon: $("skillIcon").value || "⭐", name: $("skillName").value.trim(), prompt: $("skillPrompt").value.trim() };
  if (!skill.name || !skill.prompt) return alert("Please write a name and instructions.");
  const res = await api("skills", "POST", skill);
  setSkill({ id: (await res.json()).id, icon: skill.icon, name: skill.name });
  $("skillIcon").value = $("skillName").value = $("skillPrompt").value = "";
  drawSkills();
};

// ---------- 📚 Documents library ----------

$("openDocs").onclick = () => {
  $("docsBox").showModal();
  drawDocs();
};

async function drawDocs() {
  const docs = await (await api("docs")).json();
  $("docsList").innerHTML = docs.length ? "" : "No documents yet.";
  for (const d of docs) {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "📄 <span></span><small></small><button title='Delete'>🗑</button>";
    row.querySelector("span").textContent = d.name;
    row.querySelector("small").textContent = Math.round(d.chars / 1000) + "k chars";
    row.querySelector("button").onclick = async () => {
      if (!confirm("Delete " + d.name + "?")) return;
      await api("docs/" + d.id, "DELETE");
      drawDocs();
    };
    $("docsList").appendChild(row);
  }
}

$("uploadDocs").onclick = () => $("docsInput").click();
$("docsInput").onchange = async () => {
  for (const file of $("docsInput").files) {
    $("docsList").textContent = "Reading " + file.name + "…";
    try {
      const f = await readFile(file);         // same reader as 📎 attachments
      if (!f.text) throw new Error("only text documents (PDF, Word, text) can be saved");
      $("docsList").textContent = "Saving " + file.name + "…";
      const res = await api("docs", "POST", { name: f.name, text: f.text });
      if (!res.ok) throw new Error((await res.json()).error);
    } catch (e) {
      alert(file.name + ": " + e.message);
    }
  }
  $("docsInput").value = "";
  drawDocs();
};

// ---------- ⬇️ Export the open chat ----------

$("openExport").onclick = () => {
  // download + share need an open chat; import works anytime
  ["exportPrettyPdf", "exportDocx", "exportIpynb", "exportMd", "exportPdf", "shareChat", "unshareChat"].forEach((id) => ($(id).disabled = !currentChatId));
  $("shareLink").hidden = true;
  $("importStatus").textContent = "";
  $("exportBox").showModal();
};

// 🔗 Share: a secret read-only link to this ONE chat
$("shareChat").onclick = async () => {
  const { token: t } = await (await api("share", "POST", { chatId: currentChatId })).json();
  const link = location.origin + "/share?t=" + t;
  $("shareLink").value = link;
  $("shareLink").hidden = false;
  $("shareLink").select();
  navigator.clipboard.writeText(link).catch(() => {});
  toast("🔗 Link copied — anyone with it can read this chat");
};
$("unshareChat").onclick = async () => {
  await api("share?chatId=" + currentChatId, "DELETE");
  $("shareLink").hidden = true;
  toast("🔒 Link turned off");
};

// 📥 Import ChatGPT history. ChatGPT stores each chat as a tree of messages ("mapping");
// we walk from the last message back to the first to get the conversation in order.
$("importChatGPT").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const file = $("importFile").files[0];
  if (!file) return;
  $("importStatus").textContent = "Reading " + file.name + "…";
  let chats;
  try {
    chats = JSON.parse(await file.text()).map((conv) => {
      const messages = [];
      let node = conv.current_node;
      while (node && conv.mapping[node]) {
        const m = conv.mapping[node].message;
        if (m && m.author && (m.author.role === "user" || m.author.role === "assistant") && m.content) {
          const text = (m.content.parts || []).filter((p) => typeof p === "string").join("\n").trim();
          if (text) messages.unshift({ role: m.author.role, content: text, created: Math.round((m.create_time || conv.create_time) * 1000) });
        }
        node = conv.mapping[node].parent;
      }
      return { title: conv.title, created: Math.round(conv.create_time * 1000), messages: messages };
    }).filter((c) => c.messages.length);
  } catch (e) {
    $("importStatus").textContent = "❌ That doesn't look like ChatGPT's conversations.json";
    return;
  }
  let done = 0;
  for (let i = 0; i < chats.length; i += 10) {              // 10 chats per request
    const res = await api("import", "POST", { chats: chats.slice(i, i + 10) });
    done += (await res.json()).imported || 0;
    $("importStatus").textContent = "Imported " + done + " / " + chats.length + " chats…";
  }
  $("importStatus").textContent = "✅ Imported " + done + " chats into the 📁 Imported folder";
  $("importFile").value = "";
  loadChats();
};

// ⌨️ Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {        // Ctrl+K: search chats
    e.preventDefault();
    document.body.classList.add("menu-open");
    $("searchChats").focus();
  } else if (e.altKey && e.key.toLowerCase() === "n") {                 // Alt+N: new chat
    e.preventDefault();
    newChat();
  } else if (e.key === "/" && !typing) {                                // "/": jump to the message box
    e.preventDefault();
    $("input").focus();
  }
});

$("exportMd").onclick = () => {
  const title = $("chatTitle").textContent || "NEXUS chat";
  let md = "# " + title + "\n\n*Exported from NEXUS on " + new Date().toLocaleString() + "*\n\n";
  for (const m of history) {
    const text = m.content.replace(FILE_BLOCK, (all, name) => "\n\n📄 *" + name + " attached*");
    md += (m.role === "user" ? "## 🧑 You\n\n" : "## 🤖 NEXUS\n\n") + text + "\n\n---\n\n";
  }
  // Make a file in the browser and "click" a hidden download link
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
  link.download = title.replace(/[^\w\- ]+/g, "").slice(0, 50) + ".md";
  link.click();
  $("exportBox").close();
};

$("exportPdf").onclick = () => {
  $("exportBox").close();
  setTimeout(() => window.print(), 200);    // choose "Save as PDF" in the print window
};

// ---------- Small helpers for messages on screen ----------

function toast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
const timeText = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

// ---------- 🎨 Images window ----------

$("openImages").onclick = () => {
  $("gallery").innerHTML = "";
  $("imageBox").showModal();
  $("imgPrompt").focus();
};

$("makeImageBtn").onclick = () => {
  const prompt = $("imgPrompt").value.trim();
  if (!prompt) return alert("Describe the picture first.");
  imageOptions = { style: $("imgStyle").value, size: $("imgSize").value, enhance: $("imgEnhance").checked, engine: $("imgEngine").value };
  $("imageBox").close();
  $("imgPrompt").value = "";
  send("/image " + prompt);        // same path as typing /image in the chat
};

$("showGallery").onclick = async () => {
  $("gallery").textContent = "Loading…";
  const images = await (await api("gallery")).json();
  $("gallery").innerHTML = images.length ? "" : "No pictures yet.";
  for (const img of images) {
    const link = document.createElement("a");
    link.href = img.url;
    link.target = "_blank";
    link.title = img.prompt;
    link.innerHTML = '<img loading="lazy" alt="">';
    link.querySelector("img").src = img.url;
    $("gallery").appendChild(link);
  }
};

// ---------- ⏰ Reminders window ----------

$("openReminders").onclick = async () => {
  $("remindersBox").showModal();
  // default time: 1 hour from now (datetime-local wants "YYYY-MM-DDTHH:MM" in YOUR time zone)
  const soon = new Date(Date.now() + 3600000 - new Date().getTimezoneOffset() * 60000);
  $("remWhen").value = soon.toISOString().slice(0, 16);
  drawReminders();
};

async function drawReminders() {
  const data = await (await api("reminders")).json();
  $("remList").innerHTML = data.upcoming.length ? "" : "No upcoming reminders.";
  for (const r of data.upcoming) {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "⏰ <span></span><small></small><button title='Delete'>🗑</button>";
    row.querySelector("span").textContent = r.text;
    row.querySelector("small").textContent = timeText(r.due);
    row.querySelector("button").onclick = async () => { await api("reminders/" + r.id, "DELETE"); drawReminders(); };
    $("remList").appendChild(row);
  }
  $("ntfyHelp").innerHTML = data.ntfyTopic
    ? "1. Install the free <b>ntfy</b> app (Play Store / App Store).<br>2. Tap <b>+</b> and subscribe to this topic:<br><code>" +
      data.ntfyTopic + "</code><br>3. Done — reminders will pop up on your phone (keep the topic name secret)."
    : "Phone alerts are not set up yet (NTFY_TOPIC is missing).";
}

$("addReminder").onclick = async () => {
  if (!$("remWhen").value || !$("remText").value.trim()) return alert("Pick a time and write what to remind you about.");
  await api("reminders", "POST", { due: new Date($("remWhen").value).getTime(), text: $("remText").value.trim() });
  $("remText").value = "";
  drawReminders();
  toast("⏰ Reminder saved");
};

// While the website is open, check every minute for reminders that are due now
const shownReminders = new Set(JSON.parse(localStorage.getItem("nexus-shown") || "[]"));
async function checkReminders() {
  if (!token()) return;
  try {
    const data = await (await api("reminders")).json();
    const now = Date.now();
    const all = data.upcoming.concat(data.sent);
    for (const r of all) {
      if (r.due <= now && now - r.due < 30 * 60000 && !shownReminders.has(r.id)) {
        shownReminders.add(r.id);
        toast("⏰ " + r.text);
        if ("Notification" in window && Notification.permission === "granted") new Notification("NEXUS reminder", { body: r.text, icon: "icon-192.png" });
      }
    }
    localStorage.setItem("nexus-shown", JSON.stringify([...shownReminders].slice(-100)));
  } catch (e) { /* offline or logged out */ }
}
setInterval(checkReminders, 60000);
// Ask once for permission to show desktop notifications
$("openReminders").addEventListener("click", () => {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
});

// ---------- 📊 Usage window ----------

$("openUsage").onclick = async () => {
  $("usageBox").showModal();
  const u = await (await api("usage")).json();
  let html = "";
  for (const p of u.providers) {
    const pct = p.limit ? Math.min(100, Math.round((p.count / p.limit) * 100)) : 0;
    html += '<div class="usage-row"><span>' + p.name + '</span><div class="bar"><div class="' + (pct > 80 ? "high" : "") +
      '" style="width:' + (p.limit ? pct : 100) + '%;' + (p.limit ? "" : "opacity:.25") + '"></div></div><small>' +
      p.count + (p.limit ? " / ~" + p.limit : "") + "</small></div>";
  }
  if (!u.providers.length) html = "No answers yet today.";
  if (u.week.length) {
    const max = Math.max(...u.week.map((d) => d.count));
    html += '<p class="muted" style="margin-top:18px">Last 7 days</p><div class="week">' + u.week.map((d) =>
      '<div style="height:' + Math.max(3, (d.count / max) * 100) + '%" title="' + d.count + ' answers"><small>' + d.day.slice(5) + "</small></div>").join("") + "</div>";
  }
  if (u.models.length) {
    html += '<p class="muted" style="margin-top:28px">Models used today</p>' + u.models.slice(0, 10).map((m) =>
      '<div class="doc-row"><span>' + m.name + " · " + m.model + "</span><small>" + m.count + "</small></div>").join("");
  }
  $("usageResult").innerHTML = html;
};

// ---------- 📱 Phone app (PWA) ----------
// The service worker (sw.js) keeps a copy of the website, so it opens instantly and works offline.
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

// "Share to NEXUS" from other apps opens  /?text=...  → put it in the message box
const shared = new URLSearchParams(location.search);
if (shared.get("text") || shared.get("url")) {
  $("input").value = [shared.get("title"), shared.get("text"), shared.get("url")].filter(Boolean).join("\n");
  window.history.replaceState(null, "", "/");   // clean the address bar ("history" alone is our chat list)
}

// ---------- 🎤 Voice input ----------
// Records your voice in the browser, sends it to /api/transcribe (free Whisper),
// and puts the text in the message box so you can check it before sending.

let recorder = null;
$("micBtn").onclick = async () => {
  if (recorder && recorder.state === "recording") {
    recorder.stop();                       // second click = stop
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    alert("Microphone not allowed. Click the 🔒 icon in the address bar to allow it.");
    return;
  }
  const chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());   // turn the mic off
    $("micBtn").classList.remove("recording");
    $("micBtn").textContent = "⏳";
    try {
      const form = new FormData();
      form.append("audio", new Blob(chunks, { type: recorder.mimeType }), "voice.webm");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "x-nexus-key": token() },
        body: form,
      });
      const data = await res.json();
      if (data.text) {
        $("input").value = ($("input").value + " " + data.text).trim();
        autoGrow();
        $("input").focus();
      } else alert(data.error || "Could not understand the audio");
    } finally {
      $("micBtn").textContent = "🎤";
    }
  };
  recorder.start();
  $("micBtn").classList.add("recording");
};

// ---------- 🔊 Read answers aloud ----------
// Two voices (switch with 🗣️ Voice in the sidebar):
//   Browser — the voice built into your browser / phone (instant, works offline, any language)
//   Natural — Kokoro-82M (Hugging Face), runs IN your browser with kokoro-js: sounds human,
//             English only, downloads ~90 MB the first time (then cached)
let voiceMode = localStorage.getItem("nexus-voice") || "browser";
let kokoro = null, kokoroAudio = null, kokoroStop = false;

$("toggleVoice").onclick = () => {
  voiceMode = voiceMode === "browser" ? "natural" : "browser";
  localStorage.setItem("nexus-voice", voiceMode);
  $("toggleVoice").textContent = voiceMode === "natural" ? "🗣️ Voice: natural" : "🗣️ Voice: browser";
  toast(voiceMode === "natural" ? "🗣️ Natural voice (Kokoro). First use downloads ~90 MB." : "🗣️ Browser voice");
};
$("toggleVoice").textContent = voiceMode === "natural" ? "🗣️ Voice: natural" : "🗣️ Voice: browser";

function speak(text, button) {
  // Remove markdown symbols and code blocks so it sounds natural
  const plain = text.replace(/```[\s\S]*?```/g, " (code block) ").replace(/[#*_`>|\[\]]/g, "").replace(/\(https?:[^)]+\)/g, "");
  const english = !/[ऀ-ॿ]/.test(plain);
  if (voiceMode === "natural" && english) return speakNatural(plain, button);

  if (speechSynthesis.speaking) {          // clicking again = stop
    speechSynthesis.cancel();
    button.textContent = "🔊 Read";
    return;
  }
  const voice = new SpeechSynthesisUtterance(plain);
  voice.lang = /[ऀ-ॿ]/.test(plain) ? "hi-IN" : "en-IN";   // Hindi letters → Hindi voice
  voice.onend = () => (button.textContent = "🔊 Read");
  button.textContent = "⏹ Stop";
  speechSynthesis.speak(voice);
}

// Kokoro: the text is split into sentences; each one is turned into audio and played in order
async function speakNatural(text, button) {
  if (button.textContent.startsWith("⏹")) {          // clicking again = stop
    kokoroStop = true;
    if (kokoroAudio) kokoroAudio.pause();
    button.textContent = "🔊 Read";
    return;
  }
  kokoroStop = false;
  button.textContent = "⏳ Loading voice…";
  try {
    if (!kokoro) {
      const { KokoroTTS } = await import("https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm");
      kokoro = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "wasm" });
    }
    button.textContent = "⏹ Stop";
    const sentences = text.match(/[^.!?\n]+[.!?]*/g) || [text];
    let next = kokoro.generate(sentences[0], { voice: "af_heart" });     // prepare the first sentence
    for (let i = 0; i < sentences.length && !kokoroStop; i++) {
      const audio = await next;
      if (i + 1 < sentences.length) next = kokoro.generate(sentences[i + 1], { voice: "af_heart" });   // prepare the next while this one plays
      kokoroAudio = new Audio(URL.createObjectURL(audio.toBlob()));
      await new Promise((done) => { kokoroAudio.onended = done; kokoroAudio.onpause = done; kokoroAudio.play(); });
    }
  } catch (e) {
    toast("Natural voice failed (" + e.message + ") — using the browser voice");
    voiceMode = "browser";
    speak(text, button);
    return;
  }
  button.textContent = "🔊 Read";
}

// ---------- 5. Pop-ups and buttons ----------

function askPassword(message) {
  $("loginError").textContent = message || "";
  if (!$("passwordBox").open) $("passwordBox").showModal();
}

// Log in: send the password once, keep only the token we get back
$("passwordForm").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: $("passwordInput").value }),
  });
  const data = await res.json();
  if (!res.ok) {
    $("loginError").textContent = data.error;
    return;
  }
  localStorage.setItem("nexus-token", data.token);
  localStorage.removeItem("nexus-key");     // old versions stored the password itself — delete it
  $("passwordInput").value = "";
  $("passwordBox").close();
  start();
};

// Log out this device, or every device
$("openLogout").onclick = () => $("logoutBox").showModal();
async function logout(everywhere) {
  await api("logout", "POST", { everywhere: everywhere }).catch(() => {});
  localStorage.removeItem("nexus-token");
  location.reload();
}
$("logoutHere").onclick = () => logout(false);
$("logoutAll").onclick = () => logout(true);

// 🧠 Memory window: facts NEXUS learned (current + history)
$("openMemory").onclick = () => {
  $("memoryBox").showModal();
  drawFacts();
};

async function drawFacts() {
  const data = await (await api("facts")).json();
  const dateOf = (ms) => new Date(ms).toLocaleDateString([], { dateStyle: "medium" });
  $("factsList").innerHTML = data.current.length ? "" : "Nothing yet — chat a bit and NEXUS will learn about you.";
  for (const f of data.current) {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "🧠 <span></span><small></small><button title='Forget this'>🗑</button>";
    row.querySelector("span").textContent = f.text;
    row.querySelector("small").textContent = "since " + dateOf(f.valid_from);
    row.querySelector("button").onclick = async () => { await api("facts/" + f.id, "DELETE"); drawFacts(); };
    $("factsList").appendChild(row);
  }
  $("pastFacts").innerHTML = data.past.length ? "" : "No changes yet.";
  for (const f of data.past) {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "🕘 <span></span><small></small><button title='Delete from history'>🗑</button>";
    row.querySelector("span").textContent = f.text;
    row.querySelector("small").textContent = dateOf(f.valid_from) + " → " + dateOf(f.invalid_at);
    row.querySelector("button").onclick = async () => { await api("facts/" + f.id, "DELETE"); drawFacts(); };
    $("pastFacts").appendChild(row);
  }

  // 📏 lessons learned from 👎
  const lessons = await (await api("lessons")).json();
  $("lessonsList").innerHTML = lessons.length ? "" : "None yet — press 👎 on an answer you don't like and say why.";
  for (const l of lessons) {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "📏 <span></span><button title='Remove'>🗑</button>";
    row.querySelector("span").textContent = l.text;
    row.querySelector("button").onclick = async () => { await api("lessons?id=" + l.id, "DELETE"); drawFacts(); };
    $("lessonsList").appendChild(row);
  }

  // 🏆 rankings
  const ratings = await (await api("ratings")).json();
  $("ratingsList").innerHTML = ratings.length ? "" : "No votes yet — use 👍👎 or ⚔️ Battle mode.";
  ratings.forEach((r, n) => {
    const row = document.createElement("div");
    row.className = "doc-row";
    row.innerHTML = "<b></b><span></span><small></small>";
    row.querySelector("b").textContent = n + 1 + ".";
    row.querySelector("span").textContent = r.provider + " · " + r.model;
    row.querySelector("small").textContent = Math.round(r.elo) + " pts · ⚔️ " + r.wins + "-" + r.losses + " · 👍" + r.ups + " 👎" + r.downs +
      (r.test_score ? " · test " + r.test_score.toFixed(1) + "/10" : "");
    $("ratingsList").appendChild(row);
  });
}

$("addFact").onclick = async () => {
  const text = $("newFact").value.trim();
  if (!text) return;
  await api("facts", "POST", { text: text });
  $("newFact").value = "";
  drawFacts();
};

$("openDoctor").onclick = async () => {
  $("doctorResult").textContent = "Checking every provider…";
  $("doctorBox").showModal();
  const res = await api("doctor");
  const rows = await res.json();
  $("doctorResult").innerHTML = rows.map((r) => {
    const icon = r.status === "ok" ? "✅" : r.status === "no key" ? "➖" : "❌";
    const info = r.status === "ok" ? r.ms + " ms" : r.status === "no key" ? "add " + r.key : r.error;
    return '<div class="doctor-row"><span>' + icon + " " + r.name + "</span><small>" + info + "</small></div>";
  }).join("");
};

// Every "Close" button closes its pop-up
document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));

// Light / dark theme (remembered in this browser)
$("toggleTheme").onclick = () => {
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  localStorage.setItem("nexus-theme", document.documentElement.dataset.theme);
  redrawCharts();          // charts and diagrams use different colors in dark mode
  redrawDiagrams();
};
if (localStorage.getItem("nexus-theme")) document.documentElement.dataset.theme = localStorage.getItem("nexus-theme");

// Mobile menu
function closeMenu() { document.body.classList.remove("menu-open"); }
$("openSidebar").onclick = () => document.body.classList.add("menu-open");
$("closeSidebar").onclick = closeMenu;
$("overlay").onclick = closeMenu;

// Message box: Enter = send, Shift+Enter = new line, grows as you type
function autoGrow() {
  $("input").style.height = "auto";
  $("input").style.height = $("input").scrollHeight + "px";
}
$("input").addEventListener("input", autoGrow);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send($("input").value);
  }
});
$("composer").onsubmit = (e) => {
  e.preventDefault();
  send($("input").value);
};

$("newChat").onclick = newChat;
$("searchChats").oninput = drawChatList;
document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => send(c.textContent)));

// Greeting based on time of day
const hour = new Date().getHours();
$("greeting").textContent = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

// Load the model list into the dropdown
async function loadModels() {
  const res = await api("models");
  const models = await res.json();
  const select = $("modelPick");
  select.querySelectorAll("optgroup.models").forEach((g) => g.remove());   // only the model lists (keep Explain / Deep modes)

  const groups = {};
  for (const m of models) {
    if (!groups[m.provider]) {
      groups[m.provider] = document.createElement("optgroup");
      groups[m.provider].className = "models";
      groups[m.provider].label = m.provider;
      select.appendChild(groups[m.provider]);
    }
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.model;
    groups[m.provider].appendChild(opt);
  }
  await findMyPCModels();
  select.value = localStorage.getItem("nexus-model") || "auto";
  if (!select.value) select.value = "auto";   // saved model no longer exists
}

// 🌐 Tools button: on = NEXUS may search the web, check weather, news…
let toolsOn = localStorage.getItem("nexus-tools") !== "off";
function drawToolsButton() {
  $("toolsBtn").classList.toggle("on", toolsOn);
  $("toolsBtn").title = toolsOn ? "Tools ON: web search, weather, news… (click to turn off)" : "Tools OFF (click to turn on)";
}
$("toolsBtn").onclick = () => {
  toolsOn = !toolsOn;
  localStorage.setItem("nexus-tools", toolsOn ? "on" : "off");
  drawToolsButton();
};
drawToolsButton();
$("modelPick").onchange = () => localStorage.setItem("nexus-model", $("modelPick").value);

// ---------- Start ----------
async function start() {
  drawPending();          // shows the saved skill chip, if any
  try {
    await loadModels();
    await loadChats();
  } catch (e) { /* password pop-up is showing */ }
}
start();
