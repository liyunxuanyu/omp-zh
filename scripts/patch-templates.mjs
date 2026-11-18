#!/usr/bin/env node
// 为“多行/带插值的模板串描述”生成源码补丁：保留 ${...} 表达式，只翻译静态片段。
// 用法：node scripts/patch-templates.mjs --id-list /tmp/eng-desc.json --upstream /tmp/omp-full
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.indexOf(n) > -1 ? argv[argv.indexOf(n) + 1] : d);
const upstream = arg("--upstream", "/tmp/omp-full");
const listFile = arg("--id-list");
const outFile = arg("--out", "patches/descriptions.json");
const API = process.env.OMP_TRANSLATE_BASE_URL ?? "https://cn.ai-pixel.online/v1";
const KEY = process.env.OMP_TRANSLATE_API_KEY;
const MODEL = process.env.OMP_TRANSLATE_MODEL ?? "deepseek-v4.1-flash";

const items = JSON.parse(fs.readFileSync(listFile, "utf8")); // [{id, description}]
const roots = ["packages/coding-agent/src", "packages/tui/src", "packages/stats/src"];
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
};
for (const r of roots) {
  const p = path.join(upstream, r);
  if (fs.existsSync(p)) walk(p);
}

/** 从 start 处的反引号解析模板串，返回 {raw, segs, exprs} */
function parseTemplate(src, tickAt) {
  let i = tickAt + 1;
  const segs = [];
  const exprs = [];
  let cur = "";
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { cur += src.slice(i, i + 2); i += 2; continue; }
    if (c === "`") { segs.push(cur); return { raw: src.slice(tickAt, i + 1), segs, exprs }; }
    if (c === "$" && src[i + 1] === "{") {
      let depth = 1, j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      segs.push(cur); cur = "";
      exprs.push(src.slice(i, j));
      i = j;
      continue;
    }
    cur += c; i++;
  }
  return null;
}

async function translate(text) {
  const body = {
    model: MODEL, temperature: 0, max_tokens: 2000,
    messages: [
      { role: "system", content: "把英文界面说明翻成简体中文。保留 [[0]] [[1]] 这类占位标记、反引号代码、\\n 转义和特殊符号（⎋ ⇥ → ↑ ↓）。术语：provider=提供商; session=会话; subagent=子代理; compaction=压缩; turn=轮次; approval=审批; effort=强度; plan mode=计划模式。只输出译文。" },
      { role: "user", content: text },
    ],
  };
  const res = await fetch(API.replace(/\/$/, "") + "/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return (d.choices?.[0]?.message?.content ?? "").trim();
}

const patches = [];
for (const { id, description } of items) {
  let hit = null;
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    // 用描述里最长的静态前缀定位（去掉可能的动态开头）
    for (const probeLen of [40, 28, 18, 10]) {
      const probe = description.slice(0, probeLen);
      if (probe.trim().length < 8) continue;
      const at = src.indexOf(probe);
      if (at < 0) continue;
      const tick = src.lastIndexOf("`", at);
      if (tick < 0) continue;
      const t = parseTemplate(src, tick);
      if (!t) continue;
      if (!t.segs.some((s) => s.includes(probe.slice(0, 10)))) continue;
      hit = { file: path.relative(upstream, f), ...t };
      break;
    }
    if (hit) break;
  }
  if (!hit) { console.error(`跳过（未定位）：${id}`); continue; }

  // 掩码静态片段
  let masked = "";
  hit.segs.forEach((s, i) => { masked += s.replace(/\\n/g, "\\n") + (i < hit.exprs.length ? `[[${i}]]` : ""); });
  const zh = await translate(masked);
  const parts = zh.split(/\[\[(\d+)\]\]/);
  const newSegs = [];
  for (let i = 0; i < parts.length; i += 2) newSegs.push(parts[i]);
  if (newSegs.length !== hit.segs.length) {
    console.error(`片段数不一致，跳过：${id} (${newSegs.length} vs ${hit.segs.length})`);
    continue;
  }
  let rebuilt = "`";
  newSegs.forEach((s, i) => { rebuilt += s + (i < hit.exprs.length ? hit.exprs[i] : ""); });
  rebuilt += "`";
  patches.push({ id, file: hit.file, old: hit.raw, new: rebuilt });
  console.log(`OK ${id} -> ${hit.file}`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(patches, null, 1), "utf8");
console.log(`写入 ${outFile}（${patches.length} 条）`);
