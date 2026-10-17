// ============================================================
//  check.js — quick safety check before uploading code
// ============================================================
//  Run:  npm run check
//  1. Every .js file must have valid syntax
//  2. No API key may be written inside the code by mistake

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const FOLDERS = ["web", "functions", "lib", "scripts"];
// Patterns that look like real secret keys
const KEY_PATTERNS = [/gsk_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/, /sk-or-v1-[a-f0-9]{20,}/, /ghp_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{30,}/, /nvapi-[A-Za-z0-9_-]{20,}/];

let problems = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) { walk(file); continue; }

    const text = fs.readFileSync(file, "utf8");
    for (const p of KEY_PATTERNS) {
      if (p.test(text)) { console.log("❌ Possible secret key in " + file); problems++; }
    }

    if (file.endsWith(".js")) {
      // Files using import/export are "modules": check a temporary .mjs copy of them
      const isModule = /^\s*(import|export) /m.test(text);
      const target = isModule ? path.join(os.tmpdir(), "nexus-check.mjs") : file;
      if (isModule) fs.writeFileSync(target, text);
      try {
        execFileSync(process.execPath, ["--check", target], { stdio: "pipe" });
      } catch (e) {
        console.log("❌ Syntax error in " + file + "\n" + e.stderr);
        problems++;
      }
    }
  }
}

FOLDERS.forEach((f) => fs.existsSync(f) && walk(f));
if (problems) { console.log(problems + " problem(s) found"); process.exit(1); }
console.log("✅ All files look good");
