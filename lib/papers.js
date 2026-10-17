// ============================================================
//  papers.js — research papers: search, full text, BibTeX
// ============================================================
//  • searchPapers(query)  → real papers with title, authors, year, abstract, arXiv link
//                           (Hugging Face Papers search — free, no key)
//  • readPaper(idOrLink)  → the paper's FULL TEXT (arXiv HTML version, or the PDF),
//                           read through Jina Reader; up to ~40,000 characters
//  • bibtex(papers)       → BibTeX entries built from the REAL metadata (never by an AI,
//                           so references can't be invented)

const HEADERS = { "User-Agent": "NEXUS/1.0 (personal AI assistant)" };

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(new URL(url).hostname + " said " + res.status);
  return res.json();
}

// "https://arxiv.org/abs/2106.09685v2" / "arxiv.org/pdf/2106.09685" / "2106.09685" → "2106.09685"
export function arxivId(text) {
  const m = String(text).match(/(\d{4}\.\d{4,5})(v\d+)?/);
  return m ? m[1] : null;
}

const simplify = (p) => ({
  id: p.id,
  title: String(p.title || "").replace(/\s+/g, " ").trim(),
  authors: (p.authors || []).map((a) => a.name || a).filter(Boolean),
  year: String(p.publishedAt || "").slice(0, 4),
  summary: String(p.summary || "").replace(/\s+/g, " ").trim(),
  upvotes: p.upvotes || 0,
  url: "https://arxiv.org/abs/" + p.id,
});

export async function searchPapers(query, limit) {
  const found = await getJson("https://huggingface.co/api/papers/search?q=" + encodeURIComponent(query));
  return found.slice(0, limit || 8).map((x) => simplify(x.paper || x)).filter((p) => p.id && p.title);
}

export async function paperInfo(id) {
  try { return simplify(await getJson("https://huggingface.co/api/papers/" + id)); } catch (e) { return null; }
}

export async function readPaper(input, env) {
  const id = arxivId(input);
  if (!id) throw new Error("Give an arXiv link or id, e.g. https://arxiv.org/abs/2106.09685");
  const jina = { ...HEADERS, "X-Return-Format": "text" };
  if (env && env.JINA_API_KEY) jina.Authorization = "Bearer " + env.JINA_API_KEY;

  const info = await paperInfo(id);
  let text = "";
  for (const url of ["https://arxiv.org/html/" + id, "https://arxiv.org/pdf/" + id]) {      // HTML first, then PDF
    try {
      const res = await fetch("https://r.jina.ai/" + url, { headers: jina, signal: AbortSignal.timeout(45000) });
      if (res.ok) text = await res.text();
      if (text.length > 3000) break;
    } catch (e) { /* try the PDF */ }
  }
  if (!text && !info) throw new Error("Could not read arXiv paper " + id);

  const head = info ? "TITLE: " + info.title + "\nAUTHORS: " + info.authors.slice(0, 12).join(", ") + "\nYEAR: " + info.year +
    "\nLINK: " + info.url + "\nABSTRACT: " + info.summary + "\n\n" : "LINK: https://arxiv.org/abs/" + id + "\n\n";
  return head + "FULL TEXT (may be cut):\n" + (text || "(full text not available — use the abstract)").slice(0, 40000);
}

// BibTeX from real metadata: @article{vaswani2017attention, ...}
export function bibtex(papers) {
  return papers.map((p) => {
    const first = (p.authors[0] || "anon").split(" ").pop().toLowerCase().replace(/[^a-z]/g, "");
    const word = (p.title.toLowerCase().match(/[a-z]{4,}/) || ["paper"])[0];
    const key = first + p.year + word;
    return "@article{" + key + ",\n  title   = {" + p.title + "},\n  author  = {" + p.authors.join(" and ") + "},\n" +
      "  journal = {arXiv preprint arXiv:" + p.id + "},\n  year    = {" + p.year + "},\n  url     = {" + p.url + "}\n}";
  }).join("\n\n");
}
