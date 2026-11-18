# 验收记录（v18.22.2-zh.6）

日期：2026-11-18　上游：`can1357/oh-my-pi` **v18.22.2**

## 产物

| 项 | 值 |
| --- | --- |
| 资产 | `omp.exe`（Windows x64 单文件） |
| 大小 | 265,821,696 B |
| SHA256 | `ab2f6f44ad2b9c3d2bf4968afbc3a3e6d2b933e7bc7a8e6a08495b2ebb318c8d13` |
| 构建 | GitHub Actions `build-windows-zh`，`CROSS_TARGET=win32-x64`，成功 |
| 来源提交 | 本仓库对应 tag `v18.22.2-zh.6` |

## 翻译覆盖

| 指标 | 结果 |
| --- | --- |
| 设置项（有界面文案） | **399 / 399** |
| 设置项运行时描述 | **471 / 471（100%）**（`omp config list --json` 实测） |
| 源码替换点 | **7,341 处 / 582 个文件** |
| `omp --help` 中文字数 | **1,893**（Linux 构建实测） |
| 未翻译候选 | 154 条，均为代码片段/堆栈/diff/JSON 片段，按规范不译 |

## 证据链

1. **编译**：Linux 构建 `bun run build` 退出码 0（应用 7,341 处替换 + 11 条模板补丁）。
2. **运行**：`omp --help` 输出中文（1,893 汉字）；`omp config list --json` 471 条描述全中文。
3. **Windows 产物**：CI 下载 win32 原生模块后交叉编译，二进制内 UTF-16LE 命中 `会话` 416 次、`提供商` 130 次、`子代理` 85 次。
4. **哈希**：发布资产 digest 与本地 `sha256sum` 一致。

## 未验证 / 限制

- 未在真实 Windows 上双击运行（无 Windows 主机）；Windows 侧只验证了 PE 产物与内嵌字符串。
- 输入框图片缩略图仍受终端限制（kitty/ghostty/otty 才有）。
- 多行模板串靠 `patches/descriptions.json` 定点补丁，上游若改写法需同步更新。
