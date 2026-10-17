// ============================================================
//  autograd.js — 🧮 Autograd lab: watch backpropagation happen
// ============================================================
//  Write a small expression with Value numbers (like PyTorch tensors, but single numbers), e.g.
//      a = Value(2.0); b = Value(-3.0); L = (a*b + b**2).tanh()
//  NEXUS runs it in the browser (Pyodide) with a tiny autograd engine and shows:
//   • the computation graph (every number with its value and gradient)
//   • every backward step: which chain-rule formula ran, with the real numbers
//   • a check: gradients from backprop vs. numerical gradients (finite differences)
//  The engine follows micrograd by Andrej Karpathy (MIT, github.com/karpathy/micrograd),
//  plus a log of each backward step so you can read what happened.

const ENGINE = `# A tiny autograd engine in the style of micrograd (Andrej Karpathy, MIT)
import math, json

class Value:
    count = 0            # how many input numbers were created (for the numerical check)
    nudge = (-1, 0.0)    # (which input, how much) - adds a tiny h to one input
    created = []

    def __init__(self, data, children=(), op=""):
        self.leaf_index = -1
        if not children:                       # an input number (a "leaf")
            self.leaf_index = Value.count
            if Value.count == Value.nudge[0]:
                data += Value.nudge[1]
            Value.count += 1
        self.data = float(data)
        self.grad = 0.0                        # d(output)/d(this), filled in by backward()
        self.children = children
        self.op = op
        self.name = ""
        self._backward = lambda: ""            # pushes this node's grad to its children; returns what it did
        Value.created.append(self)

    # one line for the step log, e.g.  "a.grad += 2 × 1 = 2   (∂L/∂a = b = 2)"
    def _log(self, local, out, why):
        return f"{self.name}.grad += {local:.4g} × {out.grad:.4g}  →  {self.grad:.4g}     ({why})"

    # ---------- operations: forward value + local derivative rule ----------
    def __add__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data + other.data, (self, other), "+")
        def _backward():
            self.grad += out.grad              # d(a+b)/da = 1
            first = self._log(1, out, f"∂({self.name}+{other.name})/∂{self.name} = 1")
            other.grad += out.grad             # d(a+b)/db = 1
            return first + chr(10) + other._log(1, out, f"∂({self.name}+{other.name})/∂{other.name} = 1")
        out._backward = _backward
        return out

    def __mul__(self, other):
        other = other if isinstance(other, Value) else Value(other)
        out = Value(self.data * other.data, (self, other), "*")
        def _backward():
            self.grad += other.data * out.grad     # d(a*b)/da = b
            first = self._log(other.data, out, f"∂({self.name}·{other.name})/∂{self.name} = {other.name}")
            other.grad += self.data * out.grad     # d(a*b)/db = a
            return first + chr(10) + other._log(self.data, out, f"∂({self.name}·{other.name})/∂{other.name} = {self.name}")
        out._backward = _backward
        return out

    def __pow__(self, k):
        assert isinstance(k, (int, float)), "only number powers, like x**2"
        out = Value(self.data ** k, (self,), f"**{k}")
        def _backward():
            self.grad += k * self.data ** (k - 1) * out.grad    # d(x^k)/dx = k x^(k-1)
            power = "" if k - 1 == 1 else f"^{k - 1:g}"
            return self._log(k * self.data ** (k - 1), out, f"∂({self.name}^{k:g})/∂{self.name} = {k:g}·{self.name}{power}")
        out._backward = _backward
        return out

    def tanh(self):
        t = math.tanh(self.data)
        out = Value(t, (self,), "tanh")
        def _backward():
            self.grad += (1 - t * t) * out.grad     # d tanh(x)/dx = 1 - tanh(x)^2
            return self._log(1 - t * t, out, f"∂tanh({self.name})/∂{self.name} = 1 − tanh²({self.name})")
        out._backward = _backward
        return out

    def sigmoid(self):
        s = 1 / (1 + math.exp(-self.data))
        out = Value(s, (self,), "sigmoid")
        def _backward():
            self.grad += s * (1 - s) * out.grad     # d sigmoid(x)/dx = s(1-s)
            return self._log(s * (1 - s), out, f"∂σ({self.name})/∂{self.name} = σ(1 − σ)")
        out._backward = _backward
        return out

    def relu(self):
        out = Value(max(0.0, self.data), (self,), "relu")
        def _backward():
            slope = 1.0 if self.data > 0 else 0.0   # d relu(x)/dx = 1 if x > 0 else 0
            self.grad += slope * out.grad
            return self._log(slope, out, f"∂relu({self.name})/∂{self.name} = {slope:g} because {self.name} {'>' if slope else '≤'} 0")
        out._backward = _backward
        return out

    def exp(self):
        e = math.exp(self.data)
        out = Value(e, (self,), "exp")
        def _backward():
            self.grad += e * out.grad               # d e^x/dx = e^x
            return self._log(e, out, f"∂e^{self.name}/∂{self.name} = e^{self.name}")
        out._backward = _backward
        return out

    def log(self):
        out = Value(math.log(self.data), (self,), "log")
        def _backward():
            self.grad += (1 / self.data) * out.grad # d ln(x)/dx = 1/x
            return self._log(1 / self.data, out, f"∂ln({self.name})/∂{self.name} = 1/{self.name}")
        out._backward = _backward
        return out

    # a - b = a + (-1)*b,  a / b = a * b^-1  (built from the rules above)
    def __neg__(self): return self * -1
    def __sub__(self, other): return self + (-other if isinstance(other, Value) else Value(-other))
    def __truediv__(self, other): return self * (other if isinstance(other, Value) else Value(other)) ** -1
    def __radd__(self, other): return self + other
    def __rmul__(self, other): return self * other
    def __rsub__(self, other): return Value(other) - self
    def __rtruediv__(self, other): return Value(other) / self

    # ---------- backpropagation ----------
    def backward(self):
        # 1. order the nodes so every node comes after its children (topological sort)
        order, seen = [], set()
        def visit(v):
            if id(v) not in seen:
                seen.add(id(v))
                for child in v.children:
                    visit(child)
                order.append(v)
        visit(self)
        # 2. d(output)/d(output) = 1, then walk backwards applying the chain rule
        self.grad = 1.0
        steps = []
        for v in reversed(order):
            if v.children:
                steps.append({"node": v.name, "op": v.op, "did": v._backward()})
        return order, steps
`;

// Runs the user's code with the engine, finds the output, backprops, checks numerically → JSON
const LAB_RUNNER = `
def _run(code, nudge=(-1, 0.0)):
    Value.count, Value.nudge, Value.created = 0, nudge, []
    ns = {"Value": Value, "math": math}
    exec(code, ns)
    named = {id(v): k for k, v in ns.items() if isinstance(v, Value)}
    used = {id(c) for v in Value.created for c in v.children}
    roots = [v for v in Value.created if v.children and id(v) not in used]
    out = next((ns[k] for k in ("L", "loss", "out", "y", "f") if isinstance(ns.get(k), Value)), None)
    out = out or (roots[-1] if roots else None)
    return ns, named, out

ns, named, out = _run(user_code)
assert out is not None, "No result found. Write something like  L = a * b  using Value numbers."
n = 0
for v in Value.created:
    if id(v) in named:
        v.name = named[id(v)]
    elif v.children:
        n += 1
        v.name = "t" + str(n)
    else:
        v.name = f"{v.data:g}" if v.data >= 0 else f"({v.data:g})"   # a plain number like 2 in  a * 2
order, steps = out.backward()
ids = {id(v): i for i, v in enumerate(order)}

# numerical check: nudge each named input by +-h and see how the output moves
h = 1e-6
checks = []
for v in order:
    if not v.children and id(v) in named:
        _, _, up = _run(user_code, (v.leaf_index, h))
        _, _, down = _run(user_code, (v.leaf_index, -h))
        checks.append({"name": v.name, "data": v.data, "grad": v.grad, "numeric": (up.data - down.data) / (2 * h)})

print("__AUTOGRAD__" + json.dumps({
    "output": out.name,
    "nodes": [{"id": i, "name": v.name, "data": v.data, "grad": v.grad, "op": v.op, "leaf": not v.children,
               "named": id(v) in named} for i, v in enumerate(order)],
    "edges": [[ids[id(c)], i] for i, v in enumerate(order) for c in v.children],
    "steps": steps, "checks": checks,
}))
`;

const LAB_EXAMPLES = {
  "Simple expression": "a = Value(2.0)\nb = Value(-3.0)\nc = Value(10.0)\ne = a * b\nd = e + c\nf = Value(-2.0)\nL = d * f",
  "One neuron (tanh)": "# inputs\nx1 = Value(2.0)\nx2 = Value(0.0)\n# weights and bias\nw1 = Value(-3.0)\nw2 = Value(1.0)\nb = Value(6.8813735870195432)\n" +
    "n = x1*w1 + x2*w2 + b\nL = n.tanh()",
  "Logistic regression loss": "x = Value(1.5)\nw = Value(0.8)\nb = Value(-0.3)\nz = w * x + b\np = z.sigmoid()      # predicted probability\ny = 1.0              # true label\nL = -(y * p.log() + (1 - y) * (1 - p).log())",
  "Squared error": "x = Value(3.0)\nw = Value(0.5)\ny = Value(2.0)\npred = w * x\nL = (pred - y) ** 2",
  "Same number used twice": "# why backward uses +=  (gradients from every path ADD UP)\na = Value(3.0)\nb = a * a      # b = a^2, so db/da = 2a = 6\nL = b + a      # dL/da = 2a + 1 = 7",
  "ReLU kills gradients": "x = Value(-1.5)\nw = Value(2.0)\nz = w * x\nL = z.relu()   # z < 0, so every gradient below is 0",
};

let labLast = null;   // last result (for "Ask NEXUS")

function openLab() {
  const box = $("labBox");
  if (!$("labExample").options.length) {
    for (const name of Object.keys(LAB_EXAMPLES)) $("labExample").add(new Option(name, name));
    $("labCode").value = LAB_EXAMPLES["Simple expression"];
    $("labEngine").textContent = ENGINE;
    if (typeof hljs !== "undefined") hljs.highlightElement($("labEngine"));
  }
  box.showModal();
}

async function runLab() {
  const status = $("labStatus");
  $("labRun").disabled = true;
  $("labResult").hidden = true;
  try {
    const code = ENGINE + "\nuser_code = " + JSON.stringify($("labCode").value) + "\n" + LAB_RUNNER;
    const r = await executePython(code, (s) => (status.textContent = s), "import math");
    if (r.error) throw new Error(r.error);
    const marker = r.printed.split("\n").find((l) => l.startsWith("__AUTOGRAD__"));
    if (!marker) throw new Error(r.printed || "no result");
    labLast = JSON.parse(marker.slice(12));
    status.textContent = "";
    drawLab(labLast);
  } catch (e) {
    labLast = null;
    status.textContent = "⚠️ " + e.message.split("\n").slice(-2).join(" ");
  }
  $("labRun").disabled = false;
}

const fmt = (x) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(3) : Number(x.toFixed(4)).toString());

function drawLab(res) {
  $("labResult").hidden = false;

  // 1. computation graph (mermaid): value boxes, op circles, arrows forward
  const graph = $("labGraph");
  graph.innerHTML = "";
  if (res.nodes.length > 45) {
    graph.innerHTML = '<p class="muted">The graph has ' + res.nodes.length + " nodes — too big to draw. The steps and the check below still work.</p>";
  } else {
    const lines = ["flowchart LR"];
    for (const n of res.nodes) {
      const cls = n.name === res.output ? ":::out" : n.leaf ? ":::leaf" : "";
      lines.push("  v" + n.id + '["<b>' + n.name + "</b><br/>data " + fmt(n.data) + "<br/>grad " + fmt(n.grad) + '"]' + cls);
      if (!n.leaf) lines.push("  o" + n.id + '(["' + n.op.replace("**", "^").replace("*", "×") + '"]):::op --> v' + n.id);
    }
    for (const [from, to] of res.edges) lines.push("  v" + from + " --> o" + to);
    lines.push("  classDef leaf stroke:#3b82f6,stroke-width:2px", "  classDef out stroke:#d97757,stroke-width:3px",
      "  classDef op font-size:18px,font-weight:bold");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = lines.join("\n");
    pre.appendChild(code);
    graph.appendChild(pre);
    renderMermaid(code);
  }

  // 2. backward steps (output first, then towards the inputs)
  const steps = $("labSteps");
  steps.innerHTML = "<li><b>" + res.output + ".grad = 1</b> — the output's gradient with respect to itself</li>";
  for (const s of res.steps) {
    const li = document.createElement("li");
    li.innerHTML = "<b></b> <span class='muted'></span><br><code></code>";
    li.querySelector("b").textContent = s.node;
    li.querySelector("span").textContent = "(" + s.op + ")";
    li.querySelector("code").textContent = s.did;
    steps.appendChild(li);
  }

  // 3. backprop vs numerical gradient
  const body = $("labChecks");
  body.innerHTML = "";
  for (const c of res.checks) {
    const rel = Math.abs(c.grad - c.numeric) / Math.max(1e-8, Math.abs(c.grad) + Math.abs(c.numeric));
    const tr = document.createElement("tr");
    [c.name, fmt(c.data), fmt(c.grad), fmt(c.numeric), rel < 1e-5 ? "✔" : "✘ " + rel.toExponential(1)].forEach((t) => {
      const td = document.createElement("td");
      td.textContent = t;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  }
}

// Send the experiment to the chat so NEXUS explains it step by step
function askAboutLab() {
  if (!labLast) return;
  $("labBox").close();
  $("input").value = "Explain step by step how backpropagation computes every gradient in this computation graph, and why each " +
    "chain-rule step is valid:\n```python\n" + $("labCode").value + "\n```\nResults: " +
    labLast.checks.map((c) => "d" + labLast.output + "/d" + c.name + " = " + fmt(c.grad)).join(", ");
  $("input").focus();
}

$("openLab").onclick = openLab;
$("labRun").onclick = runLab;
$("labAsk").onclick = askAboutLab;
$("labExample").onchange = () => { $("labCode").value = LAB_EXAMPLES[$("labExample").value]; runLab(); };
