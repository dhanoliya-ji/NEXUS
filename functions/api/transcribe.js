// ============================================================
//  POST /api/transcribe — turn your voice recording into text
// ============================================================
//  The browser records your voice and sends the audio file here.
//  We pass it to a free Whisper speech-to-text model:
//    1st: Groq (whisper-large-v3-turbo, very fast, understands Hindi + English)
//    2nd: Cloudflare Workers AI (whisper)

import { json } from "../../lib/db.js";

export async function onRequestPost(context) {
  const env = context.env;
  const form = await context.request.formData();
  const audio = form.get("audio");
  if (!audio) return json({ error: "No audio received" }, 400);

  // 1st choice: Groq
  if (env.GROQ_API_KEY) {
    const groqForm = new FormData();
    groqForm.append("file", audio, "voice.webm");
    groqForm.append("model", "whisper-large-v3-turbo");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.GROQ_API_KEY },
      body: groqForm,
    });
    if (res.ok) return json({ text: (await res.json()).text.trim(), by: "Groq Whisper" });
  }

  // 2nd choice: Cloudflare Workers AI
  if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
    const res = await fetch(
      "https://api.cloudflare.com/client/v4/accounts/" + env.CF_ACCOUNT_ID + "/ai/run/@cf/openai/whisper",
      { method: "POST", headers: { Authorization: "Bearer " + env.CF_API_TOKEN }, body: await audio.arrayBuffer() }
    );
    if (res.ok) return json({ text: (await res.json()).result.text.trim(), by: "Cloudflare Whisper" });
  }

  return json({ error: "Speech-to-text failed. Is GROQ_API_KEY set?" }, 502);
}
