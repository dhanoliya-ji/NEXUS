// ============================================================
//  reminders.js — save reminders and send them to your phone
// ============================================================
//  Saving:   NEXUS's "set_reminder" tool, or the ⏰ window in the website
//  Sending:  a free GitHub job calls /api/reminders/run every 10 minutes;
//            due reminders are pushed to your phone with ntfy.sh (free, no signup —
//            install the "ntfy" app and subscribe to your secret topic name).
//            If the website is open, the browser also shows a notification.

import { newId } from "./db.js";

const IST = 5.5 * 3600000;   // India is UTC + 5:30

// Current India time as text, e.g. "2026-10-17 18:45 (Saturday)"
export function nowIndia() {
  const d = new Date(Date.now() + IST);
  return d.toISOString().slice(0, 16).replace("T", " ") + " (" + d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }) + ")";
}

// Save a reminder. due = time in milliseconds (UTC)
export async function addReminder(db, due, text) {
  const id = newId();
  await db.prepare("INSERT INTO reminders (id, due, text, done, created) VALUES (?, ?, ?, 0, ?)")
    .bind(id, due, text.slice(0, 500), Date.now()).run();
  return id;
}

// The tool: input like "2026-10-18 09:00 | call Rohan" (India time)
export async function reminderTool(input, env) {
  const m = input.match(/(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})\s*\|\s*(.+)/);
  if (!m) return "Could not understand the reminder time. Format: YYYY-MM-DD HH:MM | what";
  const [, date, hour, minute, what] = m;
  const due = Date.parse(date + "T" + hour.padStart(2, "0") + ":" + minute + ":00Z") - IST;   // India time → UTC
  if (due < Date.now() - 60000) return "That time is in the past (now it is " + nowIndia() + " India time).";
  await addReminder(env.DB, due, what.trim());
  return "Reminder saved for " + date + " " + hour.padStart(2, "0") + ":" + minute + " India time: " + what.trim() +
    (env.NTFY_TOPIC ? " (a phone notification will be sent)" : " (shown in the ⏰ Reminders window; set up ntfy for phone alerts)");
}

// Send all reminders that are due and not sent yet
export async function sendDueReminders(env) {
  const db = env.DB;
  const due = (await db.prepare("SELECT id, text, due FROM reminders WHERE done = 0 AND due <= ?").bind(Date.now()).all()).results;
  for (const r of due) {
    if (env.NTFY_TOPIC) {
      await fetch("https://ntfy.sh/" + env.NTFY_TOPIC, {
        method: "POST",
        headers: { Title: "NEXUS reminder", Tags: "alarm_clock", Priority: "high" },
        body: r.text,
      });
    }
    await db.prepare("UPDATE reminders SET done = 1 WHERE id = ?").bind(r.id).run();
  }
  return due.length;
}
