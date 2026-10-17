// ============================================================
//  runners.js — 📊 charts and 📐 Mermaid diagrams (▶ Python lives in python.js)
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

// ---------- 📐 Diagrams (Mermaid) ----------
//
// NEXUS writes a diagram as text, for example:
//   ```mermaid
//   flowchart LR
//     A[Input tokens] --> B[Embedding] --> C[Transformer blocks] --> D[Output]
//   ```
// mermaid.js (MIT, github.com/mermaid-js/mermaid) turns it into a picture.

let mermaidLib = null;
let diagramCount = 0;

async function renderMermaid(codeBlock) {
  const source = codeBlock.textContent;
  try {
    if (!mermaidLib) {
      mermaidLib = (await import("https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.esm.min.mjs")).default;
    }
    mermaidLib.initialize({ startOnLoad: false, theme: isDark() ? "dark" : "neutral", securityLevel: "strict", fontFamily: "Inter, sans-serif" });
    const { svg } = await mermaidLib.render("nexus-diagram-" + ++diagramCount, source);

    const box = document.createElement("div");
    box.className = "chart-box diagram-box";
    box.innerHTML = svg + '<div class="chart-actions"><button class="code-btn">{ } Code</button><button class="svg-btn">⬇️ SVG</button></div><pre class="diagram-src" hidden></pre>';
    box.querySelector(".diagram-src").textContent = source;
    box.querySelector(".code-btn").onclick = () => (box.querySelector(".diagram-src").hidden = !box.querySelector(".diagram-src").hidden);
    box.querySelector(".svg-btn").onclick = () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([box.querySelector("svg").outerHTML], { type: "image/svg+xml" }));
      link.download = "diagram.svg";
      link.click();
    };
    box.mermaidSource = source;
    codeBlock.parentElement.replaceWith(box);
  } catch (e) {
    // a broken diagram stays visible as code, with a small note
    codeBlock.parentElement.insertAdjacentHTML("afterend", '<p class="muted" style="font-size:12px">⚠️ This diagram has a syntax error, showing the code instead.</p>');
  }
}

// Redraw diagrams when you switch light/dark (they have different colors)
async function redrawDiagrams() {
  for (const box of document.querySelectorAll(".diagram-box")) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = box.mermaidSource;
    pre.appendChild(code);
    box.replaceWith(pre);
    await renderMermaid(code);
  }
}

