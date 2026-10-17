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
import { prepare, infoHeaders } from "../../lib/prepare.js";
import { askFirst, streamFirst } from "../../lib/run.js";

export async function onRequestPost(context) {
  const env = context.env;
  const { chatId, messages, tools, skill } = await context.request.json();

  const plan = planRoute(env, messages, "auto");
  if (plan.length === 0) return json({ error: "No API keys found." }, 400);
  const prep = await prepare(env, chatId, messages, { tools: tools, skill: skill });

  // 1. DRAFT
  const draft = await askFirst(env, plan, prep.fullMessages, 3000);
  if (!draft.text) return json({ error: "No model could write a draft." }, 502);

  // 2. CHECK with a different provider (put the drafter last in the list)
  const checkers = plan.filter((s) => s.provider.id !== draft.step.provider.id).concat(
    plan.filter((s) => s.provider.id === draft.step.provider.id)
  );
  const checkMessages = prep.fullMessages.concat([
    {
      role: "user",
      content:
        "Here is a DRAFT answer to my last message:\n\n" + draft.text + "\n\n" +
        "Check it carefully, step by step: facts, logic, calculations, code correctness, and whether it fully answers me. " +
        "Then write the FINAL corrected answer only (do not describe your checking, do not mention a draft). " +
        "If the draft was already correct, give it again, improved where possible.",
    },
  ]);

  const { res, step } = await streamFirst(env, checkers, checkMessages);
  if (!res) return json({ error: "No model could check the draft." }, 502);
  const name = "Careful: " + draft.step.provider.name + " drafted → " + step.provider.name + " checked";
  return new Response(res.body, { headers: infoHeaders(name, prep) });
}
