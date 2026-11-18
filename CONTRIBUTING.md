# 参与翻译

感谢帮忙！这个仓库只做一件事：把 omp 的界面文案翻成简体中文。**翻译集中在 `dict/` 的 JSON 里，不改源码**，所以多人可以并行，互不冲突。

## 1. 先认领文件（避免撞车）

按文件分工，一次只改一个文件，在 PR 标题里写清楚，例如：

```
dict: 完成 settings-model.json 剩余 27 条
```

推荐分工：

| 文件 | 内容 | 备注 |
| --- | --- | --- |
| `dict/zh-settings-model.json` | 模型/推理/切换相关设置 | 术语多，建议先读术语表 |
| `dict/zh-settings-providers.json` | 提供商相关设置 | 涉及大量专有名词，保留英文 |
| `dict/zh-settings-tools.json` | 工具开关与说明 | |
| `dict/zh-settings-tasks.json` | 任务/子代理 | |
| `dict/zh-settings-interaction.json` | 交互/快捷键/启动 | |
| `dict/zh-settings-appearance.json` | 外观/主题/状态栏 | |
| `dict/zh-settings-context.json` | 上下文/压缩 | |
| `dict/zh-settings-memory.json` | 记忆 | |
| `dict/zh-settings-files.json` | 文件相关 | |
| `dict/zh-settings-shell.json` | Shell 相关 | 少，适合新手 |
| `dict/zh-cli.json` | CLI 参数说明 | 量大，可分批 |
| `dict/zh-commands.json` | 斜杠命令说明 | |
| `dict/zh-ui.json` | TUI 通用文案 | 量大 |
| `dict/zh-hotkeys.json` | 快捷键名称 | |
| `dict/zh-tips.json` | 启动小贴士 | |
| `dict/zh-runtime.json` | 运行时提示 | 最少 |

`todo/missing-settings.csv` 是自动生成的缺口清单，可以按 `file` 列筛选出自己那份。

## 2. 改什么、不改什么

**要翻**：设置项的 `label` / `description`、选项名、命令说明、帮助文本、错误提示、状态栏文案。

**不要翻**（翻了会坏）：

- 配置键、设置 id（如 `startup.checkUpdate`）
- 工具名、命令名、`--flag`
- 模型名 / 提供商 id（`deepseek-v4.1-flash`、`openai`）
- 枚举值字面量（`off` / `low` / `high`、`auto`）
- 路径、URL、环境变量名（`OMP_LLM_API_KEY`）
- 代码片段、`<tag>`、`{placeholder}`

**必须原样保留的占位符**：`{0}`、`{name}`、`%s`、`${VAR}`、反引号里的代码、`<img>` 这类标签。

## 3. 风格约定

- 用**简体中文**，句末不加句号（设置说明很短时），长句用中文标点。
- 中英文之间加空格：`使用 API Key`，不是 `使用API Key`。
- 术语统一见 [glossary.md](glossary.md)；新术语先加进术语表再翻。
- 语气用“你”，不用“您”；避免“请”，直接说做什么。
- 中文长度尽量 ≤ 原文的 60%（TUI 有宽度限制），必要时意译。
- 保留原文里的强调/换行。

## 4. 提交前自检

```bash
node scripts/validate.mjs
node scripts/coverage.mjs
```

- `validate` 必须 0 错误（JSON 合法、值非空、含中文、占位符完整）
- `coverage` 会打印当前覆盖率；CI 不允许低于基线

## 5. PR 规范

- 一个 PR 只改一个文件（或同一域的几个），便于 review
- 标题：`dict: <文件> +N 条`
- 描述里贴 `validate` 输出
- 不要顺手格式化整个 JSON（会产生巨大 diff）；只改值，保持键顺序

## 6. 需要讨论的

术语拿不准、或发现原文本身有问题（英文歧义、疑似 bug），开 Issue 打 `question` / `upstream` 标签，不要卡在 PR 里。
