// ============================================================
//  POST /api/research — Deep Research: a full report with sources
// ============================================================
//  Ideas from gpt-researcher, jina-ai/node-DeepResearch, dzhng/deep-research
//  and the STORM + Search-o1 papers:
//   1. PLAN     — split the topic into 4 search queries
//   2. SEARCH   — search all of them at once, pick the best pages
//   3. READ     — read the pages, and let a fast model CONDENSE each page into
//                 the facts that matter for the topic (Search-o1: "reason in documents");
//                 pages with nothing useful are dropped
//   4. REFLECT  — "what's still missing?" → a second round of searches for the gaps
//   5. WRITE    — the report is written from the condensed facts, citing [1], [2]…
//  Budget: about 30 outside requests (Cloudflare's free plan allows 50 per request).
//  Each step shows up live in the browser.

import { saveMessage } from "../../lib/db.js";
import { getProvider, isReady } from "../../lib/providers.js";
import { askHelper } from "../../lib/memory.js";
import { searchWeb, readUrl } from "../../lib/tools.js";
import { streamFirst } from "../../lib/run.js";
import { liveStream } from "../../lib/live.js";

const WRITERS = ["gemini", "groq", "cloudflare", "nvidia", "openrouter", "zai", "mistral"];
const SKIP_SITES = /youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|reddit\.com\/r\/.*\/comments/;
const today = () => new Date().toDateString();

// Ask a fast model for JSON; returns the parsed value or the fallback
async function askJson(env, system, user, fallback, prefer) {
  const answer = await askHelper(env, [{ role: "system", content: system }, { role: "user", content: user }], 600, prefer);
  try { return JSON.parse(answer.match(/[\[{][\s\S]*[\]}]/)[0]); } catch (e) { return fallback; }
}

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages } = await context.request.json();
  const topic = messages[messages.length - 1].content.replace(/^\/research\s*/, "");

  return liveStream(context, async (live) => {
    await saveMessage(env.DB, chatId, "user", messages[messages.length - 1].content, "");
    const seen = new Set();
    const sources = [];          // [{n, title, url, notes}]

    // Search some queries, read the best new pages, condense each one into notes
    async function round(queries, maxPages) {
      live.status("🔎 Searching: " + queries.join(" · "));
      const searches = await Promise.allSettled(queries.map((q) => searchWeb(q, env)));
      const pages = [];
      for (const s of searches) {
        if (s.status !== "fulfilled") continue;
        for (const r of s.value.slice(0, 3)) {
          if (seen.has(r.url) || SKIP_SITES.test(r.url) || pages.length >= maxPages) continue;
          seen.add(r.url);
          pages.push(r);
        }
      }
      if (!pages.length) return;

      live.status("📄 Reading and summarizing " + pages.length + " pages…");
      const texts = await Promise.allSettled(pages.map((p) => readUrl(p.url, env)));
      const prefer = [["groq", "cloudflare"], ["cloudflare", "groq"], ["gemini", "groq"]];   // spread the work
      const notes = await Promise.all(pages.map((p, i) => {
        const text = texts[i].status === "fulfilled" ? texts[i].value.slice(0, 6000) : p.snippet;
        return askHelper(env, [
          { role: "system", content: "Extract up to 8 short facts from the page that help research the topic. Keep numbers, dates, names. One fact per line starting with '- '. If nothing is relevant, reply NONE." },
          { role: "user", content: "TOPIC: " + topic + "\n\nPAGE: " + p.title + "\n" + text },
        ], 500, prefer[i % 3]).catch(() => "");
      }));
      pages.forEach((p, i) => {
        const n = notes[i].trim();
        if (n && !/^NONE\b/i.test(n)) sources.push({ n: sources.length + 1, title: p.title, url: p.url, notes: n.slice(0, 1500) });
      });
    }

    // 1. PLAN
    live.status("🧭 Planning the research…");
    let queries = await askJson(env, "Today is " + today() + ". Reply with ONLY a JSON array of strings.",
      "Write 4 different web search queries that together cover this research topic well:\n" + topic, [topic]);
    if (!Array.isArray(queries) || !queries.length) queries = [topic];

    // 2 + 3. First round
    await round(queries.slice(0, 4).map(String), 6);
    if (!sources.length) return live.send({ nexus_error: "Web search found nothing useful. Try different words." });

    // 4. REFLECT: what's missing? (second round for the gaps)
    live.status("🤔 Checking what's still missing…");
    const notesText = sources.map((s) => "[" + s.n + "] " + s.title + "\n" + s.notes).join("\n\n");
    const gaps = await askJson(env,
      'You review research notes. Reply ONLY JSON: {"enough": true/false, "gaps": ["search query", ...]} with at most 2 queries for important missing information.',
      "TOPIC: " + topic + "\n\nNOTES:\n" + notesText.slice(0, 12000), { enough: true, gaps: [] }, ["groq", "gemini"]);
    if (!gaps.enough && Array.isArray(gaps.gaps) && gaps.gaps.length) await round(gaps.gaps.slice(0, 2).map(String), 4);

    // 5. WRITE from the condensed notes
    live.status("✍️ Writing the report from " + sources.length + " sources…");
    const prompt = [
      {
        role: "system",
        content:
          "You are NEXUS, an expert research analyst. Today is " + today() + ". " +
          "Write a detailed, well-structured research report in markdown using ONLY the numbered notes given. " +
          "Start with a short summary, then sections with ## headings, then a 'Key takeaways' list. " +
          "Cite every claim inline with plain square brackets like [1] or [2][5] (never other citation styles such as 【1†L1】) — " +
          "only claims supported by the notes. " +
          "If sources disagree or information is missing, say so. End with a '## Sources' list of numbered markdown links.",
      },
      {
        role: "user",
        content: "RESEARCH TOPIC: " + topic + "\n\nNOTES FROM SOURCES:\n" +
          sources.map((s) => "[" + s.n + "] " + s.title + " — " + s.url + "\n" + s.notes).join("\n\n"),
      },
    ];
    const writers = WRITERS.map(getProvider).filter((p) => isReady(p, env)).map((p) => ({ provider: p, model: p.models[0] }));
    const { res, step } = await streamFirst(env, writers, prompt);
    if (!res) return live.send({ nexus_error: "No model could write the report." });
    await live.send({ nexus_info: { model: "Deep Research · " + sources.length + " sources · " + step.provider.name, tools: "web_search, read_url",
      providerId: step.provider.id, modelId: step.model } });
    await live.pipe(res.body);
  });
}
