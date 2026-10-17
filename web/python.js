// ============================================================
//  python.js — ▶ Python in your browser, ✔️ math verification, 📏 shapes,
//              🔗 equation ↔ code, 🐢 step-through
// ============================================================
//  Python runs IN YOUR BROWSER with Pyodide (CPython compiled to WebAssembly).
//  The first run downloads it (~10 MB, about 10 seconds), then it's fast.
//  Packages (numpy, pandas, scikit-learn, sympy, scipy, matplotlib…) load automatically when imported.
//  One shared runner (executePython) is used by ▶ Run, ✔️ verification blocks and 📏 shape tracing.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyodide = null;

// Run Python code → { printed, images, error }   (onStatus shows progress messages)
async function executePython(code, onStatus, importsFrom) {
  const status = onStatus || (() => {});
  if (!pyodide) {
    status("⏳ Starting Python (first time only, ~10 seconds)…");
    await loadScript(PYODIDE + "pyodide.js");
    pyodide = await loadPyodide({ indexURL: PYODIDE });
  }
  status("⏳ Running…");
  await pyodide.loadPackagesFromImports(importsFrom || code);   // e.g. "import sympy" → downloads sympy

  // Attached CSV/TSV/JSON files (app.js keeps them in dataFiles) → Python's virtual disk
  if (typeof dataFiles !== "undefined") {
    for (const [name, text] of Object.entries(dataFiles)) pyodide.FS.writeFile(name, text);
  }

  let printed = "";
  pyodide.setStdout({ batched: (s) => (printed += s + "\n") });
  pyodide.setStderr({ batched: (s) => (printed += s + "\n") });
  const usesPlot = /matplotlib|plt\./.test(code);
  if (usesPlot) await pyodide.runPythonAsync("import matplotlib\nmatplotlib.use('AGG')");
  await pyodide.runPythonAsync("import warnings\nwarnings.filterwarnings('ignore')");   // hide library warnings

  let error = null, images = [];
  try {
    const result = await pyodide.runPythonAsync(code);
    if (result !== undefined && result !== null && !printed.trim()) printed += String(result);
  } catch (e) {
    error = e.message.split("\n").filter(Boolean).slice(-3).join("\n");   // the last lines of a Python error are the useful part
  }
  if (usesPlot) {
    images = pyodide.runPython(
      "import io, base64\nimport matplotlib.pyplot as plt\n_imgs = []\n" +
      "for n in plt.get_fignums():\n    b = io.BytesIO()\n    plt.figure(n).savefig(b, format='png', dpi=110, bbox_inches='tight')\n" +
      "    _imgs.append(base64.b64encode(b.getvalue()).decode())\nplt.close('all')\n_imgs"
    ).toJs();
  }
  return { printed: printed.trim(), images: images, error: error };
}

// A box under a code block for results (re-used if it exists)
function outputBox(pre) {
  let out = pre.nextElementSibling;
  if (!out || !out.classList.contains("run-output")) {
    out = document.createElement("div");
    out.className = "run-output";
    pre.after(out);
  }
  return out;
}

// ---------- ▶ Run and 📏 Shapes buttons on every Python block ----------
function addRunButton(codeBlock) {
  const pre = codeBlock.parentElement;
  const run = document.createElement("button");
  run.className = "run-code";
  run.textContent = "▶ Run";
  run.onclick = () => runPython(codeBlock.innerText, pre, run);
  const shapes = document.createElement("button");
  shapes.className = "run-code shapes-btn";
  shapes.textContent = "📏 Shapes";
  shapes.title = "Run the code and show the shape of every array after each line";
  shapes.onclick = () => traceShapes(codeBlock.innerText, pre, shapes);
  pre.appendChild(run);
  pre.appendChild(shapes);
}

async function runPython(code, pre, btn) {
  const out = outputBox(pre);
  btn.disabled = true;
  out.innerHTML = "<pre></pre>";
  const show = (text) => (out.querySelector("pre").textContent = text);
  try {
    const r = await executePython(code, show);
    show(r.error ? (r.printed ? r.printed + "\n\n" : "") + "❌ " + r.error : r.printed || "✅ Done (no output)");
    for (const data of r.images) {
      const img = document.createElement("img");
      img.src = "data:image/png;base64," + data;
      out.appendChild(img);
    }
  } catch (e) {
    show("❌ " + e.message);
  }
  btn.disabled = false;
}

// ---------- ✔️ Verification blocks ----------
// Derive / Prove / Equation↔Code / Worked-example answers end with a ```verify block:
// Python (SymPy for algebra & calculus, NumPy for numbers) that CHECKS the math, prints "✔ ..."
// for each passed check, and uses assert so a wrong step raises an error.
// New answers verify automatically; older answers get a "▶ Verify" button.

function renderVerify(codeBlock, autoRun, context) {
  const code = codeBlock.textContent;
  const box = document.createElement("div");
  box.className = "verify-box";
  box.innerHTML = '<div class="verify-head"><span class="verify-status">✔️ Verification (checked by Python: SymPy / NumPy)</span>' +
    '<button class="verify-run">▶ Verify</button></div>' +
    '<details><summary>Show the check code</summary><pre><code class="language-python"></code></pre></details><pre class="verify-out" hidden></pre>';
  box.querySelector("code").textContent = code;
  if (typeof hljs !== "undefined") hljs.highlightElement(box.querySelector("code"));
  box.querySelector(".verify-run").onclick = () => runVerify(box, box.querySelector("code").textContent, context, false);
  codeBlock.parentElement.replaceWith(box);
  if (autoRun) runVerify(box, code, context, false);
}

// Runs the check. Outcomes:
//   ✔ all checks passed               → the math is confirmed
//   check crashed / an assert failed  → NEXUS reviews the CHECK once (Self-Debugging, /api/fixcode):
//        • crash          → the code is repaired and re-run
//        • failed assert  → if the check method was unfair it's corrected and re-run;
//                           if the reviewer says the math itself is wrong → "✘ math check failed"
//   ⚠️ still crashing after the repair → "the check code has an error" (says nothing about the math)
async function runVerify(box, code, context, repaired) {
  const status = box.querySelector(".verify-status");
  const out = box.querySelector(".verify-out");
  box.querySelector(".verify-run").disabled = true;
  box.classList.remove("passed", "failed", "broken");
  try {
    const r = await executePython(code, (s) => (status.textContent = s));
    const passed = (r.printed.match(/✔/g) || []).length;
    const failed = (r.printed.match(/✘/g) || []).length;
    const mathFailed = failed > 0 || (r.error && /AssertionError/.test(r.error));
    out.textContent = r.printed + (r.error ? "\n❌ " + r.error : "");
    out.hidden = !out.textContent.trim();

    if ((r.error || mathFailed) && !repaired && typeof api === "function") {
      status.textContent = mathFailed ? "🔍 A check failed — reviewing whether the check itself is fair…" : "🔧 The check code had an error — fixing it…";
      const res = await api("fixcode", "POST", { code: code, error: r.error || r.printed.slice(-1500), context: context || "", kind: mathFailed ? "assert" : "crash" });
      if (res.ok) {
        const fix = await res.json();
        box.querySelector("code").textContent = fix.code;
        if (typeof hljs !== "undefined") hljs.highlightElement(box.querySelector("code"));
        if (!fix.mathWrong) return runVerify(box, fix.code, context, true);
        box.dataset.reason = (fix.code.match(/#\s*MATH_WRONG:?\s*(.*)/) || [])[1] || "";
      }
    }
    if (mathFailed) {
      box.classList.add("failed");
      status.textContent = "✘ A math check failed" + (failed ? " (" + failed + " of " + (passed + failed) + ")" : "") +
        (box.dataset.reason ? ": " + box.dataset.reason : " — a step may be wrong, read carefully");
    } else if (r.error) {
      box.classList.add("broken");
      status.textContent = "⚠️ The check code has an error (this doesn't mean the math is wrong)" + (repaired ? " — even after an automatic fix" : "");
    } else {
      box.classList.add("passed");
      status.textContent = "✔ Verified by Python" + (passed ? " — " + passed + " check" + (passed > 1 ? "s" : "") + " passed" : "") + (repaired ? " (after correcting the check code)" : "");
    }
  } catch (e) {
    status.textContent = "⚠️ Could not run the check: " + e.message;
  }
  box.querySelector(".verify-run").disabled = false;
}

// ---------- 📏 Shape tracer ----------
// Runs NumPy code and records the shape (and dtype) of every variable assigned at the top level,
// shown next to the line that created it. (PyTorch can't run in a browser → use "📏 Shape trace" mode.)
const TRACER = [
  "import ast, json",
  "def _nexus_desc(v):",
  "    try:",
  "        if hasattr(v, 'shape') and hasattr(v, 'dtype'): return 'shape ' + str(tuple(v.shape)) + ' · ' + str(v.dtype)",
  "        if isinstance(v, (list, tuple)): return type(v).__name__ + ' of ' + str(len(v))",
  "        if isinstance(v, (int, float, complex, bool)): return type(v).__name__ + ' = ' + repr(v)[:30]",
  "        return type(v).__name__",
  "    except Exception: return '?'",
  "_nexus_rows = []",
  "def _nexus_rec(line, values):",
  "    _nexus_rows.append([line, [k + ': ' + _nexus_desc(v) for k, v in values.items()]])",
  "def _nexus_names(t):",
  "    if isinstance(t, ast.Name): return [t.id]",
  "    if isinstance(t, (ast.Tuple, ast.List)): return [n for e in t.elts for n in _nexus_names(e)]",
  "    return []",
  "_tree = ast.parse(_NEXUS_SRC)",
  "_body = []",
  "for _node in _tree.body:",
  "    _body.append(_node)",
  "    _targets = _node.targets if isinstance(_node, ast.Assign) else [_node.target] if isinstance(_node, (ast.AugAssign, ast.AnnAssign)) else []",
  "    _names = [n for t in _targets for n in _nexus_names(t)]",
  "    if _names:",
  "        _body.append(ast.parse('_nexus_rec(%d, {%s})' % (_node.end_lineno, ', '.join(repr(n) + ': ' + n for n in _names))).body[0])",
  "_tree.body = _body",
  "exec(compile(ast.fix_missing_locations(_tree), '<code>', 'exec'), globals())",
  "print('__NEXUS_SHAPES__' + json.dumps(_nexus_rows))",
].join("\n");

async function traceShapes(code, pre, btn) {
  const out = outputBox(pre);
  if (/\bimport torch\b|\bfrom torch\b|tensorflow|\bimport jax\b/.test(code)) {
    out.innerHTML = "<pre>PyTorch / TensorFlow can't run inside a browser. Choose “📏 Shape trace” in the dropdown and NEXUS will trace the shapes by reasoning.</pre>";
    return;
  }
  btn.disabled = true;
  out.innerHTML = "<pre>⏳ Tracing shapes…</pre>";
  try {
    // importsFrom = your code: the wrapper hides it inside a string, so Pyodide must read the original to find imports
    const r = await executePython("_NEXUS_SRC = " + JSON.stringify(code) + "\n" + TRACER, (s) => (out.querySelector("pre").textContent = s), code);
    const marker = r.printed.lastIndexOf("__NEXUS_SHAPES__");
    if (marker < 0) throw new Error(r.error || "nothing to trace");
    const rows = Object.fromEntries(JSON.parse(r.printed.slice(marker + 16)));
    out.innerHTML = '<div class="shape-trace"></div>';
    code.replace(/\n$/, "").split("\n").forEach((text, i) => {
      const row = document.createElement("div");
      row.className = "shape-row";
      row.innerHTML = "<code></code><span></span>";
      row.querySelector("code").textContent = text || " ";
      row.querySelector("span").textContent = rows[i + 1] ? "← " + rows[i + 1].join("   ") : "";
      out.querySelector(".shape-trace").appendChild(row);
    });
    const printed = r.printed.slice(0, marker).trim();
    if (printed) {
      const p = document.createElement("pre");
      p.textContent = printed;
      out.appendChild(p);
    }
  } catch (e) {
    out.innerHTML = "<pre></pre>";
    out.querySelector("pre").textContent = "❌ " + e.message;
  }
  btn.disabled = false;
}

// ---------- 🔗 Equation ↔ code grid ----------
// ```eqcode block, one step per line:   LaTeX  |||  code
function renderEqcode(codeBlock) {
  const rows = codeBlock.textContent.split("\n").filter((l) => l.includes("|||"));
  if (!rows.length) return;
  const grid = document.createElement("div");
  grid.className = "eqcode";
  grid.innerHTML = '<div class="eq-head">Math</div><div class="eq-head">Code</div>';
  for (const row of rows) {
    const [tex, code] = row.split("|||").map((x) => x.trim());
    const math = document.createElement("div");
    math.className = "eq-math";
    try { math.innerHTML = katex.renderToString(tex.replace(/^\$+|\$+$/g, ""), { displayMode: true, throwOnError: false }); } catch (e) { math.textContent = tex; }
    const pre = document.createElement("pre");
    const c = document.createElement("code");
    c.className = "language-python";
    c.textContent = code || "";
    pre.appendChild(c);
    if (typeof hljs !== "undefined") hljs.highlightElement(c);
    grid.appendChild(math);
    grid.appendChild(pre);
  }
  codeBlock.parentElement.replaceWith(grid);
}

// ---------- 🐢 Step-through ----------
// ```steps block with JSON: [{"title": "...", "body": "markdown + LaTeX"}, ...] → ◀ ▶ stepper
function renderSteps(codeBlock) {
  let steps = null;
  const raw = codeBlock.textContent;
  try { steps = JSON.parse(raw); } catch (e) {
    try { steps = JSON.parse(raw.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch (e2) { return; }   // LaTeX backslashes → valid JSON
  }
  if (!Array.isArray(steps) || !steps.length || typeof steps[0] !== "object") return;
  // accept different key names models use: body / content / description / explanation / text
  steps = steps.map((st, n) => ({
    title: st.title || st.name || st.step_title || (st.step !== undefined ? "Step " + st.step : "Step " + (n + 1)),
    body: st.body || st.content || st.description || st.explanation || st.text || st.state || JSON.stringify(st),
  }));
  const box = document.createElement("div");
  box.className = "stepper";
  box.innerHTML = '<div class="step-head"><button class="ghost prev">◀</button><b></b><button class="ghost next">▶</button></div><div class="step-body content"></div>';
  let i = 0;
  const draw = () => {
    box.querySelector("b").textContent = "Step " + (i + 1) + " / " + steps.length + " — " + (steps[i].title || "");
    box.querySelector(".step-body").innerHTML = toHtml(String(steps[i].body || ""));
    box.querySelector(".prev").disabled = i === 0;
    box.querySelector(".next").disabled = i === steps.length - 1;
  };
  box.querySelector(".prev").onclick = () => { i--; draw(); };
  box.querySelector(".next").onclick = () => { i++; draw(); };
  draw();
  codeBlock.parentElement.replaceWith(box);
}
