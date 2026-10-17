// POST /api/image {prompt} — make a picture with FLUX.1-schnell (Black Forest Labs, via Hugging Face → Cloudflare)
// Free on Cloudflare Workers AI (about 150 pictures a day within the free units).
// Returns {image: "<base64 JPEG>"}; the browser shrinks it before saving.

import { json } from "../../lib/db.js";

export async function onRequestPost(context) {
  const env = context.env;
  if (!env.AI) return json({ error: "Cloudflare AI is not available here." }, 400);
  const { prompt } = await context.request.json();
  if (!prompt) return json({ error: "Describe the picture first." }, 400);
  try {
    const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: String(prompt).slice(0, 2000), steps: 6 });
    return json({ image: result.image });
  } catch (e) {
    return json({ error: "FLUX failed: " + e.message }, 502);
  }
}
