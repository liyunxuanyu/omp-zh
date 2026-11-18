#!/usr/bin/env node
// 计算设置项翻译覆盖率，并生成 coverage.md。
// 用法：node scripts/coverage.mjs [--check]
//   --check  : 覆盖率低于 BASELINE 时以非 0 退出（用于 CI 防回退）
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const dictDir = path.join(cwd, "dict");
const dataFile = path.join(cwd, "data", "upstream-settings.json");
const BASELINE = 65; // 当前基线覆盖率（%），只允许升不允许降

const upstream = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const dict = {};
for (const f of fs.readdirSync(dictDir).filter((f) => f.endsWith(".json"))) {
  Object.assign(dict, JSON.parse(fs.readFileSync(path.join(dictDir, f), "utf8")));
}

const covered = (id) => Object.keys(dict).some((k) => k.startsWith(`settings.${id}.`));
const byFile = new Map();
let coveredCount = 0;
for (const e of upstream) {
  const row = byFile.get(e.file) ?? { total: 0, covered: 0 };
  row.total++;
  if (covered(e.id)) {
    row.covered++;
    coveredCount++;
  }
  byFile.set(e.file, row);
}

const pct = upstream.length ? (coveredCount / upstream.length) * 100 : 0;
const lines = [
  "# 设置项翻译覆盖率",
  "",
  `生成时间：${new Date().toISOString()}`,
  "",
  `**总计：${coveredCount} / ${upstream.length} 个设置项（${pct.toFixed(1)}%）**`,
  "",
  "| 来源文件 | 已覆盖 | 总数 | 覆盖率 |",
  "| --- | --- | --- | --- |",
];
for (const [file, r] of [...byFile.entries()].sort((a, b) => b[1].total - a[1].total)) {
  lines.push(`| ${file} | ${r.covered} | ${r.total} | ${((r.covered / r.total) * 100).toFixed(0)}% |`);
}
lines.push("");
lines.push(`缺口 ${upstream.length - coveredCount} 项，见 todo/missing-settings.csv。`);
fs.writeFileSync(path.join(cwd, "coverage.md"), lines.join("\n") + "\n");

console.log(`设置项覆盖率：${coveredCount}/${upstream.length} = ${pct.toFixed(1)}%`);
for (const [file, r] of [...byFile.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8)) {
  console.log(`  ${file.padEnd(42)} ${r.covered}/${r.total}`);
}
if (process.argv.includes("--check") && pct < BASELINE) {
  console.error(`\n覆盖率 ${pct.toFixed(1)}% 低于基线 ${BASELINE}%`);
  process.exit(1);
}
