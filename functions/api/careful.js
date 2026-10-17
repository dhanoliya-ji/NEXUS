// ============================================================
//  POST /api/careful — "Think harder": answer, check, then fix
// ============================================================
//  Ideas from the Chain-of-Verification and Reflexion papers:
//   1. DRAFT  — one model writes a first answer
//   2. CHECK  — a DIFFERENT model checks it step by step (facts, logic,
//               math, code) and writes the corrected final answer
//  Slower (2 models), but fewer mistakes. Great for math, code, facts.

import { json } from "../../lib/db.js";
import { planRoute } from "../../lib/router.js";
import { prepare } from "../../lib/prepare.js";
import { askFirst, streamFirst } from "../../lib/run.js";
import { liveStream, infoOf } from "../../lib/live.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, tools, skill } = await context.request.json();

  const plan = planRoute(env, messages, "auto");
  if (plan.length === 0) return json({ error: "No API keys found." }, 400);

  return liveStream(context, async (live) => {
    const prep = await prepare(env, chatId, messages, { tools: tools, skill: skill, onStatus: live.status });

    // 1. DRAFT
    live.status("📝 Writing a first draft…");
    const draft = await askFirst(env, plan, prep.fullMessages, 3000);
    if (!draft.text) return live.send({ nexus_error: "No model could write a draft." });

    // 2. CHECK with a different provider (the drafter goes last in the list)
    const checkers = plan.filter((s) => s.provider.id !== draft.step.provider.id)
      .concat(plan.filter((s) => s.provider.id === draft.step.provider.id));
    live.status("🔍 Double-checking the draft (" + draft.step.provider.name + " wrote it)…");
    const checkMessages = prep.fullMessages.concat([{
      role: "user",
      content: "Here is a DRAFT answer to my last message:\n\n" + draft.text + "\n\n" +
        "Check it carefully, step by step: facts, logic, calculations, code correctness, and whether it fully answers me. " +
        "Then write the FINAL corrected answer only (do not describe your checking, do not mention a draft). " +
        "If the draft was already correct, give it again, improved where possible.",
    }]);

    const { res, step } = await streamFirst(env, checkers, checkMessages);
    if (!res) return live.send({ nexus_error: "No model could check the draft." });
    await live.send(infoOf("Careful: " + draft.step.provider.name + " drafted → " + step.provider.name + " checked", prep, step));
    await live.pipe(res.body);
  });
}
