// ============================================================
//  db.js — the database (Cloudflare D1, free 5 GB)
// ============================================================
//
//  D1 is a SQLite database. We have 3 tables:
//    chats     → one row per conversation (id, title, dates)
//    messages  → every message you and NEXUS wrote
//    profile   → one row: "About me" facts NEXUS learned about you
//  Plus messages_fts → a search index so NEXUS can find old messages fast.

const SETUP = [
  `CREATE TABLE IF NOT EXISTS chats (
     id TEXT PRIMARY KEY, title TEXT, created INTEGER, updated INTEGER)`,

  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     chat_id TEXT, role TEXT, content TEXT, model TEXT, created INTEGER)`,

  `CREATE TABLE IF NOT EXISTS profile (
     id INTEGER PRIMARY KEY, text TEXT, updated INTEGER)`,

  // Full-text search index (ranks results with BM25, like gpt-researcher)
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(content, chat_id UNINDEXED, role UNINDEXED)`,

  // Keep the search index in sync automatically
  `CREATE TRIGGER IF NOT EXISTS messages_add AFTER INSERT ON messages BEGIN
     INSERT INTO messages_fts(rowid, content, chat_id, role) VALUES (new.id, new.content, new.chat_id, new.role);
   END`,
  `CREATE TRIGGER IF NOT EXISTS messages_del AFTER DELETE ON messages BEGIN
     DELETE FROM messages_fts WHERE rowid = old.id;
   END`,

  // 📚 Documents library: each document is cut into small parts ("chunks") so search finds the right part
  `CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, name TEXT, chars INTEGER, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS doc_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, part INTEGER, text TEXT)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(text, doc_id UNINDEXED)`,
  `CREATE TRIGGER IF NOT EXISTS chunks_add AFTER INSERT ON doc_chunks BEGIN
     INSERT INTO doc_chunks_fts(rowid, text, doc_id) VALUES (new.id, new.text, new.doc_id);
   END`,
  `CREATE TRIGGER IF NOT EXISTS chunks_del AFTER DELETE ON doc_chunks BEGIN
     DELETE FROM doc_chunks_fts WHERE rowid = old.id;
   END`,

  // 🧩 Your own skills (the built-in ones live in lib/skills.js)
  `CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, icon TEXT, name TEXT, prompt TEXT, created INTEGER)`,

  // 📝 Summary of the older part of long chats (upto = how many messages it covers)
  `CREATE TABLE IF NOT EXISTS chat_summaries (chat_id TEXT PRIMARY KEY, summary TEXT, upto INTEGER, updated INTEGER)`,

  // 🔐 Logged-in devices (each gets a random token) + wrong password counter per internet address
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, device TEXT, created INTEGER, last_used INTEGER)`,
  `CREATE TABLE IF NOT EXISTS login_fails (ip TEXT PRIMARY KEY, count INTEGER, first INTEGER)`,

  // 📊 How many answers each model gave per day
  `CREATE TABLE IF NOT EXISTS usage (day TEXT, provider TEXT, model TEXT, count INTEGER, PRIMARY KEY (day, provider, model))`,

  // ⏰ Reminders (due = time in milliseconds, UTC)
  `CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, due INTEGER, text TEXT, done INTEGER DEFAULT 0, created INTEGER)`,
];

// Create the tables the first time (safe to run many times)
let ready = false;
export async function setupDatabase(db) {
  if (ready) return;
  await db.batch(SETUP.map((sql) => db.prepare(sql)));
  ready = true;
}

// Make a short random id for a new chat, e.g. "k3x9q2ab"
export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

// Save one message and mark the chat as recently used
export async function saveMessage(db, chatId, role, content, model) {
  const now = Date.now();
  // D1 allows max 2 MB per row; very big attached files are cut when saving
  if (content.length > 600000) content = content.slice(0, 600000) + "\n…(cut when saving: too long)";
  await db.batch([
    db.prepare("INSERT INTO messages (chat_id, role, content, model, created) VALUES (?, ?, ?, ?, ?)")
      .bind(chatId, role, content, model || "", now),
    db.prepare("UPDATE chats SET updated = ? WHERE id = ?").bind(now, chatId),
  ]);
}

// Small helper: send back JSON
export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
