// ============================================================
//  POST /api/research — Deep Research: a full report with sources
// ============================================================
//  Ideas from gpt-researcher and the STORM paper:
//   1. PLAN    — split your topic into 4 search questions
//   2. SEARCH  — search the web for all of them at the same time
//   3. READ    — read the best pages (up to 8)
//   4. WRITE   — a long-context model writes a report citing [1], [2]...

import { saveMessage, json } from "../../lib/db.js";
import { getProvider, isReady, callModel } from "../../lib/providers.js";
import { askHelper } from "../../lib/memory.js";
import { searchWeb, readUrl } from "../../lib/tools.js";

// Writers: Gemini first because it can read the most text (1M tokens)
const WRITERS = ["gemini", "groq", "cloudflare", "nvidia", "openrouter", "zai", "mistral"];
const SKIP_SITES = /youtube\.com|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com/;

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages } = await context.request.json();
  const topic = messages[messages.length - 1].content.replace(/^\/research\s*/, "");
  await saveMessage(env.DB, chatId, "user", messages[messages.length - 1].content, "");

  // 1. PLAN: ask a fast model for 4 search queries
  let queries = [topic];
  const plan = await askHelper(env, [
    { role: "system", content: "Today is " + new Date().toDateString() + ". Reply with ONLY a JSON array of strings." },
    { role: "user", content: "Write 4 different web search queries that together cover this research topic well:\n" + topic },
  ], 300);
  try {
    queries = JSON.parse(plan.match(/\[[\s\S]*\]/)[0]).slice(0, 4);
  } catch (e) { /* keep the topic as the only query */ }

  // 2. SEARCH: all queries at the same time
  const searches = await Promise.allSettled(queries.map((q) => searchWeb(q, env)));
  const picked = [];
  const seen = new Set();
  for (const s of searches) {
    if (s.status !== "fulfilled") continue;
    for (const r of s.value.slice(0, 3)) {               // best 3 per query
      if (seen.has(r.url) || SKIP_SITES.test(r.url) || picked.length >= 8) continue;
      seen.add(r.url);
      picked.push(r);
    }
  }
  if (picked.length === 0) return json({ error: "Web search found nothing. Try different words." }, 502);

  // 3. READ: download the pages at the same time (if a page fails, use its search snippet)
  const pages = await Promise.allSettled(picked.map((r) => readUrl(r.url, env)));
  let sources = "";
  picked.forEach((r, i) => {
    const text = pages[i].status === "fulfilled" ? pages[i].value.slice(0, 5000) : r.snippet;
    sources += "\n\n[" + (i + 1) + "] " + r.title + " — " + r.url + "\n" + text;
  });

  // 4. WRITE: stream the report
  const prompt = [
    {
      role: "system",
      content:
        "You are NEXUS, an expert research analyst. Today is " + new Date().toDateString() + ". " +
        "Write a detailed, well-structured research report in markdown using ONLY the sources given. " +
        "Start with a short summary, then sections with ## headings, then a 'Key takeaways' list. " +
        "Cite sources inline like [1] or [2][5]. End with a '## Sources' list of numbered markdown links. " +
        "If sources disagree or information is missing, say so.",
    },
    { role: "user", content: "RESEARCH TOPIC: " + topic + "\n\nSEARCH QUERIES USED: " + queries.join(" | ") + "\n\nSOURCES:" + sources },
  ];

  for (const writer of WRITERS.map(getProvider).filter((p) => isReady(p, env))) {
    try {
      const res = await callModel(env, writer, writer.models[0], prompt, true);
      if (res.ok) {
        return new Response(res.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "x-nexus-model": encodeURIComponent("Deep Research · " + picked.length + " sources · " + writer.name),
            "x-nexus-memories": "0",
            "x-nexus-tools": "web_search, read_url",
          },
        });
      }
    } catch (e) { /* try the next writer */ }
  }
  return json({ error: "No model could write the report." }, 502);
}
