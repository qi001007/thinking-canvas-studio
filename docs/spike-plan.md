# Phase 1 技术 spike 状态与计划

更新：2026-10-23。当前底座已跑通 Monaco + 共享画布 + 脚本化 DAP + WS 桥；Python 已接真实 debugpy + Windows Job Object，其余语言未接。

## 已完成（可交接的底座）

| 实验 | 状态 | 证据 | 还没证明的 |
|---|---|---|---|
| S1 Monaco / 浏览器壳 | 部分完成 | Vite + React + Monaco 在 1680×1050 无头 Edge 渲染；语法高亮、断点 gutter、当前行；隐藏窗口真实运行 | 中文 IME、DPI、快捷键焦点、WebView2 崩溃恢复 |
| S1b 性能/壳 | 未做 | 仅记录 Monaco 主包约 3.0 MB / gzip 约 0.8 MB | 冷启、键入延迟、10 MiB 文件、内存峰值 |
| S2 本地桥 | 完成（loopback） | WS JSON-RPC、token、Origin、allowlist、错误 token 关闭；56 项 Python 测试 | 真实 adapter 下的并发/超时/断线/进程回收 |
| S3 Python 调试 | **真实完成** | debugpy attach + 断点；停点/步过/locals/list；完整运行自动逐行记录 12 帧；Job Object 回收；集成测试通过 | 跨文件自动记录；大型循环采样；运行中改断点 |
| S7 采集→Scene | 部分完成 | DAP 变量树→`CardData`→Scene；容器/字典/栈帧；差异高亮；Python/TS-JS 静态图；总览/结构/数据三视图 + 聚焦 + 类成员网格 | 真实容器语义、别名证据、大容器分页、递归/超大类自动聚合、跨文件解析 |
| S8 数据/隔离 | 部分完成 | 工作区路径约束、boards 原子写、手绘/trace 分离、隐藏工作台 context | trace 持久化、坏文件恢复、legacy 导入 |
| S9 强制监管 | **Windows 完成** | Job Object 时间/内存/进程数 + wall timeout；真实 debugpy 测试 | Linux cgroup/rlimit；文件/网络隔离另立模型 |

## 下一步顺序

1. **S1 真窗口**：`python desktop/app.py` 加载 `frontend/dist`；测 IME、DPI、Ctrl+S、焦点、WebView2 崩溃恢复。隐藏窗口和真实运行已通过。
2. **扩展真实 Python 采集**：嵌套函数、共享引用、循环引用、异常、tensor/大容器；运行中更新断点；保存 DAP 流/清理证据。
3. **S7 静态图**：三视图/聚焦/节点上限已接；下一步跨文件符号解析、递归和超大类的自动聚合、可点击成员导航；C/C++/Java 接真实解析器。
4. **S4/S6/S5**：GDB、js-debug、java-debug、LSP 分别 spike；每种语言单独验收。TS/JS 静态图不等于 js-debug 调试。
5. **S8**：trace 文件、恢复、导入；手绘完整编辑能力按产品阶段补。

## 验收门槛

- 真实窗口：20 次冷启无白屏；中文组合输入不丢；Ctrl+S/F/Z/Y 与画布单字母键焦点正确。
- 真实 debugpy：断点准确；步过/步入/步出与栈一致；暂停句柄在继续后失效；终止清理进程树。
- 真实采集：不完整数据有 coverage；别名无证据不画；预算命中可解释。
- 桥：未授权 Origin/token 不能调方法；消息大小/并发有界；应用退出无残留进程。
- 执行：没有 supervisor 时拒绝；批准只绑定一个会话；配置/目标/预算变化重授。

## 记录模板

每个实验记录：目的、commit、OS/CPU/RAM/WebView2/版本、fixture 及 hash、批准范围、命令、测量方法、原始日志/截图、预期/实际、结论、失败后下一步。不要只放“通过”截图。

## 当前不承诺

- 不承诺“编辑时实时内存”——运行时数据只在停点后。
- 不承诺连续运行中的每次赋值——只保存已采集暂停快照。
- 不承诺四语言同时可用——逐个验收。
- 不承诺脚本化 DAP 等于真实调试。