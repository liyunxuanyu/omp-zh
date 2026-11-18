#!/usr/bin/env node
// 按“英文 -> 中文”映射替换上游源码里的界面字符串字面量。
// 只替换完整、可读的文案，跳过路径/URL/标识符/含插值的模板串。
//
// 用法：
//   node scripts/apply.mjs --upstream /path/to/omp-checkout [--map dist/en-zh.json] [--dry-run]
//
// 建议在上游是一个干净的 git checkout，改完可用 git checkout -- . 回滚。
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
const mapFile = path.resolve(cwd, getArg("--map", "dist/en-zh.json"));
const map = JSON.parse(fs.readFileSync(mapFile, "utf8"));
const reportFile = path.resolve(cwd, getArg("--report", "dist/apply-report.json"));

const roots = ["packages/coding-agent/src", "packages/tui/src", "packages/stats/src"];
const exts = new Set([".ts", ".tsx", ".js", ".mjs"]);
const SKIP_PREFIX = /^(https?:|\/|\.\.?\/|--|[a-z0-9_.-]+$)/i;

// 双引号 / 单引号 / 无插值反引号
const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\]){4,400})\1/g;

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

const report = { files: 0, replaced: 0, byFile: {}, missing: [] };
const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : exts.has(path.extname(d.name)) ? [p] : [];
  });
};

for (const root of roots) {
  for (const file of walk(path.join(upstream, root))) {
    let src = fs.readFileSync(file, "utf8");
    let count = 0;
    const next = src.replace(LITERAL, (whole, quote, text) => {
      const zh = translatable(text);
      if (!zh) return whole;
      count++;
      return JSON.stringify(zh);
    });
    if (count > 0) {
      report.files++;
      report.replaced += count;
      report.byFile[path.relative(upstream, file)] = count;
      if (!dryRun) fs.writeFileSync(file, next, "utf8");
    }
  }
}

fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, JSON.stringify(report, null, 1), "utf8");
const top = Object.entries(report.byFile)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12);
console.log(`替换 ${report.replaced} 处，涉及 ${report.files} 个文件${dryRun ? "（dry-run，未写盘）" : ""}`);
for (const [f, n] of top) console.log(`  ${String(n).padStart(4)}  ${f}`);
console.log(`报告：${reportFile}`);
