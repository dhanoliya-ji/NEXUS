// /api/reminders/:id
//   DELETE → remove a reminder
//   POST /api/reminders/run → send all due reminders (called every 10 minutes by GitHub)

import { json } from "../../../lib/db.js";
import { sendDueReminders } from "../../../lib/reminders.js";

export async function onRequestDelete(context) {
  await context.env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(context.params.id).run();
  return json({ ok: true });
}

export async function onRequestPost(context) {
  if (context.params.id !== "run") return json({ error: "unknown" }, 404);
  return json({ sent: await sendDueReminders(context.env) });
}
