// GET /api/tool?name=weather&input=Delhi — run ONE tool by hand (handy for testing)
// GET /api/tool                            — list all tools

import { json } from "../../lib/db.js";
import { TOOLS } from "../../lib/tools.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const name = url.searchParams.get("name");
  if (!name) return json(Object.fromEntries(Object.entries(TOOLS).map(([n, t]) => [n, t.about])));
  if (!TOOLS[name]) return json({ error: "No tool called " + name }, 404);

  try {
    const result = await TOOLS[name].run(url.searchParams.get("input") || "", context.env);
    return json({ tool: name, result: result });
  } catch (e) {
    return json({ tool: name, error: e.message }, 502);
  }
}
