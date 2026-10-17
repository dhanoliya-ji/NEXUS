// ============================================================
//  learn.js — 🗺️ roadmap, 🃏 flashcards, 💼 interview practice
// ============================================================
//  Roadmap + interview questions come from alirezadir/AIMLInterviews (MIT), imported into
//  web/learning.json by scripts/import-learning.js. Flashcards are scheduled with FSRS
//  (open-spaced-repetition/ts-fsrs, MIT): it shows a card again right before you'd forget it.

let learning = null;            // web/learning.json (loaded once)
async function loadLearning() {
  if (!learning) learning = await (await fetch("learning.json")).json();
  return learning;
}

// ---------- 🗺️ Roadmap ----------
let roadmapArea = 0;
const topicKey = (a, s, t) => a + " › " + s + " › " + t;
const STATUS_NEXT = { "": "learning", learning: "done", done: "" };
const STATUS_ICON = { "": "⚪", learning: "🟡", done: "✅" };

$("openRoadmap").onclick = async () => {
  $("roadmapBox").showModal();
  await drawRoadmap();
};

async function drawRoadmap() {
  const data = await loadLearning();
  const progress = await (await api("progress")).json();

  // tabs (one per area) with % done
  $("roadmapTabs").innerHTML = "";
  data.roadmap.forEach((area, i) => {
    const keys = area.sections.flatMap((s) => s.topics.map((t) => topicKey(area.area, s.name, t)));
    const done = keys.filter((k) => progress[k] === "done").length;
    const tab = document.createElement("button");
    tab.className = i === roadmapArea ? "on" : "";
    tab.textContent = area.area.replace(/\(.*?\)/g, "").trim() + " · " + Math.round((done / keys.length) * 100) + "%";
    tab.onclick = () => { roadmapArea = i; drawRoadmap(); };
    $("roadmapTabs").appendChild(tab);
  });

  // "next up": the first topic not done yet
  const area = data.roadmap[roadmapArea];
  let next = null;
  for (const s of area.sections) for (const t of s.topics) if (!next && progress[topicKey(area.area, s.name, t)] !== "done") next = { s: s.name, t };
  $("roadmapNext").innerHTML = next ? "👉 Next up: <b></b> <button class='ghost' id='learnNext'>🎓 Learn it</button>" : "🎉 You finished this area!";
  if (next) {
    $("roadmapNext").querySelector("b").textContent = next.t;
    $("learnNext").onclick = () => learnTopic(area.area, next.s, next.t);
  }

  // sections with topics
  $("roadmapList").innerHTML = "";
  for (const s of area.sections) {
    const box = document.createElement("div");
    box.className = "roadmap-section";
    box.innerHTML = "<h4></h4>";
    box.querySelector("h4").textContent = s.name;
    for (const t of s.topics) {
      const key = topicKey(area.area, s.name, t);
      const status = progress[key] || "";
      const row = document.createElement("div");
      row.className = "doc-row topic-row";
      row.innerHTML = '<button class="status" title="Click: not started → learning → done"></button><span></span><button title="Learn it with NEXUS">🎓</button><button title="Flashcards for this topic">🃏</button>';
      row.querySelector(".status").textContent = STATUS_ICON[status];
      row.querySelector("span").textContent = t;
      const [statusBtn, , learnBtn, cardBtn] = row.children;
      statusBtn.onclick = async () => { await api("progress", "PUT", { topic: key, status: STATUS_NEXT[status] }); drawRoadmap(); };
      learnBtn.onclick = () => learnTopic(area.area, s.name, t);
      cardBtn.onclick = async () => {
        cardBtn.textContent = "⏳";
        const r = await (await api("cards", "POST", { deck: area.area, text: "Topic: " + t + " (" + area.area + " › " + s.name + "). Make flashcards covering its key ideas." })).json();
        cardBtn.textContent = "🃏";
        toast(r.added ? "🃏 " + r.added + " flashcards added to " + area.area : "⚠️ " + (r.error || "No cards made"));
      };
      box.appendChild(row);
    }
    $("roadmapList").appendChild(box);
  }
}

// 🎓 Learn a topic: new chat in Explain mode, topic marked "learning"
async function learnTopic(area, section, topic) {
  $("roadmapBox").close();
  await api("progress", "PUT", { topic: topicKey(area, section, topic), status: "learning" });
  newChat();
  $("modelPick").value = "explain-intermediate";
  send("Explain: " + topic + " (in " + area + " › " + section + ")");
}

// ---------- 🃏 Flashcards ----------
let fsrsLib = null, reviewQueue = [], reviewing = null;

async function loadFsrs() {
  if (!fsrsLib) fsrsLib = await import("https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.2/+esm");
  return fsrsLib;
}

$("openCards").onclick = async () => {
  $("cardsBox").showModal();
  await drawDecks();
};

async function drawDecks() {
  const all = await (await api("cards")).json();
  const now = Date.now();
  const decks = {};
  for (const c of all) {
    decks[c.deck] = decks[c.deck] || { total: 0, due: 0 };
    decks[c.deck].total++;
    if (c.due <= now) decks[c.deck].due++;
  }
  const due = all.filter((c) => c.due <= now).length;
  $("cardsSummary").textContent = all.length ? "📚 " + all.length + " cards · " + due + " to review now" : "No flashcards yet — press 🃏 under an answer, on a note, or on a roadmap topic.";
  $("decksList").innerHTML = Object.entries(decks).map(([name, d]) => "<div class='doc-row'><span>🃏 " + DOMPurify.sanitize(name) + "</span><small>" + d.due + " due / " + d.total + "</small></div>").join("");
  $("startReview").disabled = !due;
  $("reviewArea").hidden = true;
  $("decksArea").hidden = false;
}

$("startReview").onclick = async () => {
  await loadFsrs();
  reviewQueue = await (await api("cards?due=1")).json();
  $("decksArea").hidden = true;
  $("reviewArea").hidden = false;
  nextCard();
};

function nextCard() {
  reviewing = reviewQueue.shift();
  if (!reviewing) {
    toast("🎉 Review done!");
    drawDecks();
    return;
  }
  $("cardDeck").textContent = reviewing.deck + " · " + (reviewQueue.length + 1) + " left";
  $("cardFront").innerHTML = toHtml(reviewing.front);
  $("cardBack").innerHTML = toHtml(reviewing.back);
  $("cardBack").hidden = true;
  $("showAnswer").hidden = false;
  $("rateButtons").hidden = true;
}

$("showAnswer").onclick = () => {
  $("cardBack").hidden = false;
  $("showAnswer").hidden = true;
  $("rateButtons").hidden = false;
};

// Again / Hard / Good / Easy → FSRS calculates when to show this card next
document.querySelectorAll("#rateButtons button").forEach((btn) => {
  btn.onclick = async () => {
    const { fsrs, createEmptyCard } = fsrsLib;
    const state = reviewing.fsrs ? JSON.parse(reviewing.fsrs) : createEmptyCard(new Date());
    const next = fsrs().next(state, new Date(), Number(btn.dataset.rating)).card;
    await api("cards/" + reviewing.id, "PUT", { fsrs: next, due: new Date(next.due).getTime() });
    if (Number(btn.dataset.rating) === 1) reviewQueue.push({ ...reviewing, fsrs: JSON.stringify(next) });   // "Again" → see it again today
    nextCard();
  };
});

// "🃏 Cards" under an answer or in a note → flashcards from that text
async function makeCards(text, deck) {
  toast("🃏 Making flashcards…");
  const r = await (await api("cards", "POST", { deck: deck || "General", text: text })).json();
  toast(r.added ? "🃏 " + r.added + " flashcards added to “" + (deck || "General") + "”" : "⚠️ " + (r.error || "No cards made"));
}

// ---------- 💼 Interview practice ----------
let interview = null;           // {question} while you're answering an interview question in this chat

$("openInterview").onclick = async () => {
  const data = await loadLearning();
  const cats = [...new Set(data.questions.map((q) => q.category))];
  $("interviewCat").innerHTML = cats.map((c) => "<option>" + c + "</option>").join("");
  $("interviewBox").showModal();
  newQuestion();
};
$("interviewCat").onchange = () => newQuestion();
$("newQuestion").onclick = () => newQuestion();

function newQuestion() {
  const list = learning.questions.filter((q) => q.category === $("interviewCat").value);
  $("interviewQ").textContent = list[Math.floor(Math.random() * list.length)].q;
}

// Start answering: a new chat with the question; your next messages are graded
$("answerQuestion").onclick = async () => {
  const question = $("interviewQ").textContent;
  $("interviewBox").close();
  newChat();
  interview = { question: question };
  const res = await api("chats", "POST", { title: "💼 " + question.slice(0, 45) });
  currentChatId = (await res.json()).id;
  $("chatTitle").textContent = "💼 Interview practice";
  const intro = "### 💼 Interview question\n\n" + question + "\n\n*Type your answer below (or use 🎤). I'll grade it and ask a follow-up.*";
  addMessage("assistant", intro, "Interview practice");
  history.push({ role: "assistant", content: intro });
  await api("messages", "POST", { chatId: currentChatId, role: "assistant", content: intro, model: "Interview practice" });
  loadChats();
  $("input").focus();
};

// The grading instructions (used by askAI while interview mode is on)
function interviewPrompt() {
  return "You are a senior ML engineer interviewing the user. The interview question is: \"" + interview.question + "\". " +
    "Grade the user's latest answer: ## Score (x/10); ## What was good; ## What was missing or wrong; ## Model answer " +
    "(concise, with math/code if useful); ## Follow-up question (one, slightly harder). Be honest but encouraging.";
}
