# omp-zh · oh-my-pi 简体中文界面

把 [oh-my-pi](https://github.com/can1357/oh-my-pi)（`omp`）的界面文案翻成简体中文。
**翻译与构建分离**：`dict/` 里是纯 JSON 字典，`scripts/` 负责校验、覆盖率与（后续）打补丁构建。

## 现在到哪一步了

| 项 | 状态 |
| --- | --- |
| 目标上游版本 | **v18.22.2**（2026-11-18） |
| 翻译基线 | 复用 [feigo313/oh-my-pi-zh](https://github.com/feigo313/oh-my-pi-zh)（MIT，v18.20.2-zh）的 16 个字典，**5,516 条** |
| 设置项覆盖 | **350 / 399（87.7%）**（只算有界面文案的设置项） |
| 缺口 | **49 个设置项**，见 [todo/missing-settings.csv](todo/missing-settings.csv) |
| 可自动替换 | 4,655 条“英文→中文”，应用后覆盖 **4,860 处源码 / 454 个文件** |
| 构建 | ✅ GitHub Actions 交叉编译通过，产出 Windows exe |
| 运行时验证 | ✅ Linux 构建 `omp --help` 显示中文（1,661 个汉字） |
| 构建管线 | 规划中：`bun run build` + `CROSS_TARGET=win32-x64` 交叉编译 |
| 终端适配 | 见 [README 的“已知限制”](#已知限制) |

## 目录

```
dict/                 翻译字典（唯一需要人工维护的部分）
  zh-settings-*.json  按设置分域的 10 个文件
  zh-cli.json         CLI 参数说明
  zh-commands.json    斜杠命令说明
  zh-ui.json          TUI 通用文案
  zh-hotkeys.json     快捷键
  zh-tips.json        小贴士
  zh-runtime.json     运行时提示
data/upstream-settings.json   上游 18.22.2 的设置项快照（id + 英文原文）
todo/missing-settings.csv     缺口清单（自动生成）
scripts/validate.mjs          字典校验
scripts/coverage.mjs          覆盖率统计
coverage.md                   最新覆盖率报告（自动生成）
```

## 构建流程（脚本化）

```bash
node scripts/build-map.mjs                 # data/en + dict -> dist/en-zh.json（英文->中文）
node scripts/apply.mjs --upstream /path/to/omp   # 替换上游源码字符串字面量
cd /path/to/omp/packages/coding-agent
CROSS_TARGET=win32-x64 \
BUN_COMPILE_EXECUTABLE_PATH=/path/to/bun.exe \
  bun run build                              # 产出 dist/omp-win32-x64
```

说明：

- `apply.mjs` 只替换完整文案（含空格或句末标点、长度 ≥ 4），跳过路径/URL/标识符；
- 上游用干净的 git checkout，改完可 `git checkout -- .` 回滚；
- 交叉编译需要三样东西：Bun 本体、`@oh-my-pi/pi-natives-win32-x64` 的 `.node`、Windows 版 Bun 运行时（`BUN_COMPILE_EXECUTABLE_PATH` 可绕开下载）。

## 下载

| 资产 | 大小 | SHA256 |
| --- | --- | --- |
| [omp.exe](https://github.com/liyunxuanyu/omp-zh/releases/download/v18.22.2-zh/omp.exe) | 265,717,248 B | `3f27b613e983653b45ea1468b203182b7a9b9b871d32e7c389e2eb20191099dc` |

基于上游 **v18.22.2**，Windows x64 单文件。用法：替换 `D:\tools\omp\omp.exe`，或放进 PATH 后直接跑 `omp`。

> 这是第三方构建，没有官方签名；哈希见上，自行校验。

## 参与

读 [CONTRIBUTING.md](CONTRIBUTING.md)，认领一个 `dict/` 文件即可开工。术语见 [glossary.md](glossary.md)。

```bash
node scripts/validate.mjs   # 必须 0 错误
node scripts/coverage.mjs   # 看覆盖率变化
```

## 已知限制

- **不能直接用官方安装脚本**换来中文：中文要随二进制构建，`omp.sh/install` 装的是英文版。
- 输入框里的图片缩略图只在 kitty / ghostty / otty 渲染；Windows 上目前拿不到（omp 对 WezTerm 关闭了 Unicode placeholder）。
- 翻译不改配置键、工具名、模型 ID，只改展示文案。

## 许可与来源

- 上游 omp：MIT，版权归 Mario Zechner 与 Can Bölük。
- 本仓库字典：MIT；初始翻译来自 feigo313/oh-my-pi-zh（MIT），已保留来源说明。
- 本仓库不是官方项目，不代表上游。
