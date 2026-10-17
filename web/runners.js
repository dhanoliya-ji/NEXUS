// ============================================================
//  runners.js — 📊 charts and ▶ Python code that runs in your browser
// ============================================================
//  Both work on code blocks inside NEXUS's answers:
//   ```chart   {"type":"bar", ...}   → drawn as a real chart (Chart.js)
//   ```python  print("hi")           → gets a ▶ Run button (Pyodide = Python in the browser)
//  Everything runs on YOUR device, free, no server needed.

// ---------- 📊 Charts ----------
//
// NEXUS writes a small JSON description, for example:
//   {"type":"bar", "title":"Sales", "labels":["Jan","Feb"],
//    "series":[{"name":"2026","data":[10,20]}], "x":"Month", "y":"₹ lakh"}
// type = bar | line | pie | doughnut | scatter

// Colorblind-safe palette (checked with a validator) — light and dark versions.
// Colors are given to series in this fixed order, never shuffled.
const CHART_COLORS = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark:  ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}

// Replace a ```chart code block with a chart (+ a "📋 Table" button showing the numbers)
async function renderChart(codeBlock) {
  let spec;
  try {
    spec = JSON.parse(codeBlock.textContent);
  } catch (e) {
    return;                                  // not valid JSON → leave it as code
  }
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js");

  const box = document.createElement("div");
  box.className = "chart-box";
  box.innerHTML = '<canvas></canvas><div class="chart-actions"><button class="table-btn">📋 Table</button>' +
    '<button class="png-btn">⬇️ PNG</button></div><div class="chart-table" hidden></div>';
  codeBlock.parentElement.replaceWith(box);   // the <pre> becomes the chart

  box.spec = spec;
  drawChart(box);
  box.querySelector(".chart-table").innerHTML = chartTable(spec);
  box.querySelector(".table-btn").onclick = () => {
    const table = box.querySelector(".chart-table");
    table.hidden = !table.hidden;
  };
  box.querySelector(".png-btn").onclick = () => {
    const link = document.createElement("a");
    link.href = box.querySelector("canvas").toDataURL("image/png");
    link.download = (spec.title || "chart").replace(/[^\w\- ]+/g, "") + ".png";
    link.click();
  };
}

// Turn our simple description into a Chart.js chart (also called again when the theme changes)
function drawChart(box) {
  const spec = box.spec;
  if (box.chart) box.chart.destroy();

  const css = getComputedStyle(document.documentElement);
  const text = css.getPropertyValue("--text").trim();
  const muted = css.getPropertyValue("--muted").trim();
  const grid = css.getPropertyValue("--border").trim();
  const surface = css.getPropertyValue("--bg").trim();
  const colors = CHART_COLORS[isDark() ? "dark" : "light"];
  const round = spec.type === "pie" || spec.type === "doughnut";
  const series = (spec.series || []).slice(0, 8);   // max 8 colors, never invented ones

  const datasets = series.map((s, i) => {
    const color = colors[i % colors.length];
    return {
      label: s.name || "Series " + (i + 1),
      data: s.data,
      backgroundColor: round ? s.data.map((_, j) => colors[j % colors.length]) : color,
      borderColor: round ? surface : color,
      borderWidth: round ? 2 : spec.type === "line" ? 2 : 0,   // 2px gap between pie slices
      borderRadius: spec.type === "bar" ? 4 : 0,
      pointRadius: spec.type === "line" ? 3 : 4,
      pointHoverRadius: 6,
      tension: 0.25,
    };
  });

  const axisTitle = (t) => ({ display: Boolean(t), text: t || "", color: muted });
  box.chart = new Chart(box.querySelector("canvas"), {
    type: spec.type === "scatter" ? "scatter" : spec.type || "bar",
    data: { labels: spec.labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: round ? 1.4 : 1.8,
      interaction: { mode: spec.type === "line" ? "index" : "nearest", intersect: false },
      plugins: {
        title: { display: Boolean(spec.title), text: spec.title, color: text, font: { size: 15, weight: "500" } },
        legend: { display: round || series.length > 1, labels: { color: text, usePointStyle: true, boxWidth: 8 } },
        tooltip: { enabled: true },
      },
      scales: round ? {} : {
        x: { title: axisTitle(spec.x), ticks: { color: muted }, grid: { display: false }, border: { color: grid } },
        y: { title: axisTitle(spec.y), ticks: { color: muted }, grid: { color: grid }, border: { display: false }, beginAtZero: spec.type === "bar" },
      },
    },
  });
}

// The same numbers as a simple table (for exact values, printing and screen readers)
function chartTable(spec) {
  const series = spec.series || [];
  let html = "<table><tr><th>" + (spec.x || "") + "</th>" + series.map((s) => "<th>" + (s.name || "") + "</th>").join("") + "</tr>";
  (spec.labels || []).forEach((label, i) => {
    html += "<tr><td>" + label + "</td>" + series.map((s) => "<td>" + JSON.stringify(s.data[i] ?? "") + "</td>").join("") + "</tr>";
  });
  return DOMPurify.sanitize(html + "</table>");
}

// Redraw all charts with the right colors when you switch light/dark
function redrawCharts() {
  document.querySelectorAll(".chart-box").forEach((box) => box.spec && drawChart(box));
}

// ---------- ▶ Python in your browser (Pyodide) ----------
//
// The first run downloads Python (~10 MB, about 10 seconds), then it's fast.
// Popular packages (numpy, pandas, matplotlib…) load automatically when imported.
// matplotlib charts are shown as pictures under the code.

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyodide = null;

function addRunButton(codeBlock) {
  const btn = document.createElement("button");
  btn.className = "run-code";
  btn.textContent = "▶ Run";
  btn.onclick = () => runPython(codeBlock.innerText, codeBlock.parentElement, btn);
  codeBlock.parentElement.appendChild(btn);
}

async function runPython(code, pre, btn) {
  let out = pre.nextElementSibling;
  if (!out || !out.classList.contains("run-output")) {
    out = document.createElement("div");
    out.className = "run-output";
    pre.after(out);
  }
  btn.disabled = true;
  out.innerHTML = "<pre></pre>";
  const show = (text) => (out.querySelector("pre").textContent = text);

  try {
    if (!pyodide) {
      show("⏳ Starting Python (first time only, ~10 seconds)…");
      await loadScript(PYODIDE + "pyodide.js");
      pyodide = await loadPyodide({ indexURL: PYODIDE });
    }
    show("⏳ Running…");
    await pyodide.loadPackagesFromImports(code);     // e.g. "import numpy" → downloads numpy

    let printed = "";
    pyodide.setStdout({ batched: (s) => (printed += s + "\n") });
    pyodide.setStderr({ batched: (s) => (printed += s + "\n") });
    const usesPlot = /matplotlib|plt\./.test(code);
    if (usesPlot) await pyodide.runPythonAsync("import matplotlib\nmatplotlib.use('AGG')");

    const result = await pyodide.runPythonAsync(code);
    if (result !== undefined && result !== null && !printed.trim()) printed += String(result);
    show(printed.trim() || "✅ Done (no output)");

    // Collect matplotlib figures as PNG pictures
    if (usesPlot) {
      const images = pyodide.runPython(
        "import io, base64\nimport matplotlib.pyplot as plt\n_imgs = []\n" +
        "for n in plt.get_fignums():\n    b = io.BytesIO()\n    plt.figure(n).savefig(b, format='png', dpi=110, bbox_inches='tight')\n" +
        "    _imgs.append(base64.b64encode(b.getvalue()).decode())\nplt.close('all')\n_imgs"
      ).toJs();
      for (const data of images) {
        const img = document.createElement("img");
        img.src = "data:image/png;base64," + data;
        out.appendChild(img);
      }
    }
  } catch (e) {
    show("❌ " + e.message.split("\n").slice(-4).join("\n"));   // the last lines of a Python error are the useful part
  }
  btn.disabled = false;
}
