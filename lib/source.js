// ============================================================
//  source.js — 🔍 read the REAL source code of ML libraries
// ============================================================
//  Two tools:
//   source_code    "torch | Dropout", "sklearn | LogisticRegression.fit", "transformers | BertSelfAttention"
//                  → finds the class/function in the library's GitHub repo and returns just that part
//   reference_impl "attention", "lora", "backprop", "bpe tokenizer"
//                  → a small, readable from-scratch implementation to learn from
//                    (karpathy's micrograd / nanoGPT / minbpe and labml.ai's annotated papers — all MIT)
//
//  How the code is found: Sourcegraph's free public code search knows every symbol (class,
//  function) in big GitHub repos. It returns the file + line; we download the file from GitHub
//  and cut out the block. Backup: GitHub code search (only if GITHUB_TOKEN is set).

const HEADERS = { "User-Agent": "NEXUS/1.0 (personal AI assistant)" };
const enc = encodeURIComponent;

// Library name → GitHub repo
const REPOS = {
  torch: "pytorch/pytorch", pytorch: "pytorch/pytorch", nn: "pytorch/pytorch", f: "pytorch/pytorch",
  sklearn: "scikit-learn/scikit-learn", "scikit-learn": "scikit-learn/scikit-learn",
  transformers: "huggingface/transformers", peft: "huggingface/peft", diffusers: "huggingface/diffusers",
  datasets: "huggingface/datasets", accelerate: "huggingface/accelerate", trl: "huggingface/trl",
  timm: "huggingface/pytorch-image-models", tokenizers: "huggingface/tokenizers",
  "sentence-transformers": "huggingface/sentence-transformers", sentence_transformers: "huggingface/sentence-transformers",
  numpy: "numpy/numpy", np: "numpy/numpy", scipy: "scipy/scipy", pandas: "pandas-dev/pandas", pd: "pandas-dev/pandas",
  tensorflow: "tensorflow/tensorflow", tf: "tensorflow/tensorflow", keras: "keras-team/keras",
  jax: "jax-ml/jax", flax: "google/flax", torchvision: "pytorch/vision", lightning: "Lightning-AI/pytorch-lightning",
  xgboost: "dmlc/xgboost", lightgbm: "microsoft/LightGBM", spacy: "explosion/spaCy", nltk: "nltk/nltk",
  gensim: "piskvorky/gensim", langchain: "langchain-ai/langchain", micrograd: "karpathy/micrograd",
  nanogpt: "karpathy/nanoGPT", minbpe: "karpathy/minbpe", vllm: "vllm-project/vllm",
};

// Paths that are rarely what you want (tests, benchmarks, exporters, internal re-implementations)
const UNWANTED = /(^|\/)(tests?|testing|benchmarks?|asv_benchmarks|examples?|docs?)\/|test_|_test\.|onnx|\/_refs\/|_meta_|\/ao\/|quantiz|\/masked\/|_internal|\/(tf|flax)_|modeling_(tf|flax)_/i;

// ---------- Sourcegraph search (streaming API; we read the whole answer) ----------
async function sourcegraph(query, retry = true) {
  const res = await sourcegraphOnce(query).catch((e) => { if (!retry) throw e; return null; });
  return res || sourcegraphOnce(query);
}
async function sourcegraphOnce(query) {
  const res = await fetch("https://sourcegraph.com/.api/search/stream?q=" + enc(query), {
    headers: { ...HEADERS, Accept: "text/event-stream" }, signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error("sourcegraph said " + res.status);
  const text = await res.text();
  const matches = [];
  for (const part of text.split("\n\n")) {
    if (part.startsWith("event: matches")) matches.push(...JSON.parse(part.slice(part.indexOf("data: ") + 6)));
  }
  return matches;
}

// "torch.nn.Dropout" → {cls:"Dropout"}   "LogisticRegression.fit" → {cls:"LogisticRegression", method:"fit"}
// "F.softmax" → {name:"softmax"}
function parseSymbol(symbol) {
  const parts = symbol.replace(/\(\)$/, "").split(".").filter(Boolean);
  const c = parts.findLastIndex((p) => /^[A-Z]/.test(p) && p !== "F");
  if (c >= 0) return { name: parts[c], method: parts[c + 1] };
  return { name: parts[parts.length - 1] };
}

// Find where a symbol is defined → [{path, line, commit}], best first
async function findSymbol(repo, name, env) {
  try {
    const matches = await sourcegraph("repo:^github\\.com/" + repo.replace(/[.]/g, "\\.") + "$ type:symbol " + name + " count:60");
    const found = [];
    for (const m of matches) {
      for (const s of m.symbols || []) {
        if (s.name.toLowerCase() !== name.toLowerCase() || !/CLASS|FUNCTION|METHOD|STRUCT/.test(s.kind)) continue;
        // score: exact case + not a test file + top-level + short path = better
        const score = (s.name === name ? 0 : 10) + (UNWANTED.test(m.path) ? 20 : 0) + (s.containerName ? 3 : 0) +
          (m.language === "Python" ? 0 : 2) + m.path.length / 100;
        found.push({ path: m.path, line: s.line, commit: m.commit, score: score });
      }
    }
    if (found.length) return found.sort((a, b) => a.score - b.score);
  } catch (e) { /* try GitHub next */ }

  // Backup: GitHub code search (needs a token) → we find the line ourselves later
  if (!env.GITHUB_TOKEN) return [];
  const headers = { ...HEADERS, Accept: "application/vnd.github+json", Authorization: "Bearer " + env.GITHUB_TOKEN };
  const res = await fetch("https://api.github.com/search/code?per_page=10&q=" + enc('"class ' + name + '" OR "def ' + name + '" repo:' + repo),
    { headers: headers, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return [];
  const data = await res.json();
  return data.items.filter((i) => !UNWANTED.test(i.path)).map((i) => ({ path: i.path, line: 0, commit: "HEAD" }));
}

// ---------- Cut one class/function out of a file ----------
// Python: the block = decorators + signature + every following line that is indented deeper.
// Other languages: match { } braces.
function cutBlock(lines, start, python) {
  let begin = start;
  while (begin > 0 && /^\s*@/.test(lines[begin - 1])) begin--;
  if (!python) {
    let depth = 0, opened = false, end = start;
    for (; end < lines.length && end < start + 400; end++) {
      for (const ch of lines[end]) {
        if (ch === "{") { depth++; opened = true; }
        if (ch === "}") depth--;
      }
      if (opened && depth <= 0) break;
    }
    return { begin: begin, end: end };
  }
  const indent = lines[start].match(/^\s*/)[0].length;
  let i = start;
  while (i < lines.length - 1 && !/:\s*(#.*)?$/.test(lines[i])) i++;   // multi-line signature ends with ":"
  let inString = false;
  for (i = i + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!inString && line.trim() && line.match(/^\s*/)[0].length <= indent) break;
    if (((line.match(/"""|'''/g) || []).length) % 2 === 1) inString = !inString;   // inside a docstring, indentation doesn't count
  }
  while (i > start && !lines[i - 1].trim()) i--;
  return { begin: begin, end: i - 1 };
}

// Long docstrings (scikit-learn's are 300+ lines) → keep the first 15 lines
function shortenDocstring(block) {
  const lines = block.split("\n");
  const first = lines.findIndex((l, i) => i > 0 && /^\s*[rbu]?("""|''')/.test(l));
  if (first < 0 || first > 12) return block;
  let last = first;
  if ((lines[first].match(/"""|'''/g) || []).length < 2) {
    for (last = first + 1; last < lines.length && !/"""|'''/.test(lines[last]); last++);
  }
  if (last - first <= 25) return block;
  const indent = lines[first].match(/^\s*/)[0];
  return lines.slice(0, first + 15).concat([indent + "... (docstring shortened: " + (last - first - 15) + " more lines)", lines[last]],
    lines.slice(last + 1)).join("\n");
}

// A plain question → "library | symbol" (used when the tool-picking model forgets the tool)
// "How does PyTorch nn.Dropout work?" → "pytorch | nn.Dropout"
export function guessSourceInput(text) {
  const words = text.match(/[A-Za-z_][\w.\-]*/g) || [];
  const lib = words.find((w) => REPOS[w.toLowerCase()] && !["nn", "f", "np", "pd", "tf", "datasets"].includes(w.toLowerCase())) ||
    words.map((w) => w.split(".")[0]).find((w) => REPOS[w.toLowerCase()]);
  if (!lib) return "";
  const symbol =
    words.find((w) => /\.[A-Za-z_]/.test(w) && w.toLowerCase() !== lib.toLowerCase() && !/^\W|\.$/.test(w)) ||   // nn.Dropout, F.softmax
    words.find((w) => /^[A-Z][a-z0-9]+[A-Z]\w*$/.test(w) && !REPOS[w.toLowerCase()]) ||                     // LogisticRegression
    words.find((w) => /^[a-z]+_[a-z_]+$/.test(w)) ||                                                        // scaled_dot_product_attention
    words.slice(1).find((w) => /^[A-Z][a-z]{3,}$/.test(w) && !REPOS[w.toLowerCase()] && !/^(How|What|Why|Explain|Show|Does|Internally)$/.test(w));
  return symbol ? lib + " | " + symbol.replace(/[.,;:?!]+$/, "") : "";
}

const MAX_LINES = 230;

// input "library | symbol"  (also works: "torch.nn.Dropout", "pytorch/pytorch | Dropout")
export async function sourceCode(input, env) {
  let [lib, symbol] = input.includes("|") ? input.split("|").map((s) => s.trim()) : [input.trim().split(".")[0], input.trim()];
  if (!symbol) symbol = lib;
  const repo = lib.includes("/") ? lib : REPOS[lib.toLowerCase()];
  if (!repo) return "Unknown library '" + lib + "'. Known: " + Object.keys(REPOS).join(", ") + " — or use 'owner/repo | symbol'.";
  const want = parseSymbol(symbol);

  const places = await findSymbol(repo, want.name, env);
  if (!places.length) return "Could not find " + want.name + " in " + repo + ".";

  for (const place of places.slice(0, 2)) {
    const res = await fetch("https://raw.githubusercontent.com/" + repo + "/" + place.commit + "/" + place.path,
      { headers: HEADERS, signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (!res || !res.ok) continue;
    const lines = (await res.text()).split("\n");
    const python = place.path.endsWith(".py");
    const definition = new RegExp("^\\s*(async\\s+def|def|class|function|struct|fn|pub\\s+fn|template.*class)\\s+" + want.name + "\\b");
    let start = place.line ? place.line - 1 : -1;
    if (start < 0 || !definition.test(lines[start] || "")) start = lines.findIndex((l) => definition.test(l));
    if (start < 0) continue;

    let { begin, end } = cutBlock(lines, start, python);
    let title = want.name;
    const notes = [];
    // "Class.method" → cut the method out of the class
    if (want.method) {
      const methodRe = new RegExp("^\\s*(async\\s+)?def\\s+" + want.method + "\\b");
      const m = lines.slice(start, end + 1).findIndex((l) => methodRe.test(l));
      if (m >= 0) {
        ({ begin, end } = cutBlock(lines, start + m, python));
        title += "." + want.method;
      } else {
        notes.push(want.method + " is not defined in " + want.name + " itself — it is inherited. Class line: " + lines[start].trim());
      }
    }
    // Too long → show the start and list the methods that were cut
    let shown = shortenDocstring(lines.slice(begin, end + 1).join("\n")).split("\n");
    if (shown.length > MAX_LINES) {
      const rest = shown.slice(MAX_LINES).map((l, i) => [l, i]).filter(([l]) => /^\s+(async\s+)?def\s+\w+/.test(l))
        .map(([l]) => l.trim().match(/def\s+(\w+)/)[1]);
      notes.push("Showing the first " + MAX_LINES + " of " + shown.length + " lines." +
        (rest.length ? " Methods not shown: " + rest.join(", ") + " (ask for '" + lib + " | " + want.name + ".<method>')." : ""));
      shown = shown.slice(0, MAX_LINES);
    }
    const link = "https://github.com/" + repo + "/blob/" + place.commit + "/" + place.path + "#L" + (begin + 1) + "-L" + (end + 1);
    const imports = python ? lines.slice(0, 80).filter((l) => /^(from|import)\s/.test(l)).slice(0, 15).join("\n") : "";
    return "REAL SOURCE of " + title + " from " + repo + " — " + place.path + " lines " + (begin + 1) + "-" + (end + 1) +
      "\nLink: " + link + (notes.length ? "\nNote: " + notes.join(" ") : "") +
      (imports ? "\nFile imports (to know where helpers come from):\n" + imports : "") +
      "\n```" + (python ? "python" : "") + "\n" + shown.join("\n") + "\n```" +
      (places.length > 1 ? "\nOther definitions: " + places.slice(1, 4).map((p) => p.path + ":" + p.line).join(", ") : "");
  }
  return "Found " + want.name + " in " + repo + " but could not read the file.";
}

// ============================================================
//  reference_impl — small from-scratch implementations to learn from
// ============================================================
// karpathy's tiny repos (MIT): picked by keywords
const KARPATHY = [
  { words: /autograd|backprop|back-prop|chain rule|computational graph|computation graph|micrograd|automatic differentiation/i,
    repo: "karpathy/micrograd", files: ["micrograd/engine.py"], about: "micrograd: a ~100-line scalar autograd engine" },
  { words: /\b(mlp|neuron|perceptron|multi-layer)\b/i, repo: "karpathy/micrograd", files: ["micrograd/nn.py"], about: "micrograd's tiny neural net library" },
  { words: /\bgpt\b|nanogpt|causal self.?attention|decoder.?only|transformer language model/i,
    repo: "karpathy/nanoGPT", files: ["model.py"], about: "nanoGPT: a full GPT-2 in ~300 lines of PyTorch" },
  { words: /\bbpe\b|byte.?pair|tokeni[sz]/i, repo: "karpathy/minbpe", files: ["minbpe/base.py", "minbpe/basic.py"],
    about: "minbpe: the Byte Pair Encoding algorithm used by GPT tokenizers" },
];

// labml.ai annotated paper implementations (MIT): topic words → folder names used in that repo
const LABML_ALIASES = {
  "multi head attention": "mha", "multi-head attention": "mha", "self attention": "mha", "self-attention": "mha", attention: "mha",
  "rotary": "rope", "rope": "rope", "batch norm": "batch_norm", batchnorm: "batch_norm", "layer norm": "layer_norm", layernorm: "layer_norm",
  "group norm": "group_norm", "rms norm": "rmsnorm", rmsnorm: "rmsnorm", adam: "optimizers/adam", adamw: "adam_warmup",
  diffusion: "ddpm", ddpm: "ddpm", ddim: "ddim", "stable diffusion": "stable_diffusion", "vision transformer": "vit", vit: "vit",
  gan: "gan/original", dcgan: "dcgan", "cycle gan": "cycle_gan", cyclegan: "cycle_gan", "wasserstein": "wasserstein",
  ppo: "rl/ppo", dqn: "rl/dqn", lstm: "lstm", resnet: "resnet", "u-net": "unet", unet: "unet", lora: "lora", vae: "vae",
  "knowledge distillation": "distillation", distillation: "distillation", "mixture of experts": "switch", moe: "switch",
  "positional encoding": "positional_encoding", "feed forward": "feed_forward", ffn: "feed_forward", dropout: "dropout",
  "graph attention": "gat", gat: "gat", capsule: "capsule_networks", "hypernetwork": "hypernetworks", "alibi": "alibi",
  "sampling": "sampling", "nucleus": "sampling/nucleus", "top-k": "sampling/top_k", "temperature": "sampling/temperature",
};

function labmlPathWords(topic) {
  const t = topic.toLowerCase();
  const key = Object.keys(LABML_ALIASES).sort((a, b) => b.length - a.length).find((k) => t.includes(k));
  return key ? LABML_ALIASES[key] : t.replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ");
}

async function readFile(repo, path, maxChars) {
  const res = await fetch("https://raw.githubusercontent.com/" + repo + "/HEAD/" + path, { headers: HEADERS, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("GitHub said " + res.status);
  const text = await res.text();
  return text.length > maxChars ? text.slice(0, maxChars) + "\n# ... (file continues)" : text;
}

export async function referenceImpl(topic) {
  const parts = [];
  const pick = KARPATHY.find((k) => k.words.test(topic));
  const labml = (async () => {
    const words = labmlPathWords(topic);
    if (!words) return "";
    const matches = await sourcegraph("repo:^github\\.com/labmlai/annotated_deep_learning_paper_implementations$ type:path file:^labml_nn/.*\\.py$ " + words + " count:20");
    const files = matches.map((m) => m.path).filter((p) => !/experiment|_test|test_/.test(p))
      .sort((a, b) => (a.endsWith("__init__.py") ? 0 : 1) - (b.endsWith("__init__.py") ? 0 : 1) || a.length - b.length);
    if (!files.length) return "";
    const path = files[0];
    const page = "https://nn.labml.ai/" + path.replace(/^labml_nn\//, "").replace(/__init__\.py$/, "index.html").replace(/\.py$/, ".html");
    const code = await readFile("labmlai/annotated_deep_learning_paper_implementations", path, pick ? 6000 : 9000);
    return "### labml.ai annotated implementation — " + path + "\nAnnotated page (math + code side by side): " + page +
      "\nGitHub: https://github.com/labmlai/annotated_deep_learning_paper_implementations/blob/master/" + path +
      "\n```python\n" + code + "\n```";
  })().catch(() => "");

  if (pick) {
    const texts = await Promise.all(pick.files.map((f) => readFile(pick.repo, f, 7000).catch(() => "")));
    parts.push("### " + pick.about + " (" + pick.repo + ")\n" + pick.files.map((f, i) => texts[i] ?
      "File " + f + " — https://github.com/" + pick.repo + "/blob/master/" + f + "\n```python\n" + texts[i] + "\n```" : "").join("\n"));
  }
  const labmlText = await labml;
  if (labmlText) parts.push(labmlText);
  return parts.length ? parts.join("\n\n") + "\n(Both sources are MIT licensed — credit them when quoting.)"
    : "No reference implementation found for '" + topic + "'. Try github_repos.";
}
