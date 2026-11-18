#!/usr/bin/env node
// 按“英文 -> 中文”映射替换上游源码里的界面字符串字面量。
// 手写扫描器（不用正则跨行），只替换完整、可读的文案，跳过路径/URL/标识符/含插值的模板串。
//
// 用法：
//   node scripts/apply.mjs --upstream /path/to/omp-checkout [--map dist/en-zh.json] [--dry-run]
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const getArg = (name, def) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : def;
};
const upstream = getArg("--upstream");
const dryRun = argv.includes("--dry-run");
if (!upstream || !fs.existsSync(upstream)) {
  console.error("用法: node scripts/apply.mjs --upstream <omp checkout> [--dry-run]");
  process.exit(2);
}

const cwd = process.cwd();
const map = JSON.parse(fs.readFileSync(path.resolve(cwd, getArg("--map", "dist/en-zh.json")), "utf8"));
const reportFile = path.resolve(cwd, getArg("--report", "dist/apply-report.json"));

const roots = ["packages/coding-agent/src", "packages/tui/src", "packages/stats/src"];
const exts = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SKIP_PREFIX = /^(https?:|\/|\.\.?\/|--)/i;

function translatable(text) {
  if (!map[text]) return null;
  if (SKIP_PREFIX.test(text)) return null;
  if (!/[A-Za-z]/.test(text)) return null;
  const hasSpace = text.includes(" ");
  const sentence = /[.!?:]$/.test(text);
  if (!hasSpace && !sentence && text.length < 12) return null;
  if (/^[\w./:-]+$/.test(text)) return null;
  return map[text];
}

/** 扫描一段源码，返回字符串字面量区间（含引号）与内容。 */
function scanStrings(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    // 跳过行注释
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // 跳过块注释
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      let hasSubstitution = false;
      let closed = false;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (quote === "`" && c === "$" && src[j + 1] === "{") hasSubstitution = true;
        if (c === quote) {
          closed = true;
          break;
        }
        if (c === "\n" && quote !== "`") break;
        j++;
      }
      if (closed) {
        const raw = src.slice(i + 1, j);
        out.push({ start: i, end: j + 1, quote, raw, hasSubstitution });
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

// 二次补丁：多行/带插值的模板串（无法按整串字面量替换）
const patchesFile = path.resolve(cwd, "patches/descriptions.json");
let patchCount = 0;
if (fs.existsSync(patchesFile) && !dryRun) {
  const patches = JSON.parse(fs.readFileSync(patchesFile, "utf8"));
  for (const p of patches) {
    const f = path.join(upstream, p.file);
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (!src.includes(p.old)) continue;
    fs.writeFileSync(f, src.replace(p.old, p.new), "utf8");
    patchCount++;
  }
}


const report = { files: 0, replaced: 0, byFile: {} };
const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : exts.has(path.extname(d.name)) ? [p] : [];
  });
};

for (const root of roots) {
  for (const file of walk(path.join(upstream, root))) {
    const src = fs.readFileSync(file, "utf8");
    const strings = scanStrings(src);
    let out = "";
    let last = 0;
    let count = 0;
    for (const s of strings) {
      // 保守策略：只替换单行、单/双引号字符串；模板串与含花括号/换行的内容一律跳过
      if (s.hasSubstitution) continue;
      if (s.quote === "`" && s.raw.includes("\n")) continue; // 多行模板串不动
      const text = s.raw.replace(/\\(["'`\\])/g, "$1");
      if (text.includes("\n")) continue;
      // 花括号允许，但不能是未闭合的占位符（避免破坏语法）
      if ((text.match(/\{/g) || []).length !== (text.match(/\}/g) || []).length) continue;
      const zh = translatable(text);
      if (!zh) continue;
      out += src.slice(last, s.start) + JSON.stringify(zh);
      last = s.end;
      count++;
    }
    if (count === 0) continue;
    out += src.slice(last);
    report.files++;
    report.replaced += count;
    report.byFile[path.relative(upstream, file)] = count;
    if (!dryRun) fs.writeFileSync(file, out, "utf8");
  }
}

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1), "utf8");
const top = Object.entries(report.byFile)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
console.log(`模板补丁 ${patchCount} 处`);
console.log(`替换 ${report.replaced} 处，涉及 ${report.files} 个文件${dryRun ? "（dry-run，未写盘）" : ""}`);
for (const [f, n] of top) console.log(`  ${String(n).padStart(4)}  ${f}`);
console.log(`报告：${reportFile}`);
