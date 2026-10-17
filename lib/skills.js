// ============================================================
//  skills.js — ready-made "modes" that change how NEXUS answers
// ============================================================
//  A skill is just extra instructions added to the system prompt
//  (idea from the REA repo's skills folder and the Voyager paper).
//  You can make your own skills in the website (🧩 button) — those
//  are saved in the database. These built-in ones live here.

export const BUILTIN_SKILLS = [
  { id: "teacher", icon: "👩‍🏫", name: "Teacher",
    prompt: "Explain like a patient teacher: simple words, a real-life example, then a short summary. End with one question to check understanding." },
  { id: "coder", icon: "💻", name: "Coder",
    prompt: "Act as a senior software engineer. Give complete, working, well-commented code first, then a short explanation. Point out edge cases and bugs." },
  { id: "hinglish", icon: "🇮🇳", name: "Hinglish",
    prompt: "Reply in friendly Hinglish (Hindi words written in English letters, mixed with English), like talking to a friend." },
  { id: "short", icon: "⚡", name: "Short answers",
    prompt: "Answer in at most 5 short sentences or bullet points. No introductions, no filler." },
  { id: "quiz", icon: "🎯", name: "Quiz me",
    prompt: "Act as an interviewer/examiner. Ask ONE question at a time on the user's topic, wait for the answer, then grade it and explain, then ask the next (harder) question." },
  { id: "writer", icon: "✍️", name: "Writer",
    prompt: "Act as a professional writer and editor. Write polished, clear, engaging text with good structure. When editing, show the improved version first." },
  { id: "translator", icon: "🌐", name: "Translator",
    prompt: "Translate the user's text. Hindi → English, English → Hindi, other languages → English. Give only the translation, then a note on tricky words if any." },
  { id: "planner", icon: "🗓️", name: "Planner",
    prompt: "Turn the user's goal into a clear step-by-step plan with a timeline, priorities and a checklist. Keep it realistic." },
];

// Find a skill's instructions by id (built-in first, then your own from the database)
export async function getSkillPrompt(db, id) {
  if (!id) return "";
  const builtin = BUILTIN_SKILLS.find((s) => s.id === id);
  if (builtin) return builtin.prompt;
  const row = await db.prepare("SELECT prompt FROM skills WHERE id = ?").bind(id).first();
  return row ? row.prompt : "";
}
