// ============================================================
//  render.js — turns an AI answer (markdown + math) into safe HTML
// ============================================================
//  Used by the main page (app.js) and the read-only share page (share.html).

// Turn markdown text into safe HTML, with math formulas drawn by KaTeX.
//
// Why so many steps? The markdown converter would break math ( \cdot, x_1 … ),
// so we take the math OUT first, convert the markdown, then put the drawn math back.
//   1. hide code blocks (math inside code must stay as code)
//   2. find math: $$…$$, \[…\], \(…\), $…$  → draw it with KaTeX, leave a placeholder
//   3. put the code back, convert markdown → HTML, clean it (DOMPurify)
//   4. replace the placeholders with the drawn math
function toHtml(text) {
  // Some models cite like 【1†L1-L3】 — show it as a normal [1]
  text = (text || "").replace(/【(\d+)(?:†[^】]*)?】/g, "[$1]");
  const code = [], math = [];
  const hideCode = (s) => { code.push(s); return "@@CODE" + (code.length - 1) + "@@"; };
  const drawMath = (tex, display) => {
    if (typeof katex === "undefined") return display ? "$$" + tex + "$$" : "$" + tex + "$";
    math.push(katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false }));
    return "@@MATH" + (math.length - 1) + "@@";
  };

  text = text.replace(/```[\s\S]*?(```|$)|`[^`\n]+`/g, hideCode);
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g, (all, a, b) => drawMath(a || b, true));
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (all, a) => drawMath(a, false));
  // $…$ only when it looks like math: no space just inside the $ signs and no digit right after
  // (so "costs $5 and $10" stays normal text)
  text = text.replace(/\$(?=\S)([^\n$]+?)(?<=\S)\$(?!\d)/g, (all, a) => drawMath(a, false));
  text = text.replace(/@@CODE(\d+)@@/g, (all, i) => code[i]);

  const html = DOMPurify.sanitize(marked.parse(text));
  return html.replace(/@@MATH(\d+)@@/g, (all, i) => math[i]);
}
