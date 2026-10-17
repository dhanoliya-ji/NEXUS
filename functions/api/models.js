// GET /api/models — every model you can pick (only providers that have keys)

import { json } from "../../lib/db.js";
import { availableModels } from "../../lib/router.js";

export async function onRequestGet(context) {
  return json(availableModels(context.env));
}
