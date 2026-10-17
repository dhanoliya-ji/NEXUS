// ============================================================
//  notes.js — 🗒️ your study notes
// ============================================================
//  • "🗒️ Save" under any answer → becomes a note (title + topic)
//  • 🗒️ Notes window: notes grouped by topic, search, open, edit, delete
//  • export one note, or tick several → one "study guide" PDF / Word file (exporter.js)
//  Notes are also searchable by NEXUS, so it uses them in later answers.

let editingNote = null;          // the note open in the editor ({id?, title, topic, content})

$("openNotes").onclick = () => {
  $("notesBox").showModal();
  $("notesSearch").value = "";
  drawNotes();
};
$("notesSearch").oninput = () => drawNotes();

async function drawNotes() {
  const q = $("notesSearch").value.trim();
  const notes = await (await api("notes" + (q ? "?q=" + encodeURIComponent(q) : ""))).json();
  $("notesList").innerHTML = notes.length ? "" : "<p class='muted'>No notes yet — press 🗒️ Save under any answer.</p>";

  // group by topic
  const topics = {};
  notes.forEach((n) => (topics[n.topic] = topics[n.topic] || []).push(n));
  for (const topic of Object.keys(topics).sort()) {
    const group = document.createElement("details");
    group.className = "topic-group";
    group.open = true;
    group.innerHTML = "<summary></summary>";
    group.querySelector("summary").textContent = "📁 " + topic + " (" + topics[topic].length + ")";
    for (const n of topics[topic]) {
      const row = document.createElement("div");
      row.className = "note-row";
      row.innerHTML = '<input type="checkbox" title="Select for a study guide"><span></span><small></small>';
      row.querySelector("input").dataset.id = n.id;
      row.querySelector("span").textContent = n.title;
      row.querySelector("small").textContent = new Date(n.updated).toLocaleDateString();
      row.querySelector("span").onclick = () => openNote(n.id);
      group.appendChild(row);
    }
    $("notesList").appendChild(group);
  }
  $("topicList").innerHTML = Object.keys(topics).map((t) => '<option value="' + t.replace(/"/g, "&quot;") + '">').join("");
}

// Open a saved note (or a new one) in the editor window
async function openNote(id, fresh) {
  editingNote = id ? await (await api("notes/" + id)).json() : fresh;
  $("noteTitle").value = editingNote.title || "";
  $("noteTopic").value = editingNote.topic || localStorage.getItem("nexus-last-topic") || "General";
  $("noteEditor").value = editingNote.content || "";
  $("deleteNote").hidden = !editingNote.id;
  showNoteTab("preview");
  $("noteBox").showModal();
}

function showNoteTab(tab) {
  $("notePreview").hidden = tab !== "preview";
  $("noteEditor").hidden = tab !== "edit";
  document.querySelectorAll("#noteBox .skill-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "preview") {
    $("notePreview").innerHTML = toHtml($("noteEditor").value);
    $("notePreview").querySelectorAll("pre code").forEach((b) =>
      b.classList.contains("language-chart") ? renderChart(b) : b.classList.contains("language-mermaid") ? renderMermaid(b) : hljs.highlightElement(b));
  }
}
document.querySelectorAll("#noteBox .skill-tabs button").forEach((b) => (b.onclick = () => showNoteTab(b.dataset.tab)));

const currentNote = () => ({ title: $("noteTitle").value.trim() || "Untitled note", topic: $("noteTopic").value.trim() || "General", content: $("noteEditor").value });

$("saveNote").onclick = async () => {
  const note = currentNote();
  if (!note.content.trim()) return alert("The note is empty.");
  localStorage.setItem("nexus-last-topic", note.topic);
  if (editingNote && editingNote.id) await api("notes/" + editingNote.id, "PUT", note);
  else editingNote = { ...note, id: (await (await api("notes", "POST", note)).json()).id };
  toast("🗒️ Note saved in " + note.topic);
  $("noteBox").close();
  if ($("notesBox").open) drawNotes();
};

$("deleteNote").onclick = async () => {
  if (!editingNote.id || !confirm("Delete this note?")) return;
  await api("notes/" + editingNote.id, "DELETE");
  $("noteBox").close();
  drawNotes();
};

// Export the open note
$("notePdf").onclick = () => { const n = currentNote(); exportPdf([{ title: n.title, markdown: n.content }], n.title); };
$("noteDocx").onclick = () => { const n = currentNote(); exportDocx([{ title: n.title, markdown: n.content }], n.title); };
$("noteMd").onclick = () => { const n = currentNote(); exportMarkdown([{ title: n.title, markdown: n.content }], n.title); };

// Several ticked notes → one study guide (cover page + contents + every note)
async function selectedNotes() {
  const ids = [...document.querySelectorAll("#notesList input:checked")].map((c) => c.dataset.id);
  if (!ids.length) { alert("Tick the notes you want in the study guide first."); return null; }
  const notes = await Promise.all(ids.map(async (id) => (await api("notes/" + id)).json()));
  return notes.map((n) => ({ title: n.title, markdown: n.content }));
}
$("guidePdf").onclick = async () => {
  const docs = await selectedNotes();
  if (docs) { const t = prompt("Title of the study guide:", "My study guide"); if (t) exportPdf(docs, t, t); }
};
$("guideDocx").onclick = async () => {
  const docs = await selectedNotes();
  if (docs) { const t = prompt("Title of the study guide:", "My study guide"); if (t) exportDocx(docs, t, t); }
};
$("newNote").onclick = () => openNote(null, { title: "", topic: "", content: "" });

// "🗒️ Save" under an answer → a new note filled with that answer
function saveAnswerAsNote(div) {
  const msgs = [...document.querySelectorAll("#messages .msg")];
  const i = msgs.indexOf(div);
  const answer = div.dataset.raw || (history[i] && history[i].content) || div.querySelector(".content").innerText;
  const heading = (answer.match(/^#{1,3}\s+(.+)$/m) || [])[1];
  const question = i > 0 && history[i - 1] ? history[i - 1].content.replace(FILE_BLOCK, "").trim() : "";
  openNote(null, { title: (heading || question || "Note").replace(/[#*`]/g, "").slice(0, 90), topic: "", content: answer });
  api("notes").then((r) => r.json()).then((notes) => {
    $("topicList").innerHTML = [...new Set(notes.map((n) => n.topic))].map((t) => '<option value="' + t.replace(/"/g, "&quot;") + '">').join("");
  });
}

// Chat export as pretty PDF / Word (from the ⬇️ window)
function chatAsDocs() {
  const title = $("chatTitle").textContent || "NEXUS chat";
  const md = history.map((m) => (m.role === "user" ? "### 🧑 You\n\n" : "### 🤖 NEXUS\n\n") + m.content.replace(FILE_BLOCK, (a, name) => "\n📄 *" + name + "*")).join("\n\n---\n\n");
  return { title: title, docs: [{ title: title, markdown: md }] };
}
$("exportPrettyPdf").onclick = () => { const c = chatAsDocs(); $("exportBox").close(); exportPdf(c.docs, c.title); };
$("exportDocx").onclick = () => { const c = chatAsDocs(); $("exportBox").close(); exportDocx(c.docs, c.title); };
