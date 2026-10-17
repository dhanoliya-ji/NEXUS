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
  const docsUsed = decodeURIComponent(res.headers.get("x-nexus-docs") || res.nexusDocs || "");
  let info = modelName;
  if (memCount > 0) info += " · used " + memCount + " memories";
  if (docsUsed) info += " · 📚 " + docsUsed;
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
        headers: { "x-nexus-key": localStorage.getItem("nexus-key") || "" },
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
  drawPending();          // shows the saved skill chip, if any
  try {
    await loadModels();
    await loadChats();
  } catch (e) { /* password pop-up is showing */ }
}
start();
