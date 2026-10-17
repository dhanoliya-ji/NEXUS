// ============================================================
//  import-skills.js — builds web/skills-library.json from open-source prompt collections
// ============================================================
//  Run:  node scripts/import-skills.js        (also runs monthly on GitHub, see .github/workflows)
//
//  Sources (both free to reuse):
//   • danielmiessler/fabric  (MIT)  — ~265 expert "patterns": extract wisdom, summarize,
//     analyze claims, create quiz, improve writing… each is a ready-made system prompt.
//   • f/prompts.chat         (CC0)  — community "act as…" personas (Interviewer, Tutor…).
//  The website loads the file only when you open 🧩 Skills and search it.

const fs = require("fs");

const FABRIC_TREE = "https://api.github.com/repos/danielmiessler/fabric/git/trees/main?recursive=1";
const FABRIC_RAW = "https://raw.githubusercontent.com/danielmiessler/fabric/main/";
const PERSONAS_CSV = "https://raw.githubusercontent.com/f/prompts.chat/main/prompts.csv";
const MAX_PERSONAS = 300;

// "extract_wisdom" → "Extract wisdom"
const niceName = (s) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "NEXUS-skills-import" } });
  if (!res.ok) throw new Error(url + " → " + res.status);
  return res.text();
}

async function fabricSkills() {
  const tree = JSON.parse(await getText(FABRIC_TREE)).tree;
  const files = tree.map((t) => t.path).filter((p) => /^data\/patterns\/[^/]+\/system\.md$/.test(p));
  const skills = [];
  for (let i = 0; i < files.length; i += 20) {                  // 20 downloads at a time
    const batch = files.slice(i, i + 20);
    const texts = await Promise.all(batch.map((f) => getText(FABRIC_RAW + f).catch(() => "")));
    batch.forEach((file, j) => {
      const id = file.split("/")[2];
      const prompt = texts[j].trim();
      if (prompt.length > 80 && prompt.length < 12000) {
        skills.push({ id: "fabric-" + id, group: "fabric", icon: "🧵", name: niceName(id), prompt: prompt });
      }
    });
  }
  return skills;
}

// Tiny CSV reader (handles "quoted, fields" and "" inside quotes)
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function personaSkills() {
  const rows = parseCsv(await getText(PERSONAS_CSV));
  const header = rows.shift();
  const col = (name) => header.indexOf(name);
  const seen = new Set();
  const skills = [];
  for (const r of rows) {
    const act = (r[col("act")] || "").trim();
    const prompt = (r[col("prompt")] || "").trim();
    const type = (r[col("type")] || "TEXT").trim().toUpperCase();
    if (!act || seen.has(act.toLowerCase()) || type !== "TEXT" || prompt.length < 60 || prompt.length > 3000) continue;
    seen.add(act.toLowerCase());
    const id = "persona-" + act.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
    skills.push({ id: id, group: "persona", icon: "🎭", name: act, prompt: prompt });
    if (skills.length >= MAX_PERSONAS) break;
  }
  return skills;
}

(async () => {
  const fabric = await fabricSkills();
  const personas = await personaSkills();
  const library = {
    updated: new Date().toISOString().slice(0, 10),
    sources: [
      { name: "fabric patterns", url: "https://github.com/danielmiessler/fabric", license: "MIT © Daniel Miessler" },
      { name: "prompts.chat personas", url: "https://github.com/f/prompts.chat", license: "CC0" },
    ],
    skills: fabric.concat(personas),
  };
  fs.writeFileSync("web/skills-library.json", JSON.stringify(library));
  const kb = Math.round(fs.statSync("web/skills-library.json").size / 1024);
  console.log("✅ " + fabric.length + " fabric patterns + " + personas.length + " personas → web/skills-library.json (" + kb + " KB)");
})();
