// /api/cards/:id
//   PUT {fsrs, due} → save the card's new FSRS state after you reviewed it
//   DELETE          → remove the card

import { json } from "../../../lib/db.js";

export async function onRequestPut(context) {
  const { fsrs, due } = await context.request.json();
  await context.env.DB.prepare("UPDATE cards SET fsrs = ?, due = ? WHERE id = ?").bind(JSON.stringify(fsrs || {}), Number(due) || Date.now(), context.params.id).run();
  return json({ ok: true });
}

export async function onRequestDelete(context) {
  await context.env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(context.params.id).run();
  return json({ ok: true });
}
