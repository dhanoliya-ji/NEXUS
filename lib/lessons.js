// ============================================================
//  lessons.js — NEXUS learns HOW you like answers
// ============================================================
//  Idea from the ACE paper ("Agentic Context Engineering", 2025/26):
//  keep a small "playbook" of lessons, and update it bit by bit instead of
//  rewriting it (rewriting slowly erases details — "context collapse").
//   • Reflector: when you press 👎 (and say what was wrong), a fast model turns
//                that into a short lesson, e.g. "Give the code first, explain after".
//   • Curator:   the same call merges it with existing lessons (ADD / UPDATE / DELETE),
//                so the playbook stays short and has no duplicates.
//  The lessons go into NEXUS's instructions for every answer.

import { askHelper } from "./memory.js";

export async function getLessons(db) {
  return (await db.prepare("SELECT id, text FROM lessons ORDER BY id").all()).results;
}

export async function lessonsForPrompt(db) {
  return (await getLessons(db)).map((l) => "- " + l.text).join("\n");
}

export async function learnLesson(env, note, question, answer) {
  const db = env.DB;
  const lessons = await getLessons(db);
  const reply = await askHelper(env, [
    {
      role: "system",
      content:
        "You keep a short playbook of lessons about how this user likes answers (style, length, format, tone, " +
        "what to avoid). The user disliked an answer. Turn the feedback into at most 2 short, general, actionable lessons, " +
        "merged with the existing playbook (max 25 lessons):\n" +
        '{"ops":[{"op":"ADD","text":"..."},{"op":"UPDATE","id":2,"text":"..."},{"op":"DELETE","id":4}]}\n' +
        "Don't add lessons about one specific topic. Reply with ONLY JSON.",
    },
    {
      role: "user",
      content: "PLAYBOOK:\n" + (lessons.map((l) => l.id + ". " + l.text).join("\n") || "(empty)") +
        "\n\nQUESTION: " + question.slice(0, 1500) + "\nDISLIKED ANSWER: " + answer.slice(0, 2000) +
        "\nUSER FEEDBACK: " + (note || "(no reason given — infer what was probably wrong, or add nothing)"),
    },
  ], 500, ["groq", "cloudflare", "gemini"]);

  try {
    const known = new Set(lessons.map((l) => l.id));
    for (const op of JSON.parse(reply.match(/\{[\s\S]*\}/)[0]).ops || []) {
      if (op.op === "ADD" && op.text) await db.prepare("INSERT INTO lessons (text, created) VALUES (?, ?)").bind(String(op.text).slice(0, 200), Date.now()).run();
      if (op.op === "UPDATE" && known.has(op.id) && op.text) await db.prepare("UPDATE lessons SET text = ? WHERE id = ?").bind(String(op.text).slice(0, 200), op.id).run();
      if (op.op === "DELETE" && known.has(op.id)) await db.prepare("DELETE FROM lessons WHERE id = ?").bind(op.id).run();
    }
  } catch (e) { /* no clean JSON — skip */ }
}
