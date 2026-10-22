# Phase 1 技术 spike 计划

状态：待批准开展真实集成。2026-10-23 本轮只做源码研究、版本盘点和底座自测。以下性能指标是**拟议验收门槛**，不是测量结果。没有执行用户算法、调试 fixture 或训练。

## Phase 0 审查后的目标

先证明：Monaco 在目标桌面壳可靠；DAP 状态与画布事实一致；暂停句柄/异步回包不污染新状态；进程可强制回收。每个 spike 是小型可删除实验，不铺完整产品功能。

| 实验 | 最小工作与 fixture | 必须保存的证据 | 通过 / 失败门槛 |
|---|---|---|---|
| S1 Monaco / pywebview | WebView2 本地 HTTP，正确 worker；Python/TS/C++ 编辑模型，中文 IME、选区、搜索、撤销、保存、主题；编辑器与画布焦点快捷键分离 | 版本/机器配置、启动与 worker 日志、100%/125%/150% 缩放截图、按键冲突表 | 不使用 CDN/file://；20 次冷启无白屏；Ctrl+S/F/Z/Y 与画布单字母键焦点正确；中文组合输入不丢；无 worker 错误 |
| S1b 性能/壳 | 合成 1 MiB/1万行与 10 MiB/10万行文本；10次往返切模型与窗口 resize | 冷启中位与95百分位、输入到绘制、模型打开时间、进程树 private bytes | 普通样本冷启目标≤3s、键入95百分位≤50ms；10MiB打开≤5s/可取消；持续操作不出现>500ms冻结；空壳峰值目标≤350MiB，超过则解释并比较候选 |
| S2 本地桥 | loopback WS + JSON-RPC；host↔adapter DAP codec；测试 split/coalesced/UTF-8/乱序response/timeout/cancel/断线 | 消息轨迹、鉴权负例、进程/队列/内存计量 | 未授权 Origin/token 不能调方法；消息大小/并发队列有界；请求晚回不污染状态；应用退出后无残留进程 |
| S3 debugpy | 获准运行自含 fixture：局部标量、list/dict、嵌套函数、两个变量引用同一list、循环引用、异常 | 完整 initialize→launch→initialized→配置→stopped 流、capabilities、断点位置、stack/scopes/variables、继续后失效测试 | 断点准确；step over/in/out与栈一致；全停/未知暂停区分；每停点按预算读值；终止可清理；不把显示字符串当原生内存 |
| S4 GDB | 对已有 Windows GDB 17.2 先验证 Python模块和DAP运行；C fixture 用 -g -O0，局部数组、struct、指针、null、共享指针；WSL独立实验 | GDB build/config、编译器/目标架构、DAP capability、数组期望值、readMemory字节/端序/不可读范围 | Windows/WSL分别报告；readMemory 必须capability true；已知数组字节与源码/调试器核对；无效地址正确报错；没有Python/DAP的构建判该路径失败 |
| S5 LSP/包体 | Monaco-only 对比 monaco-languageclient classic；一个 Python LSP 接 diagnostics/completion/hover/definition，测试取消/旧文档版本 | lockfile、bundle分析、依赖许可证、启动/诊断耗时、source URI映射 | 无整包workbench/extension host；仅必要compat服务；代码版本过期诊断丢弃；classic增量包体超过拟议10MiB压缩需复核，不静默接受 |
| S6 JS/TS、Java | JS Node fixture + TS source maps；Java小类/对象/数组，JDT LS + java-debug单独验证 | 各语言启动配置、版本、断点/步进/栈、运行时需求、EPL notices | 四语言各自有通过记录；TS映射回原源码；Java工具JDK与项目JDK要求分开；不能用Python成功代替 |
| S7 采集→Scene | 固定断点序列投影list/dict/struct/指针/递归帧；含100万元素只读分页、共享/cyclic graph、截断、编辑源码后再运行 | snapshot fixtures、coverage/diff、预算/延迟、布局稳定截图 | 渲染最多500结构节点；同停点采集目标≤200ms（不含目标执行和首次启动）；禁止完整读取巨大容器；无伪别名/伪删除，重排/单步不跳布局 |
| S8 数据与隔离 | 手绘板保存/载入，trace只读，调试快照复制为手绘，新旧schema导入 | 原子保存失败注入、损坏文件、恢复步骤、旧文件哈希 | 坏数据不覆盖当前；旧boards不改；查看历史不向运行进程查询；有界记录，预算命中标gap |
| S9 强制进程监管 | Windows Job Object（退出kill整个tree、内存/process caps、累计CPU与wall timer）；WSL/Linux cgroup/rlimit按环境另验 | 无限循环/内存增长/派生子进程fixture的回收日志、内核限制证据 | 未授权拒绝；批准才启动；超限及时结束进程树；fake supervisor不计通过；无实现就拒绝执行 |

资源 fixture 是新写的受控测试程序，也必须在具体运行参数/限额已确认后才执行。本轮并未请求此批准，未运行它们。

## 先后顺序与停止条件

1. S1/S1b：确认壳和编辑体验；失败先定位，再比较Electron/Tauri成本，不能直接扩大产品实现。
2. S2+S9：确认本地连接与真实进程监管；在这之前只允许静态编辑和协议模拟。
3. S3：Python垂直调试路径；拿到真实capabilities和暂停快照。
4. S4/S7：C内存与跨语言画布边界，确定实际可用对象身份和分页规则。
5. S5/S6/S8：语言服务、剩余语言、持久化/旧画布导入。
6. Phase 1 报告：逐项通过/失败/未执行，选择稳定组合与锁定版本；用户批准后进入产品 MVP。

## 实验记录模板

每个实验目录记录：目的、commit/工具版本、OS/CPU/RAM/WebView2/GPU、输入fixture及hash、运行批准范围、执行命令、测量方法、原始日志/截图路径、预期与实际、结论、失败后下一步。不要只放“通过”截图或 HTTP 200。

## 当前机器盘点（不是功能验收）

- Node.js 24.12.0；npm 11.6.2；Python 3.11.4。
- 当前 Python 环境 metadata：debugpy 1.6.7、pywebview 6.2.1、NumPy 1.24.3；未发现 torch 包。未导入/运行这些工具做调试。
- 原生 GDB 17.2，target x86_64-w64-mingw32，--configuration 显示 --with-python 构建配置。仍需验证运行时 Python库和DAP可正常启动；版本/配置不能替代实验。
- WebView2 真实 Monaco 工作负载未测。旧exe能运行的历史记录不等于新编辑器壳通过。

## 交给下一模型的任务描述

> 在 Thinking Canvas Studio 新仓库实施 S1/S1b，仅构建 Monaco + pywebview 的本地编辑 spike。先读 docs/architecture.md、docs/legacy-visual-contract.md 和本文件。使用 Luna 实现，保留 tokens、IME 和快捷键焦点边界；不要执行用户源码，不接真实调试器。保存截图与性能测量原始结果，更新 docs/实时进度.md；每个新目录加 description.md/backlog.md。通过后报告可用版本组合和剩余限制，不自行进入完整产品。
