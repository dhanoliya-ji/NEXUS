// ============================================================
//  POST /api/litreview — 📚 literature review of an AI/ML topic
// ============================================================
//   1. PLAN    — 3 search queries for the topic
//   2. FIND    — real papers (title, authors, year, abstract) from Hugging Face Papers
//   3. WRITE   — intro, timeline, comparison table, themes, open problems, references
//   4. BIBTEX  — built from the REAL metadata by code (lib/papers.js), added at the end
//  Papers are numbered [1]..[n]; the writer may only cite those, so nothing is invented.

import { saveMessage } from "../../lib/db.js";
import { getProvider, isReady } from "../../lib/providers.js";
import { askHelper } from "../../lib/memory.js";
import { searchPapers, bibtex } from "../../lib/papers.js";
import { streamFirst } from "../../lib/run.js";
import { liveStream } from "../../lib/live.js";

const WRITERS = ["gemini", "groq", "cloudflare", "nvidia", "openrouter", "zai"];

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages } = await context.request.json();
  const topic = messages[messages.length - 1].content.replace(/^\/review\s*/, "");

  return liveStream(context, async (live) => {
    await saveMessage(env.DB, chatId, "user", messages[messages.length - 1].content, "");

    // 1. PLAN
    live.status("🧭 Planning the literature search…");
    let queries = [topic];
    const plan = await askHelper(env, [
      { role: "system", content: "Reply with ONLY a JSON array of 3 short search queries (keywords, not sentences)." },
      { role: "user", content: "Research topic for a literature review of AI/ML papers: " + topic },
    ], 300, ["groq", "cloudflare"]);
    try { queries = JSON.parse(plan.match(/\[[\s\S]*\]/)[0]).slice(0, 3).map(String); } catch (e) { /* keep the topic */ }

    // 2. FIND papers (unique, best first)
    live.status("📄 Finding papers: " + queries.join(" · "));
    const results = await Promise.allSettled(queries.map((q) => searchPapers(q, 8)));
    const papers = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const p of r.value) if (!papers.some((x) => x.id === p.id) && papers.length < 14) papers.push(p);
    }
    if (papers.length < 2) return live.send({ nexus_error: "Couldn't find enough papers on this topic. Try other keywords." });
    papers.sort((a, b) => (a.year || "").localeCompare(b.year || ""));     // oldest → newest (timeline order)

    // 3. WRITE
    live.status("✍️ Writing the review from " + papers.length + " papers…");
    const list = papers.map((p, i) => "[" + (i + 1) + "] " + p.title + " — " + p.authors.slice(0, 4).join(", ") + (p.authors.length > 4 ? " et al." : "") +
      " (" + p.year + ") " + p.url + "\nAbstract: " + p.summary.slice(0, 1200)).join("\n\n");
    const prompt = [
      {
        role: "system",
        content:
          "You are an expert AI/ML researcher writing a LITERATURE REVIEW for a student, in markdown, using ONLY the numbered papers given. " +
          "Structure: # title; ## Introduction (what the topic is and why it matters); ## Timeline (how ideas evolved, by year); " +
          "## Comparison table (columns: # | Paper | Year | Key idea / method | Data / tasks | Main result — use only facts from the abstracts, write '—' if unknown); " +
          "## Themes and trends; ## Open problems; ## What to read first (3 papers and why); ## References (numbered list with links). " +
          "Cite as [1], [2] with plain square brackets. Never invent papers, numbers or results.",
      },
      { role: "user", content: "TOPIC: " + topic + "\n\nPAPERS:\n" + list },
    ];
    const writers = WRITERS.map(getProvider).filter((p) => isReady(p, env)).map((p) => ({ provider: p, model: p.models[0] }));
    const { res, step } = await streamFirst(env, writers, prompt);
    if (!res) return live.send({ nexus_error: "No model could write the review." });
    await live.send({ nexus_info: { model: "Literature review · " + papers.length + " papers · " + step.provider.name, tools: "papers",
      providerId: step.provider.id, modelId: step.model } });
    await live.pipe(res.body);

    // 4. BIBTEX from real metadata
    await live.send({ choices: [{ delta: { content: "\n\n## BibTeX\n```bibtex\n" + bibtex(papers) + "\n```\n" } }] });
  });
}
