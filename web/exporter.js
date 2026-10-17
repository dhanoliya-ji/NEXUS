// ============================================================
//  exporter.js — turn notes / chats into a real PDF or Word file
// ============================================================
//  PDF  → html2pdf.js (MIT, github.com/eKoopmans/html2pdf.js): the note is drawn exactly like
//         on screen (math, diagrams, charts, code colors) on white A4 pages.
//  Word → docx (MIT, github.com/dolanmiu/docx): headings, lists, tables and code become real
//         Word paragraphs you can edit (formulas stay as LaTeX text, diagrams as their code).
//  Everything happens in your browser — nothing is uploaded.
//
//  docs = [{title, markdown}, ...]   (one note, a chat, or many notes = a "study guide")

const HTML2PDF = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.14.0/dist/html2pdf.bundle.min.js";
const DOCX = "https://cdn.jsdelivr.net/npm/docx@9.8.1/+esm";
const safeName = (s) => String(s || "nexus").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "nexus";

// Build the pages: (cover + table of contents) + each document, rendered like on screen
async function renderForExport(docs, bookTitle) {
  const box = document.createElement("div");
  box.className = "export-doc";
  let html = "";
  if (bookTitle) {
    html += '<section class="cover"><h1>' + DOMPurify.sanitize(bookTitle) + "</h1><p>" + new Date().toLocaleDateString([], { dateStyle: "long" }) +
      "</p><p class='by'>Made with NEXUS</p></section>";
    if (docs.length > 1) {
      html += '<section class="toc page-break"><h2>Contents</h2><ol>' + docs.map((d) => "<li>" + DOMPurify.sanitize(d.title) + "</li>").join("") + "</ol></section>";
    }
  }
  docs.forEach((d, i) => {
    html += '<section class="' + (bookTitle || i > 0 ? "page-break" : "") + '"><h1 class="doc-title">' + DOMPurify.sanitize(d.title) + "</h1>" + toHtml(d.markdown) + "</section>";
  });
  box.innerHTML = html;
  const wrap = document.createElement("div");          // off-screen holder (see .export-wrap in style.css)
  wrap.className = "export-wrap";
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  // Draw charts and diagrams, color the code, remove on-screen buttons
  for (const block of [...box.querySelectorAll("pre code")]) {
    if (block.classList.contains("language-chart")) await renderChart(block);
    else if (block.classList.contains("language-mermaid")) await renderMermaid(block);
    else if (block.classList.contains("language-eqcode")) renderEqcode(block);
    else if (block.classList.contains("language-steps")) printSteps(block);
    else hljs.highlightElement(block);
  }
  box.querySelectorAll(".chart-actions, .run-code, .copy-code, .chart-table, .diagram-src").forEach((el) => el.remove());
  await new Promise((r) => setTimeout(r, 600));     // let charts finish drawing
  return box;
}

// 🐢 Step-through blocks in a PDF: all steps one after another
function printSteps(block) {
  let steps;
  try { steps = JSON.parse(block.textContent); } catch (e) {
    try { steps = JSON.parse(block.textContent.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch (e2) { return hljs.highlightElement(block); }
  }
  const div = document.createElement("div");
  div.innerHTML = steps.map((s, i) => "<h4>Step " + (i + 1) + " — " + DOMPurify.sanitize(s.title || "") + "</h4>" + toHtml(String(s.body || ""))).join("");
  block.parentElement.replaceWith(div);
}

async function exportPdf(docs, filename, bookTitle) {
  toast("📑 Making your PDF…");
  await loadScript(HTML2PDF);
  const theme = document.documentElement.dataset.theme;
  document.documentElement.dataset.theme = "light";          // paper is white
  const box = await renderForExport(docs, bookTitle);
  try {
    await html2pdf().set({
      margin: [12, 12, 14, 12],
      filename: safeName(filename) + ".pdf",
      image: { type: "jpeg", quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"], before: ".page-break", avoid: ["pre", "table", ".chart-box", "img", "h2", "h3", "li"] },
    }).from(box).save();
  } finally {
    box.parentElement.remove();                        // the off-screen holder
    if (theme) document.documentElement.dataset.theme = theme; else delete document.documentElement.dataset.theme;
    redrawCharts();
  }
}

// ---------- Word (.docx) ----------

// **bold**, *italic*, `code` → formatted Word text runs
function inlineRuns(d, text) {
  const runs = [];
  for (const piece of String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)) {
    if (!piece) continue;
    if (piece.startsWith("**")) runs.push(new d.TextRun({ text: piece.slice(2, -2), bold: true }));
    else if (piece.startsWith("`")) runs.push(new d.TextRun({ text: piece.slice(1, -1), font: "Consolas" }));
    else if (piece.startsWith("*")) runs.push(new d.TextRun({ text: piece.slice(1, -1), italics: true }));
    else runs.push(new d.TextRun(piece.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")));
  }
  return runs;
}

// One markdown block (from marked's lexer) → Word paragraphs
function blockToDocx(d, t) {
  const H = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
  switch (t.type) {
    case "heading": return [new d.Paragraph({ children: inlineRuns(d, t.text), heading: H[t.depth - 1] })];
    case "paragraph": return [new d.Paragraph({ children: inlineRuns(d, t.text), spacing: { after: 120 } })];
    case "list": return t.items.map((item, i) => new d.Paragraph({
      children: (t.ordered ? [new d.TextRun((i + 1) + ". ")] : []).concat(inlineRuns(d, item.text.split("\n")[0])),
      bullet: t.ordered ? undefined : { level: 0 }, indent: t.ordered ? { left: 360 } : undefined,
    }));
    case "code": {
      const note = t.lang === "mermaid" ? "[Diagram — Mermaid code below; the PDF shows the picture]" : t.lang === "chart" ? "[Chart data — the PDF shows the chart]" : "";
      return (note ? [new d.Paragraph({ children: [new d.TextRun({ text: note, italics: true, color: "777777" })] })] : []).concat(
        t.text.split("\n").map((line) => new d.Paragraph({ children: [new d.TextRun({ text: line || " ", font: "Consolas", size: 18 })], shading: { fill: "F3F3F3", type: d.ShadingType.CLEAR, color: "auto" } })));
    }
    case "table": {
      const row = (cells, bold) => new d.TableRow({ children: cells.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: c.text, bold: bold })] })] })) });
      return [new d.Table({ rows: [row(t.header, true)].concat(t.rows.map((r) => row(r, false))), width: { size: 100, type: d.WidthType.PERCENTAGE } }), new d.Paragraph("")];
    }
    case "blockquote": return [new d.Paragraph({ children: [new d.TextRun({ text: t.text, italics: true })], indent: { left: 400 } })];
    case "space": return [];
    case "hr": return [new d.Paragraph("")];
    default: return t.raw && t.raw.trim() ? [new d.Paragraph(DOMPurify.sanitize(t.raw, { ALLOWED_TAGS: [] }))] : [];
  }
}

async function exportDocx(docs, filename, bookTitle) {
  toast("📄 Making your Word file…");
  const d = await import(DOCX);
  const children = [];
  if (bookTitle) {
    children.push(new d.Paragraph({ text: bookTitle, heading: d.HeadingLevel.TITLE }));
    children.push(new d.Paragraph({ text: new Date().toLocaleDateString([], { dateStyle: "long" }) + " · Made with NEXUS" }));
  }
  docs.forEach((doc, i) => {
    children.push(new d.Paragraph({ text: doc.title, heading: d.HeadingLevel.HEADING_1, pageBreakBefore: i > 0 || Boolean(bookTitle) }));
    for (const block of marked.lexer(doc.markdown)) children.push(...blockToDocx(d, block));
  });
  const blob = await d.Packer.toBlob(new d.Document({ creator: "NEXUS", title: bookTitle || docs[0].title, sections: [{ children: children }] }));
  downloadBlob(blob, safeName(filename) + ".docx");
}

// ---------- 📓 Jupyter notebook (.ipynb) ----------
// Text → markdown cells, ```python blocks → code cells you can run in Jupyter / Google Colab.
// (Colab: colab.research.google.com → File → Upload notebook — free GPU for PyTorch.)
function exportNotebook(docs, filename) {
  const cells = [];
  const md = (text) => text.trim() && cells.push({ cell_type: "markdown", metadata: {}, source: lines(text.trim()) });
  const lines = (text) => text.split("\n").map((l, i, all) => (i < all.length - 1 ? l + "\n" : l));
  for (const doc of docs) {
    md("# " + doc.title);
    let rest = doc.markdown;
    const re = /```(?:python|py)\n([\s\S]*?)```/g;
    let m, last = 0;
    while ((m = re.exec(rest))) {
      md(rest.slice(last, m.index));
      cells.push({ cell_type: "code", metadata: {}, execution_count: null, outputs: [], source: lines(m[1].replace(/\n$/, "")) });
      last = re.lastIndex;
    }
    md(rest.slice(last));
  }
  const notebook = {
    nbformat: 4, nbformat_minor: 5,
    metadata: { kernelspec: { name: "python3", display_name: "Python 3", language: "python" }, language_info: { name: "python" }, colab: { provenance: [] } },
    cells: cells,
  };
  downloadBlob(new Blob([JSON.stringify(notebook, null, 1)], { type: "application/x-ipynb+json" }), safeName(filename) + ".ipynb");
  toast("📓 Notebook saved — open colab.research.google.com → File → Upload notebook");
}

function exportMarkdown(docs, filename) {
  const text = docs.map((d) => "# " + d.title + "\n\n" + d.markdown).join("\n\n---\n\n");
  downloadBlob(new Blob([text], { type: "text/markdown" }), safeName(filename) + ".md");
}

function downloadBlob(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
}
