#!/usr/bin/env node
// 校验 dict/ 下的翻译字典：JSON 合法、值非空、含中文、占位符不被破坏。
// 用法：node scripts/validate.mjs [--strict]
import fs from "node:fs";
import path from "node:path";

const strict = process.argv.includes("--strict");
const dictDir = path.join(process.cwd(), "dict");
const CJK = /[\u4e00-\u9fff]/;
const PLACEHOLDER = /\{\d+\}|\{[a-zA-Z_][\w.]*\}|%[sd]|\$\{[^}]+\}|\$[A-Z][A-Z0-9_]*/g;

const errors = [];
const warnings = [];
let total = 0;

const listJson = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        return d.isDirectory() ? listJson(p) : d.name.endsWith(".json") ? [p] : [];
      })
    : [];
const files = listJson(dictDir).sort();
if (files.length === 0) {
  errors.push("dict/ 下没有 JSON 文件");
}

for (const file of files) {
  const full = path.isAbsolute(file) ? file : path.join(dictDir, file);
  const label = path.relative(dictDir, full);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (e) {
    errors.push(`${file}: JSON 解析失败 — ${e.message}`);
    continue;
  }
  if (Array.isArray(data) || typeof data !== "object" || data === null) {
    errors.push(`${file}: 顶层必须是对象`);
    continue;
  }
  for (const [key, value] of Object.entries(data)) {
    // meta / _comment 这类元数据允许非字符串
    if (key === "meta" || key.startsWith("_")) continue;
    total++;
    if (typeof value !== "string") {
      errors.push(`${file}: ${key} 的值不是字符串`);
      continue;
    }
    if (!value.trim()) {
      errors.push(`${file}: ${key} 是空字符串`);
      continue;
    }
    if (!CJK.test(value) && !/^[a-z0-9_.\-\/]+$/i.test(value) && value.length < 80) {
      warnings.push(`${file}: ${key} 不含中文：${JSON.stringify(value.slice(0, 40))}`);
    }
    const open = (value.match(/\{/g) ?? []).length;
    const close = (value.match(/\}/g) ?? []).length;
    if (open !== close) {
      warnings.push(`${file}: ${key} 花括号可能不配对（{ ${open} / } ${close}）`);
    }
  }
}

console.log(`检查 ${files.length} 个文件，${total} 条词条`);
for (const w of warnings.slice(0, 30)) console.log(`  [warn] ${w}`);
if (warnings.length > 30) console.log(`  … 另有 ${warnings.length - 30} 条警告`);
for (const e of errors) console.log(`  [error] ${e}`);

if (errors.length > 0 || (strict && warnings.length > 0)) {
  console.log(`\n失败：${errors.length} 个错误，${warnings.length} 个警告`);
  process.exit(1);
}
console.log(`\n通过：0 个错误，${warnings.length} 个警告`);
