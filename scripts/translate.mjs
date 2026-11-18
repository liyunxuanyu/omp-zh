#!/usr/bin/env node
// 批量翻译 todo/untranslated.json 里的界面文案，结果写进
// dict/zh-strings-extra.json（键=英文原文），并同步 data/en/strings-extra.json。
//
// 需要环境变量（不要把 key 写进仓库）：
//   OMP_TRANSLATE_BASE_URL   默认 https://cn.ai-pixel.online/v1
//   OMP_TRANSLATE_API_KEY    必填
//   OMP_TRANSLATE_MODEL      默认 deepseek-v4.1-flash
//
// 用法：node scripts/translate.mjs [--limit 400] [--batch 40] [--min-count 1]
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.indexOf(n) > -1 ? Number(argv[argv.indexOf(n) + 1]) : d);
const LIMIT = arg("--limit", 200);
const BATCH = arg("--batch", 40);
const MIN_COUNT = arg("--min-count", 1);
const OFFSET = arg("--offset", 0);
const OUT = (() => {
  const i = argv.indexOf("--out");
  return i > -1 ? argv[i + 1] : "dict/zh-strings-extra.json";
})();

const BASE = process.env.OMP_TRANSLATE_BASE_URL ?? "https://cn.ai-pixel.online/v1";
const KEY = process.env.OMP_TRANSLATE_API_KEY;
const MODEL = process.env.OMP_TRANSLATE_MODEL ?? "deepseek-v4.1-flash";
if (!KEY) {
  console.error("缺少 OMP_TRANSLATE_API_KEY");
  process.exit(2);
}

const dictFile = path.resolve(cwd, OUT);
const dict = fs.existsSync(dictFile) ? JSON.parse(fs.readFileSync(dictFile, "utf8")) : {};

const todo = JSON.parse(fs.readFileSync(path.join(cwd, "todo", "untranslated.json"), "utf8"));
const queue = todo
  .filter((r) => r.count >= MIN_COUNT && !dict[r.en])
  .slice(OFFSET, OFFSET + LIMIT)
  .map((r) => r.en);

const GLOSSARY =
  "provider=提供商; session=会话; subagent=子代理; context window=上下文窗口; compaction=压缩; " +
  "turn=轮次; approval=审批; sandbox=沙箱; workspace=工作区; worktree=工作树; reasoning=推理; " +
  "effort=强度(枚举值保留英文); plan mode=计划模式; model role=模型角色; fallback=回退; retry=重试; " +
  "rate limit=限流; quota=配额; telemetry=遥测; prompt=提示词; attachment=附件; embed=内嵌; " +
  "render=渲染; stream=流式; commit=提交; branch=分支; checkpoints=检查点; LSP/MCP/OAuth/CLI/TUI/token 不译";

const system =
  "你是 oh-my-pi（一个终端 AI 编程 agent）的中文本地化译者。把英文界面文案翻成简体中文。\n" +
  "规则：术语统一（" + GLOSSARY + "）；保留占位符（{0} {name} %s %d、反引号代码、<tag>）；" +
  "不翻译命令名、参数、配置键、模型名、URL、路径、枚举值；中文简洁、不加句号、中英文之间加空格。" +
  "如果某条是代码/日志/无关内容，原样返回英文。";

async function translateBatch(items) {
  const payload = items.map((en, i) => ({ i, en }));
  const body = {
    model: MODEL,
    temperature: 0,
    max_tokens: 8000,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
          "逐条翻译，只输出 JSON 对象，键是序号字符串，值是中文：\n" + JSON.stringify(payload, null, 1),
      },
    ],
  };
  const res = await fetch(BASE.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  let text = (data.choices?.[0]?.message?.content ?? "").trim();
  if (text.startsWith("```")) text = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "");
  const obj = JSON.parse(text);
  const out = new Map();
  for (const [k, v] of Object.entries(obj)) {
    const idx = Number(k);
    if (Number.isInteger(idx) && items[idx] && typeof v === "string" && /[\u4e00-\u9fff]/.test(v)) {
      out.set(items[idx], v.trim());
    }
  }
  return out;
}

let done = 0;
for (let start = 0; start < queue.length; start += BATCH) {
  const chunk = queue.slice(start, start + BATCH);
  let got = new Map();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      got = await translateBatch(chunk);
      break;
    } catch (e) {
      console.error(`  批次 ${start / BATCH + 1} 第 ${attempt} 次失败: ${e.message}`);
      if (attempt === 3) break;
    }
  }
  for (const [en, zh] of got) {
    dict[en] = zh;
    done++;
  }
  fs.mkdirSync(path.dirname(dictFile), { recursive: true });
  fs.writeFileSync(dictFile, JSON.stringify(dict, null, 1), "utf8");
  console.log(`  批次 ${start / BATCH + 1}/${Math.ceil(queue.length / BATCH)}：+${got.size}（累计 ${done}）`);
}

console.log(`完成：本次新增 ${done} 条，字典共 ${Object.keys(dict).length} 条`);
