# Thinking Canvas Studio

轻量桌面代码编辑器 + 语言无关的图形化调试器。代码在 Monaco 里写，运行/单步时把变量、容器、引用、调用栈和变化投影到画布；同时保留独立的纯手绘画布。

当前是 **可运行的底座**：Monaco、React 桌面界面、共享画布、时间线、手绘模式、Python 本地宿主、WebSocket JSON-RPC 桥和脚本化 DAP 会话已经打通。**没有执行用户代码**；脚本化适配器只产生预设数据。真实 debugpy / GDB / JS / Java 适配器尚未接入。

![运行时画布](docs/screenshots/studio-debug.png)

## 快速运行

```powershell
npm install
npm run dev                 # 浏览器演示：http://127.0.0.1:5173/
npm run build
python desktop/app.py       # pywebview 窗口，加载 frontend/dist
python desktop/app.py --dev # 窗口加载 Vite 开发服务器
python desktop/app.py --smoke
```

桌面壳需要 `desktop/requirements.txt` 中的 `pywebview` 与 `websockets`；浏览器演示不需要 Python。首次运行会在 `workspace/` 生成演示工作区（已忽略）。

## 验证

```powershell
npm run typecheck
npm test                    # 19 项核心逻辑测试
npm run test:python         # 46 项宿主测试
npm run build
```

## 目录

```text
frontend/
  src/                      React 壳、Monaco、画布、面板、时间线、宿主客户端
  core/                     纯 TS：调试模型、场景投影、卡片、差异、快照
  tests/                    Node 原生测试
desktop/
  app.py                    pywebview 入口、静态服务器、桥接信息
  studio_host/              WS JSON-RPC 桥、工作区、DAP 会话、脚本化适配器、授权策略
languages/                  语言包 manifest（Python / C++ / TS-JS / Java）
docs/                       产品、架构、数据、契约、spike、进度、交接
```

## 产品边界

- **编辑时不会知道运行时内存**。变量、容器和内存结构只在启动/停点后采集；不把静态推测冒充实测。
- **DAP 给的是变量树与临时句柄，不是完整内存图**。画布只投影结构化值；标量留在变量表。
- **连续运行只保留已采集的暂停快照**。没有逐步事件时明确标记 gap，不插值伪造中间状态。
- **手绘画布与调试快照是两套事实**。它们共享 Scene/Card 渲染器和文件管理，但不会互相覆盖。
- **真实执行默认拒绝**。没有受信 supervisor 与显式授权，不启动目标进程。脚本化会话在界面上标记为“脚本演示”。

## 下一步

1. 用真实 `debugpy` 打通 Python 断点/单步/变量/调用栈，并接入受信 supervisor（超时、进程树回收）。
2. 兼容 GDB（C/C++）、js-debug（TS/JS）、java-debug（Java），每种语言单独验收。
3. 接入 LSP 时先测 `monaco-languageclient` 体积与取消/版本行为。
4. 真实窗口验收：中文 IME、DPI、快捷键焦点、WebView2 崩溃恢复。

## 旧项目

`E:\算法思考工具` 是上一代产品，只作为视觉、卡片和时间线的只读参考。它不是本仓库的代码基座；本仓库按新目标独立实现。旧项目不修改、不迁移。

MIT，见 [LICENSE](LICENSE)；依赖与来源见 [docs/third-party-licenses.md](docs/third-party-licenses.md)。