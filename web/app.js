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

// Turn markdown text into safe HTML, with math formulas drawn by KaTeX.
//
// Why so many steps? The markdown converter would break math ( \cdot, x_1 … ),
// so we take the math OUT first, convert the markdown, then put the drawn math back.
//   1. hide code blocks (math inside code must stay as code)
//   2. find math: $$…$$, \[…\], \(…\), $…$  → draw it with KaTeX, leave a placeholder
//   3. put the code back, convert markdown → HTML, clean it (DOMPurify)
//   4. replace the placeholders with the drawn math
function toHtml(text) {
  text = text || "";
  const code = [], math = [];
  const hideCode = (s) => { code.push(s); return "@@CODE" + (code.length - 1) + "@@"; };
  const drawMath = (tex, display) => {
    if (typeof katex === "undefined") return display ? "$$" + tex + "$$" : "$" + tex + "$";
    math.push(katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }));
    return "@@MATH" + (math.length - 1) + "@@";
  };

  text = text.replace(/```[\s\S]*?(```|$)|`[^`\n]+`/g, hideCode);
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (all, a, b) => drawMath(a || b, true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (all, a) => drawMath(a, false));
  // $…$ only when it looks like math: no space just inside the $ signs and no digit right after
  // (so "costs $5 and $10" stays normal text)
  text = text.replace(/\$(?=\S)([^\n$]+?)(?<=\S)\$(?!\d)/g, (all, a) => drawMath(a, false));
  text = text.replace(/@@CODE(\d+)@@/g, (all, i) => code[i]);

  const html = DOMPurify.sanitize(marked.parse(text));
  return html.replace(/@@MATH(\d+)@@/g, (all, i) => math[i]);
}

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

  div.innerHTML = '<div class="bubble"><div class="text"></div><div class="files"></div></div>';
  div.querySelector(".text").textContent = visible;
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
      '<div class="meta"><span class="model"></span><button class="copy">Copy</button><button class="speak">🔊 Read</button></div></div>';
    div.querySelector(".content").innerHTML = toHtml(text);
    div.querySelector(".model").textContent = model || "";
    div.querySelector(".copy").onclick = () => copyText(div.dataset.raw || text, div.querySelector(".copy"));
    div.querySelector(".speak").onclick = () => speak(div.dataset.raw || text, div.querySelector(".speak"));
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
};
const SPECIAL_MODES = ["council", "research", "careful"];

// Ask the AI and show the answer word by word as it arrives
//   choice = "auto" | "council" | "research" | "groq/model…" | "pc/qwen3:4b"
async function askAI(text, choice, images) {
  const div = addMessage("assistant", "", images ? "👀 Looking at your image…" : WAITING[choice] || "Thinking…");
  const content = div.querySelector(".content");
  content.classList.add("typing");

  const body = {
    chatId: currentChatId, messages: history, model: choice, tools: toolsOn, images: images,
    skill: activeSkill ? activeSkill.id : null,
  };
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
// Options come from the 🎨 window (style, size, improve prompt); /image in chat uses the defaults.
let imageOptions = null;
async function makeImage(prompt) {
  const opt = imageOptions || { style: "", size: "1024x1024", enhance: true };
  imageOptions = null;
  const [width, height] = opt.size.split("x");
  const fullPrompt = opt.style ? prompt + ", " + opt.style : prompt;
  const url = "https://image.pollinations.ai/prompt/" + encodeURIComponent(fullPrompt) +
    "?width=" + width + "&height=" + height + "&nologo=true" + (opt.enhance ? "&enhance=true" : "") +
    "&seed=" + Math.floor(Math.random() * 99999);
  const answer = "![" + prompt.replace(/[\[\]]/g, "") + "](" + url + ")\n\n*" + prompt + "*";

  addMessage("assistant", answer, "Pollinations.ai · image");
  history.push({ role: "assistant", content: answer });

  // Save both messages (the user one was not saved by /api/chat this time)
  await api("messages", "POST", { chatId: currentChatId, role: "user", content: "/image " + prompt });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: answer, model: "Pollinations.ai · image" });
  scrollDown();
}

// ---------- 📎 Attachments ----------
// Files are read IN YOUR BROWSER (nothing is uploaded except the text or picture):
//   PDF  → text with pdf.js        Word (.docx) → text with mammoth.js
//   text / code files → read as-is  images → shrunk to max 1280 px, sent to a model that can see

let pending = [];   // files waiting to be sent: {name, text} or {name, image}
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
  activeSkill = skill ? { id: skill.id, icon: skill.icon, name: skill.name } : null;
  localStorage.setItem("nexus-skill", JSON.stringify(activeSkill));
  drawPending();
}

$("skillBtn").onclick = async () => {
  $("skillsBox").showModal();
  await drawSkills();
};

async function drawSkills() {
  const skills = await (await api("skills")).json();
  $("skillsList").innerHTML = "";
  for (const s of skills) {
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
  if (!history.length) return alert("Open a chat first.");
  $("exportBox").showModal();
};

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
  imageOptions = { style: $("imgStyle").value, size: $("imgSize").value, enhance: $("imgEnhance").checked };
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
// Uses the voice built into your browser / phone (free, works offline)
function speak(text, button) {
  if (speechSynthesis.speaking) {          // clicking again = stop
    speechSynthesis.cancel();
    button.textContent = "🔊 Read";
    return;
  }
  // Remove markdown symbols and code blocks so it sounds natural
  const plain = text.replace(/```[\s\S]*?```/g, " (code block) ").replace(/[#*_`>|\[\]]/g, "").replace(/\(https?:[^)]+\)/g, "");
  const voice = new SpeechSynthesisUtterance(plain);
  voice.lang = /[ऀ-ॿ]/.test(plain) ? "hi-IN" : "en-IN";   // Hindi letters → Hindi voice
  voice.onend = () => (button.textContent = "🔊 Read");
  button.textContent = "⏹ Stop";
  speechSynthesis.speak(voice);
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
  redrawCharts();          // charts use different colors in dark mode
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
  drawPending();          // shows the saved skill chip, if any
  try {
    await loadModels();
    await loadChats();
  } catch (e) { /* password pop-up is showing */ }
}
start();
