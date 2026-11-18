#!/usr/bin/env node
// 从上游源码里抽取“界面候选文案”，排除已经在映射里的，输出可翻译清单。
// 用法：node scripts/extract-untranslated.mjs --upstream /path/to/omp [--map dist/en-zh.json]
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const getArg = (n, d) => (argv.indexOf(n) > -1 ? argv[argv.indexOf(n) + 1] : d);
const upstream = getArg("--upstream");
if (!upstream || !fs.existsSync(upstream)) {
  console.error("用法: node scripts/extract-untranslated.mjs --upstream <checkout>");
  process.exit(2);
}
const cwd = process.cwd();
const map = JSON.parse(fs.readFileSync(path.resolve(cwd, getArg("--map", "dist/en-zh.json")), "utf8"));

// 只扫“界面相关”目录，避免把 schema/类型/SQL 当成文案
const roots = [
  "packages/tui/src",
  "packages/coding-agent/src/modes",
  "packages/coding-agent/src/commands",
  "packages/coding-agent/src/slash-commands",
  "packages/coding-agent/src/cli",
  "packages/coding-agent/src/config",
  "packages/stats/src/client",
];
const exts = new Set([".ts", ".tsx", ".js", ".mjs"]);

function scanStrings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      let j = i + 1;
      let sub = false;
      let closed = false;
      while (j < src.length) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (q === "`" && c === "$" && src[j + 1] === "{") sub = true;
        if (c === q) {
          closed = true;
          break;
        }
        if (c === "\n" && q !== "`") break;
        j++;
      }
      if (closed) {
        out.push({ raw: src.slice(i + 1, j), sub });
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

const SKIP = [
  /^(https?:|\/|\.\.?\/|--)/i,
  /^[\w./:\\-]+$/,
  /\$\{/,
  /=>|function\s|const\s|return\s|import\s|export\s/,
  /^[A-Z_0-9]{3,}$/,
  /[\\^$*+?[\]{}|]{3,}/, // 正则/模板密度高
  /^\s*$/,
  /\b(string|number|boolean|array|object|unknown)\b.*(>=|<=\|>|<)/i,
  /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|VALUES|WHERE)\b/,
  /\?\s*\)|\?\s*,|\?\s+WHERE/,
  /^[a-z]+\?$/,                 // 单个小写词 + ?，多为属性名
  /^[a-z]+(?:[A-Z][a-z]+)+$/,     // camelCase 标识符
  /^(accent|num|dim|mono|fg|bg|strong|muted)\b/i, // 主题 token
  /\bstring\b.*\|/i,
];

function candidate(text) {
  if (text.length < 6 || text.length > 300) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (!text.includes(" ") && !/[.!?:]$/.test(text)) return false;
  if (SKIP.some((re) => re.test(text))) return false;
  return true;
}

const stats = new Map(); // text -> { count, files:Set }
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : exts.has(path.extname(d.name)) ? [p] : [];
  });

for (const root of roots) {
  const base = path.join(upstream, root);
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    const src = fs.readFileSync(file, "utf8");
    for (const s of scanStrings(src)) {
      if (s.sub) continue;
      const text = s.raw.replace(/\\(["'`\\])/g, "$1");
      if (map[text]) continue;
      if (!candidate(text)) continue;
      const rec = stats.get(text) ?? { count: 0, files: new Set() };
      rec.count++;
      rec.files.add(path.relative(upstream, file));
      stats.set(text, rec);
    }
  }
}

const rows = [...stats.entries()]
  .map(([en, r]) => ({ en, count: r.count, files: [...r.files] }))
  .sort((a, b) => b.count - a.count || b.en.length - a.en.length);

fs.mkdirSync(path.resolve(cwd, "todo"), { recursive: true });
fs.writeFileSync(
  path.resolve(cwd, "todo/untranslated.json"),
  JSON.stringify(rows, null, 1),
  "utf8",
);
const esc = (s) => `"${s.replace(/"/g, '""')}"`;
const csv = ["en,count,file"]
  .concat(rows.map((r) => `${esc(r.en)},${r.count},${esc(r.files[0] ?? "")}`))
  .join("\n");
fs.writeFileSync(path.resolve(cwd, "todo/untranslated.csv"), csv, "utf8");

console.log(`候选未翻译文案：${rows.length} 条（出现 ${rows.reduce((n, r) => n + r.count, 0)} 次）`);
for (const r of rows.slice(0, 15)) console.log(`  ${String(r.count).padStart(3)}x ${r.en.slice(0, 90)}`);
