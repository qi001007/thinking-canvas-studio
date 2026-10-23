# 参考源码与依赖许可清单

核对日期：2026-10-23。本表是当前直接依赖与已纳入资产，不是完整传递依赖 SBOM；发布前要按锁定版本逐项保留 LICENSE/NOTICE。

## 已纳入

| 内容 | 版本/来源 | 许可 | 处理 |
|---|---|---|---|
| 本仓库核心、UI、宿主、测试、文档 | 本仓库 | MIT | 根 LICENSE |
| React / React DOM | 19.3.1 | MIT | 运行时依赖；保留声明 |
| Vite | 7.3.7 | MIT | 构建依赖 |
| @vitejs/plugin-react | 5.2.0 | MIT | 构建依赖 |
| Monaco Editor | 0.57.0 | MIT | 编辑器；主包约 3.0 MB；worker/语言包另计 |
| DOMPurify（Monaco 传递依赖，override） | 3.4.17 | MPL-2.0 OR Apache-2.0 | 通过 npm overrides 修正安全版本；发布前复核 |
| TypeScript | 5.9.3 | Apache-2.0 | 开发依赖 |
| pywebview | 6.2.1 | BSD-3-Clause | 桌面壳 |
| websockets | 17.1 | BSD-3-Clause | 本地桥 |
| legacy tokens.css | `E:\算法思考工具` v0.3.9，a1880ad... | MIT | 保留来源注释；只沿用颜色/尺寸/字体族 |
| legacy brand.png / app.ico | 同上 | MIT | 品牌视觉；与旧项目同源，发布前确认品牌归属 |
| VSCode 源码 | 固定 `c024bfb636e6db359ca29775b88c819866c84863` | MIT | 只读参考与契约重述；未复制 workbench 实现 |

“clean-room”在本项目表示独立仓库、独立实现；研究者读过 VSCode 源码，并非法律意义上的双团队隔离认证。

## 待接入

| 项目 | 许可 | 注意 |
|---|---|---|
| debugpy | MIT | 另核 vendored pydevd 等第三方声明 |
| GDB | GPL-3.0-or-later（具体分发需检查例外/附带文件） | 用户提供或按需安装的外部程序；不抄 GDB/GPL 界面实现到 MIT 本体 |
| vscode-js-debug | MIT | 独立 DAP 入口；传递依赖单独核验 |
| java-debug | EPL-1.0 | 外置；不得当 MIT 源码并入 |
| Eclipse JDT LS | EPL-2.0 | 外置；工具 JDK 与项目 JDK 分开记录 |
| monaco-languageclient | MIT | classic 仍带 @codingame VSCode API 兼容层；测体积与 notices |
| WebView2 Runtime | Microsoft 分发条款 | 优先使用已安装 Runtime |
| Python/Node/JDK/编译器 | 各发行版 | 按需安装、分别留版本/来源/许可；不把全部 runtime 打进 exe |
| 字体 | 按实际字体包核验 | 当前只写 CSS 字体族名，不随包分发字体文件 |

## 发布门槛

1. 从锁文件/构建产物生成 SBOM，列出直接与传递依赖。
2. 保留 LICENSE/NOTICE、版权与所需源代码提供信息。
3. 确认没有 VSCode 商标资产、Marketplace 限制内容或未授权字体进入包。
4. 对 GDB/EPL 语言包与 exe 分发结构做专项审核后再发布。
5. 不把“Monaco 是 MIT”推成整个桌面包都是 MIT；GDB/Java 外置依赖单独说明。