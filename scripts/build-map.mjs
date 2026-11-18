#!/usr/bin/env node
// 把 data/en/*.json（上游英文）与 dict/zh-*.json（中文）按 key 合并成
// “英文文本 -> 中文文本”的映射，供 build 时替换源码字符串字面量。
// 用法：node scripts/build-map.mjs [--out dist/en-zh.json]
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outArg = process.argv.indexOf("--out");
const outFile = path.resolve(cwd, outArg > -1 ? process.argv[outArg + 1] : "dist/en-zh.json");

const readDir = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .flatMap((f) => {
          try {
            return [JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))];
          } catch (e) {
            console.error(`跳过无法解析的 ${f}: ${e.message}`);
            return [];
          }
        })
    : [];

const en = Object.assign({}, ...readDir(path.join(cwd, "data/en")));
const zh = Object.assign({}, ...readDir(path.join(cwd, "dict")));

const votes = new Map(); // en -> Map(zh -> count)
let joined = 0;
for (const [key, enText] of Object.entries(en)) {
  if (typeof enText !== "string" || !enText.trim()) continue;
  const zhText = zh[key];
  if (typeof zhText !== "string" || !zhText.trim()) continue;
  joined++;
  if (!votes.has(enText)) votes.set(enText, new Map());
  const m = votes.get(enText);
  m.set(zhText, (m.get(zhText) ?? 0) + 1);
}

const map = {};
let conflicts = 0;
for (const [enText, m] of votes) {
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  map[enText] = sorted[0][0];
  if (sorted.length > 1) conflicts++;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(map, null, 1), "utf8");
console.log(`en 词条 ${Object.keys(en).length} / zh 词条 ${Object.keys(zh).length}`);
console.log(`配对成功 ${joined} 条 -> 唯一英文 ${Object.keys(map).length} 个（${conflicts} 个存在多译，取最高频）`);
console.log(`写出 ${outFile}`);
