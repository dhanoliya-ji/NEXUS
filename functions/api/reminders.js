// /api/reminders
//   GET  → upcoming reminders + the last 10 sent ones (+ your ntfy topic for phone alerts)
//   POST {due, text} → add a reminder (due = milliseconds; the browser knows your time zone)

import { json } from "../../lib/db.js";
import { addReminder } from "../../lib/reminders.js";

export async function onRequestGet(context) {
  const db = context.env.DB;
  const upcoming = (await db.prepare("SELECT id, due, text FROM reminders WHERE done = 0 ORDER BY due").all()).results;
  const sent = (await db.prepare("SELECT id, due, text FROM reminders WHERE done = 1 ORDER BY due DESC LIMIT 10").all()).results;
  return json({ upcoming: upcoming, sent: sent, ntfyTopic: context.env.NTFY_TOPIC || "" });
}

export async function onRequestPost(context) {
  const { due, text } = await context.request.json();
  if (!due || !text) return json({ error: "Need a time and a text." }, 400);
  return json({ id: await addReminder(context.env.DB, due, text) });
}
