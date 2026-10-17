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

// Call our backend. Adds the password automatically.
async function api(path, method, body) {
  const res = await fetch("/api/" + path, {
    method: method || "GET",
    headers: { "Content-Type": "application/json", "x-nexus-key": localStorage.getItem("nexus-key") || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {          // wrong or missing password → ask for it
    askPassword();
    throw new Error("password needed");
  }
  return res;
}

// Turn markdown text into safe HTML
function toHtml(text) {
  return DOMPurify.sanitize(marked.parse(text || ""));
}

// ---------- 2. Chat list (left sidebar) ----------

let allChats = [];

async function loadChats() {
  const res = await api("chats");
  allChats = await res.json();
  drawChatList();
}

function drawChatList() {
  const filter = $("searchChats").value.toLowerCase();
  $("chatList").innerHTML = "";

  for (const chat of allChats) {
    if (filter && !chat.title.toLowerCase().includes(filter)) continue;

    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === currentChatId ? " active" : "");
    item.innerHTML = '<span class="name"></span><button class="del" title="Delete">🗑</button>';
    item.querySelector(".name").textContent = chat.title;
    item.onclick = () => openChat(chat.id, chat.title);
    item.querySelector(".del").onclick = (e) => {
      e.stopPropagation();          // don't also open the chat
      deleteChat(chat.id);
    };
    $("chatList").appendChild(item);
  }
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

// Add one message to the screen. Returns its element.
function addMessage(role, text, model) {
  welcome.remove();
  const div = document.createElement("div");
  div.className = "msg " + role;

  if (role === "user") {
    div.innerHTML = '<div class="bubble"></div>';
    div.querySelector(".bubble").textContent = text;
  } else {
    div.innerHTML =
      '<img class="avatar" src="icon.svg" alt="">' +
      '<div class="body"><div class="content"></div>' +
      '<div class="meta"><span class="model"></span><button class="copy">Copy</button></div></div>';
    div.querySelector(".content").innerHTML = toHtml(text);
    div.querySelector(".model").textContent = model || "";
    div.querySelector(".copy").onclick = () => copyText(div.dataset.raw || text, div.querySelector(".copy"));
    decorateCode(div);
  }
  $("messages").appendChild(div);
  return div;
}

// Color code blocks + add a "Copy" button to each
function decorateCode(div) {
  div.querySelectorAll("pre code").forEach((block) => {
    hljs.highlightElement(block);
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
  if (!text || busy) return;
  busy = true;
  $("send").disabled = true;
  $("input").value = "";
  autoGrow();

  // New chat? Create it first (title = start of your first message)
  if (!currentChatId) {
    const res = await api("chats", "POST", { title: text.slice(0, 50) });
    currentChatId = (await res.json()).id;
    $("chatTitle").textContent = text.slice(0, 50);
  }

  addMessage("user", text);
  history.push({ role: "user", content: text });
  scrollDown();

  try {
    if (text.startsWith("/image ")) await makeImage(text.slice(7));
    else if (text.startsWith("/research ")) await askAI(text, "research");
    else await askAI(text, $("modelPick").value);
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
};

// Ask the AI and show the answer word by word as it arrives
//   choice = "auto" | "council" | "research" | "groq/model…" | "pc/qwen3:4b"
async function askAI(text, choice) {
  const div = addMessage("assistant", "", WAITING[choice] || "Thinking…");
  const content = div.querySelector(".content");
  content.classList.add("typing");

  const body = { chatId: currentChatId, messages: history, model: choice, tools: toolsOn };
  let res;
  if (choice.startsWith("pc/")) res = await askMyPC(choice.slice(3), body);
  else res = await api(choice === "council" || choice === "research" ? choice : "chat", "POST", body);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    content.classList.remove("typing");
    content.innerHTML = '<p class="error-text">⚠️ ' + (err.error || "Something went wrong") +
      (err.details ? "<br><small>" + err.details.join("<br>") + "</small>" : "") + "</p>";
    history.pop();
    return;
  }

  // Info about the answer (sent by our backend in headers)
  const modelName = decodeURIComponent(res.headers.get("x-nexus-model") || res.nexusModel || "");
  const memCount = res.headers.get("x-nexus-memories") || res.nexusMemories;
  const toolsUsed = res.headers.get("x-nexus-tools") || res.nexusTools;
  let info = modelName;
  if (memCount > 0) info += " · used " + memCount + " memories";
  div.querySelector(".model").innerHTML = "";
  div.querySelector(".model").textContent = info;
  if (toolsUsed) {
    const tag = document.createElement("span");
    tag.className = "used-tools";
    tag.textContent = " · 🛠 " + toolsUsed.replace(/_/g, " ");
    div.querySelector(".model").appendChild(tag);
  }

  // Read the stream. It arrives as lines like:  data: {"choices":[{"delta":{"content":"Hel"}}]}
  let answer = "";
  let thinking = "";
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
        const delta = JSON.parse(data).choices[0].delta || {};
        if (delta.content) answer += delta.content;
        if (delta.reasoning_content || delta.reasoning) thinking += delta.reasoning_content || delta.reasoning;
      } catch (e) { /* not JSON, skip */ }
    }

    showAnswer(div, answer, thinking);
    scrollDown();
  }

  content.classList.remove("typing");
  answer = answer.replace(/<think>[\s\S]*?<\/think>/, "").trim();   // don't save the thinking part
  div.dataset.raw = answer;
  decorateCode(div);

  // Save the answer (and let NEXUS update its memory in the background)
  history.push({ role: "assistant", content: answer });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: answer, model: modelName, userText: text });
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

// Create a picture with Pollinations.ai (free, no key needed)
async function makeImage(prompt) {
  const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt) +
    "?width=1024&height=1024&nologo=true&seed=" + Math.floor(Math.random() * 99999);
  const answer = "![" + prompt.replace(/[\[\]]/g, "") + "](" + url + ")\n\n*" + prompt + "*";

  addMessage("assistant", answer, "Pollinations.ai · image");
  history.push({ role: "assistant", content: answer });

  // Save both messages (the user one was not saved by /api/chat this time)
  await api("messages", "POST", { chatId: currentChatId, role: "user", content: "/image " + prompt });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: answer, model: "Pollinations.ai · image" });
  scrollDown();
}

// ---------- 5. Pop-ups and buttons ----------

function askPassword() {
  if (!$("passwordBox").open) $("passwordBox").showModal();
}
$("passwordForm").onsubmit = () => {
  localStorage.setItem("nexus-key", $("passwordInput").value);
  setTimeout(start, 50);
};

$("openMemory").onclick = async () => {
  const res = await api("profile");
  $("memoryText").value = (await res.json()).text;
  $("memoryBox").showModal();
};
$("saveMemory").onclick = async () => {
  await api("profile", "PUT", { text: $("memoryText").value });
  $("memoryBox").close();
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
  select.querySelectorAll("optgroup").forEach((g) => g.remove());

  const groups = {};
  for (const m of models) {
    if (!groups[m.provider]) {
      groups[m.provider] = document.createElement("optgroup");
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
  try {
    await loadModels();
    await loadChats();
  } catch (e) { /* password pop-up is showing */ }
}
start();
