# 参考源码与依赖许可清单

核对日期：2026-10-23。区分“已纳入代码”和“候选集成”，本表不是全部传递依赖的最终 SBOM。发布前要对最终锁定版本逐文件保留 LICENSE/NOTICE；安装来源不能只记 latest。

## 本轮实际纳入

| 内容 | 来源/许可 | 处理 |
|---|---|---|
| 新写的核心、host接口、文档/测试 | 本仓库 MIT | 根 LICENSE；尚未发布远端 |
| legacy tokens.css | qi001007/thinking-canvas，v0.3.9，a1880adba9b9676eb807e2ae9eae28a18094d2b3，MIT | 沿用颜色/尺寸/字体族；保留来源注释与原 Copyright；未复制旧JS应用 |
| TypeScript 5.9.3（仅开发依赖） | Apache-2.0，[官方LICENSE](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) | package-lock固定；node_modules不作为产品源码交付 |
| VSCode源码 | 固定c024bfb636e6db359ca29775b88c819866c84863，[MIT](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/LICENSE.txt) | 只读参考与契约重述，未复制workbench实现代码 |

“clean-room”在本项目表示独立仓库与独立实现；研究者直接读过源码，并非法律意义上严格隔离的双团队clean-room认证。

## 待 spike / 待集成

| 项目 | 官方主许可 | 计划与注意事项 |
|---|---|---|
| [Monaco Editor](https://github.com/microsoft/monaco-editor/blob/main/LICENSE.txt) | MIT | 编辑器；保留声明，锁定bundle里第三方资源 |
| [pywebview](https://github.com/r0x0r/pywebview/blob/master/LICENSE) | BSD-3-Clause | 桌面壳候选；不把与旧版本不同的依赖假定兼容 |
| [monaco-languageclient](https://github.com/TypeFox/monaco-languageclient/blob/main/packages/client/package.json) | MIT | classic仍依赖@codingame/monaco-vscode-*；最终锁文件逐项查license和notices |
| [debugpy](https://github.com/microsoft/debugpy/blob/main/LICENSE) | MIT | 另核vendored pydevd等第三方声明，不能只抄主许可 |
| [vscode-js-debug](https://github.com/microsoft/vscode-js-debug/blob/main/LICENSE) | MIT | 采用独立DAP入口；Node及传递依赖独立核验 |
| [java-debug](https://github.com/microsoft/java-debug/blob/main/LICENSE.txt) | EPL-1.0 | 外置Java调试包；不得当MIT源码并入本体 |
| [Eclipse JDT LS](https://github.com/eclipse-jdtls/eclipse.jdt.ls/blob/main/LICENSE) | EPL-2.0 | 语言服务及java-debug集成入口；工具JDK依赖单独记录 |
| [GDB](https://sourceware.org/gdb/) | GPL-3.0-or-later，具体分发需检查例外/附带文件 | 用户提供或按需安装的外部程序；不抄GDB/GPL界面实现到MIT本体 |
| WebView2 Runtime | Microsoft分发条款 | 优先使用已安装Runtime；若附安装器，按实际分发方案核验 |
| Python/Node/JDK/编译器与LSP | 各发行版不同 | 按需安装、分别留版本/来源/许可；“Java支持”不等于可重分发任意JDK |
| 字体 | 按实际字体包核验 | 当前只是CSS字体族名，不随包分发字体文件 |

Monaco、LSP、DAP三条依赖分别管理。不要从“Monaco是MIT”推出整个桌面包都是MIT。

用户明确指定 vscode-debug-visualizer、gdbgui 等 GPL 项目只参考交互；本轮未读取/复用其代码，因此没有它们的源码进入仓库。若将来研究，应先记录实际项目ref与license，继续执行禁止复制的约束。

进程通信本身不自动决定GPL是否对组合适用；发行结构、协议耦合与是否再分发都需按实际方案核验。[GNU官方FAQ关于独立程序](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation)。本轮不打包或分发GDB/Java工具。

## 发布门槛

1. 从锁文件/构建产物列出直接与传递依赖，生成SBOM。
2. 记录runtime安装源、版本、hash及用户确认；本地编辑/调试不需要云服务。
3. 保留对应LICENSE/NOTICE、第三方版权与所需源代码提供信息。
4. 确认没有VSCode商标资产、专有扩展/Marketplace限制内容或未经授权字体进入包。
5. 对GDB/EPL语言包与exe分发结构做专项审核后再发布。
