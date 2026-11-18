#!/usr/bin/env node
// 把未翻译候选分成「可翻文案」和「技术字符串（CSS/类型/命令/路径）」两类，给出真实覆盖率。
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const todo = JSON.parse(fs.readFileSync(path.join(cwd, "todo/untranslated.json"), "utf8"));
const map = JSON.parse(fs.readFileSync(path.join(cwd, "dist/en-zh.json"), "utf8"));

const technical = (s) =>
  /^[\w-]+(?: [\w-]+){0,6}$/.test(s) && !/[A-Z]{2,}/.test(s) ||       // CSS 类名/小写词组
  /\b(Record|Promise|Array|Map|Set|string|number|boolean|unknown)\b\s*[<|]/.test(s) ||
  /^[<{(]/.test(s) ||
  /^(SELECT|INSERT|UPDATE|DELETE|CREATE)\b/i.test(s) ||
  /^\/[^\s]+\/[gimsuy]*$/.test(s) ||
  /\.(ts|tsx|js|json|md|png|svg|css)\b/.test(s) ||
  /^[a-z0-9_.-]+$/.test(s) ||
  /^(\s*[-–—]\s*)?\d+(\.\d+)?\s*%$/.test(s) ||
  /[\[\]{}=\\|<>"`\x1b]/.test(s) ||                                  // 代码/转义/JSON
  /^[#/+\-]/.test(s.trim()) ||                                        // 注释、diff、路径
  /\w+\(/.test(s) ||                                                   // 函数调用
  /\b(def|print|import|const|let|var|return|class|async)\b/.test(s) ||
  /^[a-z][a-zA-Z0-9]*\?$/.test(s) ||                                   // 属性名 xx?
  /^[a-z]+(?:[A-Z][a-z]+)+$/.test(s);

let actionable = 0, tech = 0, covered = 0;
const rows = [];
for (const r of todo) {
  if (map[r.en]) { covered++; continue; }
  if (technical(r.en)) { tech++; continue; }
  actionable++;
  rows.push(r);
}
const total = todo.length;
console.log(`候选 ${total}：已译 ${covered}（${(covered / total * 100).toFixed(1)}%），技术串 ${tech}，可翻未译 ${actionable}`);
fs.writeFileSync(path.join(cwd, "todo", "remaining-actionable.csv"),
  ["en,count,file"].concat(rows.map((r) => `"${r.en.replace(/"/g, '""')}",${r.count},"${r.files[0] ?? ""}"`)).join("\n") + "\n");
for (const r of rows.slice(0, 10)) console.log(`  ${r.en.slice(0, 80)}`);
