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

// The code inside the first ``` block (also ```py, or a reply that was cut off before its closing ```).
// (8000 tokens below: the fixing models think before answering, and thinking uses up tokens too)
function extractCode(answer) {
  const m = String(answer || "").match(/```[\w-]*[ \t]*\r?\n([\s\S]*?)(?:```|$)/);
  return m && m[1].trim() ? m[1] : "";
}

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
    "NaN or inf in the results means a numerical bug in the CODE (missing epsilon, overflow, exploding learning rate, wrong backprop " +
    "formula) — fix that bug, it is not a math error. " +
    "Never make a claim pass by also allowing its opposite or a tie (e.g. 'lower' → 'lower or equal', '>' → '>='): if an experiment " +
    "doesn't show the claimed effect, that is MATH_WRONG (say: the experiment does not show the effect). " +
    "Reply with ONLY the fixed code in one ```python block.";
  // kind = "run" → ordinary example code from an answer that crashed on ▶ Run: make it work, change as little as possible
  if (kind === "run") {
    const answer = await askHelper(context.env, [
      { role: "system", content: "You fix Python example code from an AI/ML explanation that CRASHED in the browser (Pyodide). " +
        "Available: numpy, pandas, scipy, scikit-learn, matplotlib, sympy — no torch/tensorflow, no internet, no files unless created " +
        "in the code. Fix the cause with the smallest change, keep the code's purpose, its prints and its plots. Define anything " +
        "missing (you may copy from the context code). Reply with ONLY the fixed code in one ```python block." },
      { role: "user", content: "CODE:\n```python\n" + String(code).slice(0, 8000) + "\n```\n\nERROR:\n" + String(error).slice(0, 1500) +
        "\n\nOTHER CODE FROM THE SAME ANSWER (context):\n```python\n" + String(rest || "").slice(0, 6000) + "\n```" },
    ], 8000, ["groq", "cloudflare", "gemini"]);
    const fixed = extractCode(answer);
    return fixed ? json({ code: fixed, mathWrong: false }) : json({ error: "Could not fix the code." }, 502);
  }
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
  ], 8000, ["groq", "cloudflare", "gemini"]);
  const fixed = extractCode(answer);
  if (!fixed) return json({ error: "Could not fix the check code." }, 502);
  return json({ code: fixed, mathWrong: /#\s*MATH_WRONG/.test(fixed) });
}
