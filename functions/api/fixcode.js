// ============================================================
//  POST /api/fixcode {code, error, context, kind} — 🔧 repair a ✔️ verification check
// ============================================================
//  Idea from the "Self-Debugging" paper (Chen et al., 2023): when generated code fails,
//  show the model the error and let it fix the code. Two cases:
//   kind = "crash"  → the check code itself errored (NameError, sympy misuse…) → make it run
//   kind = "assert" → an assert failed. Usually that means the CHECK was unfair (sympy couldn't
//                     simplify, sklearn had regularization on…). Fix the METHOD only — but if the
//                     math really is wrong, keep the failing check and say MATH_WRONG.

import { json } from "../../lib/db.js";
import { askHelper } from "../../lib/memory.js";

export async function onRequestPost(context) {
  const { code, error, context: rest, kind } = await context.request.json();
  const rules =
    "Rules: keep EVERY check (each assert + its print('✔ ...')); never weaken a tolerance by more than 10x and never delete a check; " +
    "make the code self-contained (define any function/class it needs, copying from the context code); only numpy, sympy, scipy, " +
    "scikit-learn. Robust methods: compare symbolic expressions by substituting random numbers (np.isclose) instead of sp.simplify; " +
    "use scalar symbols for element-wise formulas; with scikit-learn match settings exactly (e.g. penalty=None) and compare predictions " +
    "with a tolerance. If a from-scratch optimizer (gradient descent) is compared with a library optimum, make sure it CONVERGES first " +
    "(more iterations, a suitable learning rate, standardized features, or check that the gradient norm is ~0) before comparing. " +
    "For random/statistical checks (means of random masks or samples) fix the seed, use ≥ 200000 samples and replace a fixed atol " +
    "with 5 standard errors computed in the code: abs(y.mean() - expected) < 5 * y.std() / np.sqrt(y.size). That is the correct " +
    "statistical test, NOT weakening (the 10x limit does not apply to it). " +
    "Reply with ONLY the fixed code in one ```python block.";
  const task = kind === "assert"
    ? "An assert FAILED. Decide why. If the CHECK METHOD is unfair or buggy (not the math), fix the method. If the math being checked is " +
      "genuinely wrong, return the code unchanged but with a first line '# MATH_WRONG: <one-line reason>'. "
    : "The check code CRASHED. Fix the cause so it runs. ";
  const answer = await askHelper(context.env, [
    { role: "system", content: "You fix Python verification code for math/ML explanations. " + task + rules },
    {
      role: "user",
      content: "CHECK CODE:\n```python\n" + String(code).slice(0, 6000) + "\n```\n\nERROR:\n" + String(error).slice(0, 1500) +
        "\n\nOTHER CODE FROM THE SAME ANSWER (context):\n```python\n" + String(rest || "").slice(0, 8000) + "\n```",
    },
  ], 3000, ["groq", "cloudflare", "gemini"]);
  const fixed = (answer.match(/```(?:python)?\n([\s\S]*?)```/) || [])[1];
  if (!fixed) return json({ error: "Could not fix the check code." }, 502);
  return json({ code: fixed, mathWrong: /#\s*MATH_WRONG/.test(fixed) });
}
