// ============================================================
//  semantic.js — search by MEANING, not just by matching words
// ============================================================
//  Keyword search (BM25, in memory.js) finds "budget" only if you wrote "budget".
//  Meaning search finds it even if you wrote "how much money for the trip".
//
//  How (all free on Cloudflare, models from Hugging Face):
//   1. EMBED   — Qwen3-Embedding-0.6B turns text into 1024 numbers ("a vector");
//                texts with similar meaning get similar numbers. (Multilingual, and
//                cheaper on Cloudflare than the older bge models.)
//   2. STORE   — vectors live in Cloudflare Vectorize (a vector database).
//   3. SEARCH  — your new message is embedded and the closest vectors are found.
//   4. MERGE   — keyword results + meaning results are combined with
//                "Reciprocal Rank Fusion" (Cormack et al., 2009).
//   5. RERANK  — BAAI/bge-reranker-base reads the question + each candidate and
//                orders them by real relevance; clearly unrelated ones are dropped
//                (idea from the "Corrective RAG" paper — bad context makes worse answers).
//  If Vectorize / Workers AI is not available (e.g. on your laptop), NEXUS
//  simply uses keyword search like before.

const EMBED_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
const RERANK_MODEL = "@cf/baai/bge-reranker-base";
const MIN_SIMILARITY = 0.42;   // tested: related notes score 0.5–0.7, small talk like "hi" < 0.35
// Qwen3 works better when a QUESTION carries a short task description (not needed for stored notes)
const QUERY_PREFIX = "Instruct: Given a user message, retrieve earlier notes that help answer it\nQuery: ";

export function hasSemantic(env) {
  return Boolean(env.AI && env.VECTORS);
}

// Text → vectors (many texts at once)
async function embed(env, texts) {
  const result = await env.AI.run(EMBED_MODEL, { text: texts });
  return result.data;
}

// Today's date in India, like "2026-10-17" (stored with memories for "last week" questions)
const todayIndia = () => new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

// Save vectors + remember their ids (so we can delete them with the chat/document)
async function store(env, owner, rows) {
  for (let i = 0; i < rows.length; i += 100) await env.VECTORS.upsert(rows.slice(i, i + 100));
  for (let i = 0; i < rows.length; i += 50) {
    await env.DB.batch(rows.slice(i, i + 50).map((r) => env.DB.prepare("INSERT OR IGNORE INTO vectors (id, owner) VALUES (?, ?)").bind(r.id, owner)));
  }
}

// Remember ONE exchange (your message + NEXUS's reply) as one memory.
// Idea from the LongMemEval paper: store memories per exchange, and add the
// exchange's key facts to the searchable text ("keys") so it's found easily later.
export async function rememberExchange(env, chatId, userText, replyText, keys) {
  if (!hasSemantic(env)) return;
  if ((userText + replyText).trim().length < 60) return;   // "hi" / "thanks" are not worth remembering
  const day = todayIndia();
  const note = "User: " + userText.slice(0, 1200) + "\nNEXUS: " + replyText.slice(0, 1200);
  const searchable = (keys && keys.length ? "Key facts: " + keys.join("; ") + "\n" : "") + note;
  const [vector] = await embed(env, [searchable.slice(0, 3000)]);
  await store(env, chatId, [{
    id: "m-" + chatId + "-" + Date.now().toString(36),
    values: vector,
    namespace: "msg",
    metadata: { chat_id: chatId, day: day, text: (keys && keys.length ? "[" + keys.join("; ") + "] " : "") + note.slice(0, 1800) },
  }]);
}

// Remember document parts. Each part starts with the document's name
// ("Contextual Retrieval" idea: a part alone may not say what it's about)
export async function rememberDoc(env, docId, name, parts) {
  if (!hasSemantic(env)) return;
  for (let i = 0; i < parts.length; i += 50) {
    const batch = parts.slice(i, i + 50);
    const vectors = await embed(env, batch.map((p) => "Document: " + name + "\n" + p));
    await store(env, "doc:" + docId, vectors.map((values, j) => ({
      id: "d-" + docId + "-" + (i + j),
      values: values,
      namespace: "doc",
      metadata: { doc_id: docId, name: name, text: batch[j].slice(0, 1500) },
    })));
  }
}

// Delete all vectors of a chat (owner = chatId) or a document (owner = "doc:" + id)
export async function forget(env, owner) {
  if (!hasSemantic(env)) return;
  const ids = (await env.DB.prepare("SELECT id FROM vectors WHERE owner = ?").bind(owner).all()).results.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 100) await env.VECTORS.deleteByIds(ids.slice(i, i + 100));
  await env.DB.prepare("DELETE FROM vectors WHERE owner = ?").bind(owner).run();
}

// Find the closest vectors to a text → [{text, role?, name?, chat_id?, similarity}]
export async function meaningSearch(env, text, namespace, topK) {
  const [vector] = await embed(env, [QUERY_PREFIX + text.slice(0, 2000)]);
  const found = await env.VECTORS.query(vector, { topK: topK, namespace: namespace, returnMetadata: "all" });
  return found.matches.filter((m) => m.score >= MIN_SIMILARITY).map((m) => ({ ...m.metadata, similarity: m.score }));
}

// Reciprocal Rank Fusion: an item ranked high in ANY list ends up high.
// score = sum of 1 / (60 + rank) over all lists
export function fuse(lists) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = item.text.slice(0, 200);
      const entry = scores.get(key) || { item: item, score: 0 };
      entry.score += 1 / (60 + rank);
      scores.set(key, entry);
    });
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).map((e) => e.item);
}

// The reranker reads question + candidate together (much smarter than vectors alone)
export async function rerank(env, question, items, keep) {
  if (!hasSemantic(env) || items.length <= 1) return items.slice(0, keep);
  try {
    const result = await env.AI.run(RERANK_MODEL, {
      query: question.slice(0, 1000),
      contexts: items.map((i) => ({ text: i.text.slice(0, 1500) })),
    });
    const ranked = result.response.map((r) => ({ ...items[r.id], relevance: r.score })).sort((a, b) => b.relevance - a.relevance);
    const best = ranked[0].relevance;
    return ranked.filter((r) => r.relevance >= best * 0.05).slice(0, keep);   // drop the clearly unrelated
  } catch (e) {
    return items.slice(0, keep);
  }
}
