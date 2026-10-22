# Thinking Canvas Studio

轻量桌面编辑器与调试画布的 **clean-room 底座**。当前不是可运行的 IDE，也没有连接真实调试器。

本仓库于 2026-10-23 从零建立。旧版 Thinking Canvas v0.3.9 保留在 `E:\算法思考工具`，代码、画板、exe 与 Git 历史均不迁移进新源码。它只作为视觉和手绘交互参考。

## 从这里开始

1. [审查结论与架构](docs/architecture.md)：为什么不用复制整个 VSCode workbench，哪些边界已经确定。
2. [VSCode 调试 UX 契约](docs/vscode-debug-contract.md)：组件、数据、DAP、能力与分期。
3. [Phase 1 与 spike 计划](docs/spike-plan.md)：下一步要验证什么，什么算通过。
4. [实时进度](docs/实时进度.md)：已实现底座、未实现产品，分别记录。
5. [给下一位实现者](docs/handoff.md)：模块所有权、依赖方向、首个任务。

## 验证底座

需要 Node.js 24.12+、npm 和 Python 3.11+。这里只跑本仓库自己的测试，不执行工作区用户程序。

```powershell
cd E:\Thinking-Canvas-Studio
npm ci --ignore-scripts
npm run typecheck
npm test
python -m unittest discover -s desktop/studio_host/tests -t desktop -v
```

具体脚本名以 package.json 为准。首次安装开发依赖需要网络；产品的编辑/调试目标是离线本地运行。语言工具仅在用户明确安装时下载。

## 当前范围

- TypeScript：调试状态、请求过期保护、视图状态、画布投影和持久文档的最小契约。
- Python：本地服务端口、默认拒绝的执行策略、DAP 字节帧、JSON-RPC 边界。
- 设计：沿用暖纸色、蓝色强调、白色卡片、右侧检查器、底部时间线。
- 文档：源码索引、组件与协议契约、技术决策、spike、许可和接手顺序。

**尚未实现** Monaco 窗口、WebSocket 服务、DAP 会话驱动、真实语言调试、进程资源监管、文件持久化、画布渲染或动画。类型检查和单元测试不代表这些能力通过验收。

产品与语言包按 [产品需求](docs/产品需求.md) 分阶段交付。不得把模拟数据演示标成实时调试。

MIT；参考与依赖分别见 [许可清单](docs/third-party-licenses.md)。
