// ============================================================
//  import-learning.js — builds web/learning.json (roadmap + interview questions)
// ============================================================
//  Run:  node scripts/import-learning.js      (also monthly on GitHub, with the skills update)
//
//  Source: alirezadir/AIMLInterviews (MIT) — a carefully maintained guide for ML interviews.
//   • roadmap   ← "ML Fundamentals Topics": areas (## …) → sections (### …) → topics (- …)
//                 Classic ML, Deep learning, Statistical ML, LLMs, Multimodal & GenAI …
//   • questions ← its sample questions + ML system design case studies

const fs = require("fs");
const RAW = "https://raw.githubusercontent.com/alirezadir/AIMLInterviews/main/src/";

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "NEXUS-learning-import" } });
  if (!res.ok) throw new Error(url + " → " + res.status);
  return res.text();
}
// "[Name](link)" → "Name", remove *bold* marks and trailing colons
const clean = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").replace(/:$/, "").trim();

function parseRoadmap(md) {
  const start = md.indexOf("# 2. ML Fundamentals Topics");
  const end = md.indexOf("# 3. ML Fundamentals Sample Questions");
  const lines = md.slice(start, end > 0 ? end : undefined).split("\n");
  const roadmap = [];
  let area = null, section = null;
  for (const line of lines) {
    const a = line.match(/^## \d+\.\s*(.+)/);
    const s = line.match(/^###\s+(.+)/);
    const t = line.match(/^ {0,2}(?:-|\d+\.) (.+)/);     // only top-level bullets / numbered items = topics
    if (a) { area = { area: clean(a[1]), sections: [] }; roadmap.push(area); section = null; }
    else if (s && area) { section = { name: clean(s[1]), topics: [] }; area.sections.push(section); }
    else if (t && area) {
      if (!section) { section = { name: "Core topics", topics: [] }; area.sections.push(section); }
      const topic = clean(t[1]);
      if (topic && !/^TBD/i.test(topic) && topic.length < 140) section.topics.push(topic);
    }
  }
  return roadmap.map((a) => ({ ...a, sections: a.sections.filter((s) => s.topics.length) })).filter((a) => a.sections.length);
}

function parseQuestions(md) {
  const start = md.indexOf("# 3. ML Fundamentals Sample Questions");
  if (start < 0) return [];
  const questions = [];
  let category = "ML fundamentals";
  for (const line of md.slice(start).split("\n")) {
    const h = line.match(/^#{2,4}\s+(.+)/);
    const q = line.match(/^\s*(?:-|\d+\.)\s+(.+)/);
    if (h) category = /LLM|GenAI|Multimodal/i.test(h[1]) ? "LLMs & GenAI" : "ML fundamentals";
    else if (q && clean(q[1]).length > 15) questions.push({ category: category, q: clean(q[1]) });
  }
  return questions;
}

(async () => {
  const fundamentals = await getText(RAW + "ml-fundamental.md");
  const roadmap = parseRoadmap(fundamentals);
  const questions = parseQuestions(fundamentals);

  // ML system design case studies → "Design …" questions (from the file names)
  const tree = JSON.parse(await getText("https://api.github.com/repos/alirezadir/AIMLInterviews/git/trees/main?recursive=1")).tree;
  const designs = tree.map((t) => t.path).filter((p) => /^src\/MLSD\/mlsd[-_].+\.md$/.test(p) && !/template|metrics|feature-eng|preprocessing|modeling/.test(p))
    .map((p) => p.split("/").pop().replace(/^mlsd[-_]/, "").replace(/\.md$/, "").replace(/[-_]/g, " "));
  for (const d of designs) questions.push({ category: "ML system design", q: "Design an ML system for " + d + ". Cover the problem framing, data, features, model, training, evaluation metrics and serving." });

  const learning = {
    updated: new Date().toISOString().slice(0, 10),
    source: { name: "alirezadir/AIMLInterviews", url: "https://github.com/alirezadir/AIMLInterviews", license: "MIT" },
    roadmap: roadmap,
    questions: questions,
  };
  fs.writeFileSync("web/learning.json", JSON.stringify(learning));
  const topics = roadmap.reduce((n, a) => n + a.sections.reduce((m, s) => m + s.topics.length, 0), 0);
  console.log("✅ roadmap: " + roadmap.length + " areas, " + topics + " topics | questions: " + questions.length + " (" +
    [...new Set(questions.map((q) => q.category))].join(", ") + ")");
  console.log(roadmap.map((a) => "   " + a.area + ": " + a.sections.map((s) => s.name + " (" + s.topics.length + ")").join(", ")).join("\n"));
})();
