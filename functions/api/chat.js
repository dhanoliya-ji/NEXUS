// ============================================================
//  POST /api/chat — the main brain: you send a message, NEXUS answers
// ============================================================
//  Steps (the browser sees each step live, see lib/live.js):
//   1. prepare: understand the message, memory, documents, tools, skill, lessons
//   2. pick the models to try (router + YOUR ratings)
//   3. answer:
//      • small talk  → the quickest model
//      • normal      → first model that works, streamed word by word
//      • hard (Auto) → two AIs answer; if they agree, done; if not, a third AI decides
//                      (papers: Mixture-of-Thought cascades, SelfCheckGPT)

import { json } from "../../lib/db.js";
import { planRoute, planVision } from "../../lib/router.js";
import { prepare } from "../../lib/prepare.js";
import { streamFirst } from "../../lib/run.js";
import { askModel } from "../../lib/providers.js";
import { askHelper } from "../../lib/memory.js";
import { providerScores } from "../../lib/ratings.js";
import { liveStream, infoOf } from "../../lib/live.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, model, tools, images, skill, skillPrompt, regenerate, avoid } = await context.request.json();
  // messages = [{role:"user", content:"..."}, {role:"assistant", ...}, ...]
  // images   = ["data:image/jpeg;base64,...", ...]  (only for the newest message)
  // regenerate/avoid = 🔄: answer the same message again, with a different AI

  const hasImages = images && images.length > 0;
  if (!planRoute(env, messages, model).length && !hasImages) return json({ error: "No API keys found. Add keys to .dev.vars (see SETUP.md)." }, 400);

  return liveStream(context, async (live) => {
    // 🔄 Regenerate: forget the old answer first
    if (regenerate) {
      await env.DB.prepare("DELETE FROM messages WHERE id = (SELECT MAX(id) FROM messages WHERE chat_id = ? AND role = 'assistant')").bind(chatId).run();
    }

    // 1. Save message + build instructions
    const prep = await prepare(env, chatId, messages, { tools, images, skill, skillPrompt, regenerate, onStatus: live.status });

    // 2. Which models, in which order
    const scores = await providerScores(env.DB).catch(() => ({}));
    const plan = hasImages ? planVision(env)
      : planRoute(env, messages, model, { scores: scores, avoid: avoid, fast: prep.complexity === 0 && (!model || model === "auto") });

    // 3a. Hard question in Auto mode → two AIs + agreement check
    // (not for paper explanations: the paper text is long, two models would be slow and use lots of quota)
    if (prep.complexity === 2 && !hasImages && !regenerate && (!model || model === "auto") && !prep.toolsUsed.includes("read_paper")) {
      const done = await cascade(env, live, plan, prep);
      if (done) return;
    }

    // 3b. Normal: first model that works answers, streamed
    live.status(hasImages ? "👀 Looking at your image…" : "✍️ Writing…");
    const { res, step, errors } = await streamFirst(env, plan, prep.fullMessages);
    if (!res) return live.send({ nexus_error: "All models failed", details: errors });
    await live.send(infoOf(step.provider.name + " · " + step.model, prep, step));
    await live.pipe(res.body);
  });
}

// Mixture-of-Thought cascade. Returns true if it answered, false to fall back to normal mode.
async function cascade(env, live, plan, prep) {
  // DIFFERENT providers, best-rated first (one per provider)
  const candidates = [];
  for (const step of plan) {
    if (!candidates.some((p) => p.provider.id === step.provider.id)) candidates.push(step);
  }
  if (candidates.length < 2) return false;

  // Ask two at a time; a provider that fails (limit reached, empty answer) is replaced by the next one
  live.status("🧪 Hard question: two AIs are solving it separately…");
  const ok = [];
  while (ok.length < 2 && candidates.length) {
    const batch = candidates.splice(0, 2 - ok.length);
    const results = await Promise.allSettled(batch.map((s) => askModel(env, s.provider, s.model, prep.fullMessages, 8000)));
    results.forEach((r, i) => { if (r.status === "fulfilled" && r.value.trim()) ok.push({ step: batch[i], text: r.value }); });
  }
  if (ok.length === 0) return false;
  const picks = ok.map((o) => o.step);

  const sendText = async (name, step, text) => {
    await live.send(infoOf(name, prep, step));
    await live.send({ choices: [{ delta: { content: text } }] });   // whole answer at once
  };
  if (ok.length === 1) {
    await sendText(ok[0].step.provider.name + " · " + ok[0].step.model, ok[0].step, ok[0].text);
    return true;
  }

  // Do the two answers agree?
  live.status("🔍 Comparing the two answers…");
  const verdict = await askHelper(env, [
    { role: "system", content: "Compare two answers to the same question. Reply with one word: AGREE if their main facts and final results match (wording may differ), DISAGREE otherwise." },
    { role: "user", content: "QUESTION: " + prep.query + "\n\nANSWER A:\n" + ok[0].text.slice(0, 5000) + "\n\nANSWER B:\n" + ok[1].text.slice(0, 5000) },
  ], 300, ["groq", "cloudflare", "gemini"]);

  if (/AGREE/i.test(verdict) && !/DISAGREE/i.test(verdict)) {
    await sendText(ok[0].step.provider.name + " · " + ok[0].step.model + " ✓ " + ok[1].step.provider.name + " agreed", ok[0].step, ok[0].text);
    return true;
  }

  // They disagree → a third model works out which is right
  live.status("⚖️ They disagree — a third AI is checking which one is right…");
  const judges = plan.filter((s) => !picks.some((p) => p.provider.id === s.provider.id)).concat(picks);
  const judgeMessages = prep.fullMessages.concat([{
    role: "user",
    content: "Two AI answers to my last message DISAGREE:\n\n### Answer A\n" + ok[0].text.slice(0, 6000) +
      "\n\n### Answer B\n" + ok[1].text.slice(0, 6000) +
      "\n\nWork out carefully, step by step, which parts are correct. Then write ONE final correct answer " +
      "(don't describe the comparison, don't mention answer A or B).",
  }]);
  const { res, step } = await streamFirst(env, judges, judgeMessages);
  if (!res) {
    await sendText(ok[0].step.provider.name + " · " + ok[0].step.model, ok[0].step, ok[0].text);
    return true;
  }
  await live.send(infoOf(picks[0].provider.name + " vs " + picks[1].provider.name + " disagreed → " + step.provider.name + " decided", prep, step));
  await live.pipe(res.body);
  return true;
}
