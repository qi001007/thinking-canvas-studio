# Thinking Canvas Studio

轻量桌面代码编辑器 + 语言无关的图形化调试器。代码在 Monaco 里写，运行/单步时把变量、容器、引用、调用栈和变化投影到画布；同时保留独立的纯手绘画布。

当前是 **可运行的桌面底座**：Monaco、React 界面、共享画布、时间线、手绘模式、Python 本地宿主、WebSocket JSON-RPC 桥，以及 **真实 debugpy + Windows Job Object** 的 Python 调试闭环。GDB（C/C++）、js-debug（TS/JS）、java-debug（Java）和 LSP 尚未接入。

![运行时画布](docs/screenshots/studio-debug.png)

## 快速运行

```powershell
npm install
npm run dev                 # 浏览器演示：http://127.0.0.1:5173/（脚本演示，不执行代码）
npm run build
python desktop/app.py       # pywebview 桌面窗口：可运行真实 Python
python desktop/app.py --dev # 桌面窗口加载 Vite 开发服务器
python desktop/app.py --smoke
```

桌面壳需要 `desktop/requirements.txt` 中的 `pywebview`、`websockets` 和宿主解释器里的 `debugpy`。首次运行会在 `workspace/` 生成演示工作区（已忽略）。

## 真实运行怎么走

1. 在桌面窗口打开 `main.py`（或工作区里的其他源码），在行号左侧设置断点。
2. 点“真实运行”。宿主弹出**原生确认框**，列出程序、工作区、解释器、断点、资源限额。
3. 点“是”后，host 签发单次 approval receipt，启动受 Job Object 限制的 debugpy；界面出现真实变量、调用栈、画布和时间线。
4. 继续/步过/步入/步出由 DAP 驱动；“停止”会结束调试进程树。
5. 没有原生确认、没有 supervisor、或文件在确认后又被改动，都不放行。

资源限额默认：600 秒墙钟 / 512 MB / 120 秒 CPU / 8 个进程。真实运行只在桌面窗口可用；浏览器预览固定使用脚本演示。

## 验证

```powershell
npm run typecheck
npm test                    # 19 项核心逻辑测试
npm run test:python         # 50 项宿主测试（含真实 debugpy + Job Object）
npm run build
```

## 目录

```text
frontend/
  src/                      React 壳、Monaco、画布、面板、时间线、宿主客户端
  core/                     纯 TS：调试模型、场景投影、卡片、差异、快照
  tests/                    Node 原生测试
desktop/
  app.py                    pywebview 入口、静态服务器、原生运行确认
  studio_host/              WS 桥、工作区、DAP 会话、debugpy、Job Object、脚本演示、授权策略
languages/                  语言包 manifest（Python 可用；其余未安装）
docs/                       产品、架构、数据、契约、spike、进度、交接、截图
```

## 产品边界

- **编辑时不会知道运行时内存**。变量、容器和内存结构只在启动/停点后采集；不把静态推测冒充实测。
- **DAP 给的是变量树与临时句柄，不是完整内存图**。画布只投影结构化值；标量留在变量表。
- **连续运行只保留已采集的暂停快照**。没有逐步事件时明确标记 gap，不插值伪造中间状态。
- **手绘画布与调试快照是两套事实**。它们共享 Scene/Card 渲染器和文件管理，但不会互相覆盖。
- **当前 Python 调试是真实执行**，仍不是完整沙箱：Job Object 限制的是进程资源，不是文件/网络权限；只运行你确认过的本机代码。

## 下一步

1. 真实窗口 IME/DPI/快捷键/崩溃恢复验收；当前是隐藏窗口 + 浏览器证据。
2. GDB（C/C++）数组/指针/内存；js-debug（TS/JS）；java-debug + JDT LS。每种语言单独验收。
3. LSP 接入前先测 `monaco-languageclient` 体积、取消、旧版本诊断丢弃。
4. 画布增强：更多容器/张量、别名证据、采集预算/coverage、trace 持久化、手绘完整笔迹/连线。

## 旧项目

`E:\算法思考工具` 是上一代产品，只作为视觉、卡片和时间线的只读参考。它不是本仓库的代码基座；本仓库按新目标独立实现。旧项目不修改、不迁移。

MIT，见 [LICENSE](LICENSE)；依赖与来源见 [docs/third-party-licenses.md](docs/third-party-licenses.md)。