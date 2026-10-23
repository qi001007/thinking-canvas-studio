# VSCode 调试 UX 与数据契约

本文记录 Thinking Canvas Studio 可借鉴的调试信息边界，不复制 VS Code 实现，也不把 DAP 的任意执行能力等同于安全的数据查看。VS Code 源码全部固定到提交 `c024bfb636e6db359ca29775b88c819866c84863`；下面每条源码链接都指向该 SHA。实现细节以所列文件为依据；不在所读文件内的行为明确标为“待查”。

状态：Phase 0 契约仍有效；Phase 1 已落地 React/Monaco UI、共享画布与脚本化 DAP 演示。真实 adapter 仍未接入；以下 MVP/后续仍是产品分期，不是完成声明。

## 组件契约矩阵（11 项）

| 组件 | 字段 / 显示数据 | 状态与命令 | 上下文条件 | 懒加载 / capability | 空态 | Studio MVP / 后续边界 |
|---|---|---|---|---|---|---|
| Call Stack | session、thread 名称/状态、frame 名称、source、行/列、选中 frame、stop reason。 | 选择 thread/frame；展开或折叠调用栈；查看源文件。| 无 session 时列表为空；焦点 session/thread 驱动显示；单 thread 时可压缩层级。 | 顶层 frame 先取，约 420ms 后再取剩余 frames；仅 stopped thread 可检查，运行或 stop epoch 改变会使旧 frame/handles 失效。 | 空列表；没有额外空态文案证据。 | MVP：线程、frame 名、位置、运行/暂停状态、选择 frame、源码跳转。后续：完整多线程层级、压缩层级、复杂焦点切换。来源：[callStackView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/callStackView.ts#L177-L204)、[debugModel.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/common/debugModel.ts#L617-L690)。 |
| Variables | scope 名称、expensive、variable name/value/type、evaluateName、variablesReference、named/indexed 数、子节点。 | 展开 scope/variable；设置变量属于写操作，MVP 不提供。 | 选中 stopped frame；scope 无 frame 时不可用；scope/variable 引用仅当前暂停有效。 | scopes/variables 请求在展开时获取；自动展开第一个非 expensive scope；分页每页100是 VS Code UI/client 策略，DA 是否 honor 由 `supportsVariablePaging` 决定。 | 无 frame 时无树内容；空 scope response 表示无 scopes。 | MVP：只读树、按展开拉子项、结构不完整标注。后续：分页策略、寄存器/复杂展示、编辑值。来源：[variablesView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/variablesView.ts#L92-L119)、[debugProtocol.d.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/common/debugProtocol.d.ts#L1160-L1220)。 |
| Watch | 用户表达式、当前结果、类型、错误/不可用表达式状态。 | 新增、编辑、删除、重排表达式；每项独立 evaluate；context menu 操作。 | Watch 总是挂在 debug service；evaluation 使用 `watch` context；结果随焦点 frame/session变化重算。 | 50ms 合并焦点变化；增添空表达式并缓存评估；每个表达式单独 evaluation。 | 没有表达式由 `watchExpressionsExist` context 标识；源码可确认逻辑状态，具体显示文案待查。 | MVP：用户明确添加的 Watch，纳入会话执行授权范围；按当前帧求值。未知 getter 不自动遍历；额外表达式改变授权范围时重授。来源：[watchExpressionsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts#L77-L82)、[watchExpressionsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/watchExpressionsView.ts#L262-L280)。 |
| Breakpoints | source URI/line/column、enabled、verified、message、condition、hit condition、log message；函数/数据/指令断点；异常过滤器。 | 增删、启停、编辑条件、删除全部、展开/折叠 source group；命中次数/异常过滤器数据。 | debug session capability 决定可设置的断点种类；源码断点按 URI 分组且可折叠；view hidden 时刷新延迟。 | 根据 debug model 的断点记录渲染；激活 view 时补刷新。每 session 分别同步断点。 | 没断点时树为空；专属文案未知。 | MVP：源码断点增删/启停、verified/实际位置、异常过滤。条件/命中条件/日志点按能力和授权逐项验收；函数/数据/指令断点后续。Studio拥有自己的调试会话，不附着用户IDE修改其断点。来源：[breakpointsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/breakpointsView.ts#L455-L585)。 |
| Debug Console / REPL | 按 session 分组的 `IReplElement`（输出、表达式、变量/对象子树）；输入框、筛选、历史（workspace 保存最多100条）、ANSI输出。 | Enter accept input；筛选、find、clear、collapse、paste、copy/copy all、session picker；completion 仅在 adapter 支持时注册。 | 当前 session 与 focused stack frame；多 session 有 session picker；inactive session clear 后可忽略。Filter 支持文本、`!exclude`、转义。 | 输出树惰性表达式展开时刷新；completion 取决 `supportsCompletionsRequest` 和 adapter trigger chars；高亮更新异步。 | 源文件未证实专属空态文案。 | MVP：有界 Console 输出、错误、过滤和明确受授权的 REPL 输入；输入可能执行目标代码。会话内已批准范围无需每步重复确认；扩展范围才重授。completion/多session后续。来源：[repl.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/repl.ts#L97-L180)、[repl.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/repl.ts#L470-L510)、[repl.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/repl.ts#L900-L980)。 |
| Debug Toolbar | session state、attach/no-debug、多 session、支持 reverse step、当前线程帧数、terminate/suspend capabilities。 | Continue/Pause、Stop/Disconnect、Step Over/Into/Out、Restart、Step Back/Reverse Continue、Focus Session。 | 按 `debugState`、attach、no-debug、多栈帧和 multi-session context 显示/禁用；工具栏位置可 dock / command center。 | 菜单/命令按 context key注册；session/pane visibility 和活动窗口变化时重新布局。 | inactive 时不显示 debug actions。 | MVP：Start/Continue/Pause/Stop、Step Over/In/Out、Restart；根据运行状态、焦点、能力和 pending 操作启停。reverse/高级停靠/多session后续。运行授权在host执行。来源：[debugToolBar.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/debugToolBar.ts#L430-L490)。 |
| Memory | session id、memoryReference、byte offset range、读写权限、内存字节；invalidate offset/count。 | VS Code 提供 read/write memory 虚拟文件系统接口；这个文件不是完整内存面板实现。 | 资源 URI 解析到 session 与 memory reference；`readOnly = !supportsWriteMemoryRequest`；session 不活跃时资源删除。 | region read 请求按需取值；offset view 为父 region 子区间；memory event 仅刷新引用/区间重叠的数据。 | 未找到专属空态或独立面板 UI；待查。 | MVP 只保存 runtime 返回的明确字节快照（如果适配器已有），不新增任意地址读写界面。后续要把 Memory 作为独立能力设计，并显示地址范围、不可读/不可写与不完整状态。来源：[debugMemory.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/debugMemory.ts#L17-L77)、[debugMemory.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/debugMemory.ts#L177-L270)。 |
| Disassembly | instruction reference、reference offset、instruction offset、DAP instruction、bigint address、source location、instruction breakpoint enabled/set。 | 定位 instruction/frame；上下滚动；指令行 context menu/断点；显示 source line grouping。 | 依赖 focused frame instructionPointerReference 和 adapter `disassemble`；source line显示由配置开关控制。 | table virtualization；每次边缘滚动约加载50条；先取 reference 基准单条；无法映射时补取基线。 | sentinel 文案“Disassembly not available.”；这是该实现中确认的明确空态。 | MVP 不反汇编。后续按 capability 专项实现，不以缺失反汇编误标“程序无代码”。来源：[disassemblyView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/disassemblyView.ts#L54-L87)、[disassemblyView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/disassemblyView.ts#L260-L295)、[disassemblyView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/disassemblyView.ts#L400-L490)。 |
| Exception Widget | exception id、description、details.stackTrace；编辑器位置和主题色；aria label。 | Copy exception info、Close；stack trace 内链接可打开 source/location。 | 有异常且编辑器可定位；异常 ID 可选；需异常信息 object；debug session 可选。 | 内容测量后重排，50ms debounce；非活动 editor 不触发 scroll reveal。 | 无 description/stackTrace 时相应区域不渲染；专属整体空态未知。 | MVP：异常原因、源码定位、可复制详情；exceptionInfo按能力。复杂编辑器zone widget后续。来源：[exceptionWidget.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/exceptionWidget.ts#L30-L124)、[exceptionWidget.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/exceptionWidget.ts#L142-L159)。 |
| Inline Values | provider 返回的 text、variable、expression；对应 range/列；在行内归并成 `name = value` text decoration。 | 无独立用户命令；配置 `debug.inlineValues` 为 true/on/auto；随 stack frame/editor viewport/context更新。 | model URI 必须与 focused stack frame source URI一致；auto 模式要求有 inline value provider。 | viewport 上下区域请求 provider；CancellationToken；按行列排序、去重、合并；debounce 延时会按 provider耗时更新；关闭时延迟清理 decoration。 | 配置不启用、provider 不存在、model/frame不匹配或结果空时不显示行内值；没有单独空态文案。 | MVP 不请求 expression provider，也不把文字装饰当完整变量快照。后续有必要时仅显示安全、已取回的变量值。来源：[debugEditorContribution.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/debugEditorContribution.ts#L760-L875)。 |
| Loaded Scripts | session、workspace root/folder、loaded source path/name、file icon。 | 展开/折叠、filter/find、open source、Collapse All；context key区分 session/source/folder。 | 仅支持 loaded sources request 的 session可请求初始列表；依赖当前调试会话。 | hidden view 标记 refresh-on-visible；session loadedSource new/changed/removed/name change异步增量更新；筛选时暂时 expand all，退出筛选恢复视图状态。 | capability 不支持时树为空；未找到专属空态文案。 | MVP可打开当前栈相关源码，包括sourceReference；完整Loaded Scripts源浏览器后续。来源：[loadedScriptsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts#L414-L520)、[loadedScriptsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts#L525-L640)、[loadedScriptsView.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/loadedScriptsView.ts#L760-L806)。 |

### VSCode 的七个数据接口

这是原源码的契约摘要，不能把 Studio 的 DTO 类型当作它们已经完整实现。来源：[debug.ts](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/common/debug.ts)。

| 接口 | 字段 / 关系 | 方法 / 事件 / 约束 |
|---|---|---|
| IDebugSession | id、configuration/unresolvedConfiguration、state、root、parentSession、name、capabilities/rememberedCapabilities、threads、REPL | 请求和会话事件入口；状态改变/adapter结束/加载源码事件；session结束可保留展示信息，不能继续使用活句柄。源码386行起 |
| IThread | session、threadId、name、stopped、stoppedDetails、callStack、reachedEndOfCallStack | fetch/clear stack、exception info、continue/pause/step；clear取消未完成栈请求；stale只作视觉连续。503行起 |
| IStackFrame | thread、frameId、name、source、range、presentationHint、canRestart、instructionPointerReference | getScopes/getMostSpecificScopes/forgetScopes/restart/openInEditor；scope promise仅当前暂停期缓存。578行起 |
| IScope | ExpressionContainer、name、expensive、range、childrenHaveBeenLoaded | getChildren懒加载；昂贵scope不自动全读；ErrorScope不能当空scope。570行起 |
| IExpression | name；继承value/type/valueChanged、hasChildren、reference/memoryReference/presentationHint/valueLocationReference | getSession/evaluateLazy/getChildren；reference变更清children缓存；value是展示字符串，reference不是地址。180行起 |
| IViewModel | focusedSession/focusedThread/focusedStackFrame、selected expression、multiSession、visualized expression | onDidFocusSession/Thread/StackFrame（含explicit）、onDidSelectExpression、onDidEvaluateLazyExpression、updateViews；只管焦点/视图。718行起 |
| IBreakpoint | enabled、condition/hitCondition/logMessage、verified/supported/message/mode、sessionsThatVerified；originalUri/uri/line/end/column、adapterData、sessionAgnosticData、triggeredBy/pending | getIdFromAdapter按session；set/getSessionDidTrigger；toDAP SourceBreakpoint；用户期望位置与adapter实际位置分开。629行起 |

VSCode的稳定scope ID用于保留展开状态，不证明目标堆对象身份。Studio新增runId/stopEpoch/request generation/coverage服务画布，这些不是DAP字段。

### 当前底座的规范化数据子集

当前 foundation 的规范化数据接口见 [`frontend/domain/contracts.ts`](../frontend/domain/contracts.ts)：

1. `RuntimeHandle`：`sessionId + runId + stopEpoch + threadId + kind + reference`。DAP 临时引用，不可跨 run 或 stop epoch复用，不持久化。
2. `SessionSnapshot`：`id/runId/state/capabilities/threads`；状态为 initializing/running/stopped/ended。
3. `ThreadSnapshot`：`id/name/state/stopEpoch/frames/message`；线程可 running/stopped/partial-unsupported。
4. `StackFrameSnapshot`：id/name/source/line/column/handle/scopes。
5. `ScopeSnapshot`：id/name/expensive/handle/values。
6. `ValueSnapshot`：id/name/value/type/evaluateName/handle/structure/tensorMetadata/collectorIdentity/children。
7. `Coverage`：complete/partial/unknown、reason、knownMissing。`CapabilitySet` 用独立布尔集合声明基础页面可用性，不将未知能力当作支持。

衍生持久化对象为 `PersistedValue`, `PersistedFrame`, `TraceSnapshot`；`createTraceSnapshot` 去除 RuntimeHandle 并冻结快照。用户手工白板 `ManualBoard` 和 runtime trace document 是不同类型，不能把运行时真假状态写回手工画板。

基础端口当前定义在 [`frontend/application/ports.ts`](../frontend/application/ports.ts)：`DapClient.getStackFrames/getScopes/getVariables`、`EditorPort.openSource`、`RendererPort.renderScene`、`WorkspaceStore.load/save`。这只是接口，不含传输、launch/attach配置或真实 adapter。

## DAP 时序、请求和事件

顺序：initialize response → 发送launch/attach请求 → 收到initialized → 设置各source完整断点/异常配置 → configurationDone（能力支持时）→ launch/attach可随后返回 → stopped → threads → stackTrace → scopes → variables。

**不能等待launch response才处理initialized**：某些adapter等configurationDone才返回launch，串行等待会死锁。实现要同时处理响应、事件和反向请求。适配器也可能更早返回launch，不能写死其响应时点。

全部契约来自固定提交的 [`debugProtocol.d.ts`](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/common/debugProtocol.d.ts)、[`debugSession.ts`](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/debugSession.ts)、[`rawDebugSession.ts`](https://github.com/microsoft/vscode/blob/c024bfb636e6db359ca29775b88c819866c84863/src/vs/workbench/contrib/debug/browser/rawDebugSession.ts)。

| 请求 / 事件 | 方向与意义 | 条件/实现纪律 |
|---|---|---|
| `initialize` | client→adapter；唯一首个 request，client 传 client capabilities，adapter 返回 capabilities。 | `initialize` response 前 client 不发其他 request/event；DA 也不能先发 event/request。initialize 只发一次。 |
| `launch` / `attach` | client→adapter，根据 debug configuration 的 `request` 字段二选一启动/连接目标。 | launch参数由语言包schema与host执行策略管理；产品MVP实现受授权launch，attach后续专项验收。本轮不实现真实启动。 |
| `initialized` | adapter→client；adapter 初始化完毕，可接配置请求。必须在 initialize response 之后。 | 收到后才发送设置断点等配置。 |
| `setBreakpoints` | client→adapter，按 source 发送当前完整的 lines/breakpoints 列表。 | 是每个 source 的全量替换语义：改动后以该文件当前完整断点集合重发，空集合表示清除该 source 的断点；不能只假设为单点增量。源码调用见 `debugSession.ts` 506行附近。 |
| `setFunctionBreakpoints` | client→adapter；针对 session 的函数断点全量配置。 | 只在 adapter 声明 `supportsFunctionBreakpoints` 时发送。 |
| `setExceptionBreakpoints` | client→adapter；传 exception filters/options。 | 依adapter exceptionBreakpointFilters；高级选项分别受 supportsExceptionOptions/supportsExceptionFilterOptions 控制，不能用 configurationDone 能力替代异常配置能力。 |
| `configurationDone` | client→adapter；表示配置请求结束。 | 仅在 adapter `supportsConfigurationDoneRequest` 时发送；VS Code 顺序：initialized→发送全量断点→configurationDone（支持时）→fetchThreads。 |
| `threads` / `stackTrace` / `scopes` / `variables` | client→adapter；逐层读当前暂停运行时。 | `frameId`、`variablesReference` 只在当前 suspended state 有效；运行/继续/重新停下应递增 stop epoch 并丢弃旧请求结果。variables paging 是 client 宣告能力，request 用 `start/count/filter`；adapter仅在 capability true 时须 honor start/count。 |
| `evaluate` | client→adapter；可向 REPL/watch/hover等context提交表达式。 | 表达式可能触发任意目标运行时副作用；不得把它当纯读取。本轮没有求值实现；产品MVP允许授权范围内明确Watch/REPL，不把evaluate当纯读取。配置/表达式超出批准范围才重新确认。 |
| `setVariable` / `setExpression` | client→adapter；修改运行时变量/表达式。 | 修改副作用；MVP 不发送。 |
| `runInTerminal` / `startDebugging` | adapter→client 的 reverse requests。 | 只有 client `initialize` 明确宣告 supportsRunInTerminalRequest/supportsStartDebuggingRequest 才允许 adapter请求。此应用策略默认拒绝；只有 host 对当前请求显式批准且呈现命令/配置与影响后，才可执行。未批准/无支持必须返回失败，不自动启动 shell/session。 |
| `stopped` | adapter→client；程序因 breakpoint/step/exception/pause等条件停止。 | 含 threadId、reason、可选 allThreadsStopped/description/hitBreakpointIds；触发刷新 thread/stack/scope，但 allThreadsStopped=false只允许对应线程停止。 |
| `continued` | adapter→client；debuggee继续运行。 | allThreadsContinued缺省按协议true；false只继续指定thread。Studio当前只支持全停一致快照，因此部分继续时全局inspection失效；与terminated不同。 |
| `invalidated` | adapter→client；提示已显示的数据逻辑区失效。 | areas可缺省/未知；`variables`/`watch` 引起对应视图刷新，`threads`/`stacks`/`all` 清线程并重取栈；只是尽力提示。仅当client宣告 `supportsInvalidatedEvent`。 |
| `memory` | adapter→client；某 memoryReference 的字节范围更新。 | `memoryReference/offset/count`，仅当client `supportsMemoryEvent`；只刷新重叠且当前正显示的范围。 |
| `capabilities` | adapter→client；一部分 capabilities 更改。 | 仅包含改变的键，其余保持；UI尽力响应，不是任意延迟功能开关保证。 |
| `terminated` | adapter→client；debugging of debuggee terminated，不保证 debuggee process 已退出。 | 对session生命周期结束/断开debugging有意义；不可等同 process exit code。 |
| `exited` | adapter→client；debuggee process退出，含 exit code。 | 不必然代替 terminated；分别处理进程退出和调试协议 session 终止。 |

### 其他请求与能力（产品分期）

| 请求 | 能力 / 数据契约 | 分期 |
|---|---|---|
| continue / pause / next / stepIn / stepOut | 基本控制；threadId；singleThread需supportsSingleThreadExecutionRequests，granularity需supportsSteppingGranularity | MVP正向控制 |
| source / loadedSources | sourceReference不得当磁盘路径；loadedSources需supportsLoadedSourcesRequest | 当前帧源码MVP，完整列表后续 |
| readMemory / writeMemory | supportsReadMemoryRequest/supportsWriteMemoryRequest；memoryReference+offset/count或base64；address/data/unreadableBytes。不可读字节不补零伪装 | Phase1 GDB验证读取；产品后续，写不做MVP |
| disassemble | supportsDisassembleRequest；指令引用、偏移、条数 | 后续 |
| setVariable / setExpression | supportsSetVariable/supportsSetExpression；额外写授权 | 后续 |
| evaluate hover | supportsEvaluateForHovers仅用于hover；普通evaluate没有同名通用supportsEvaluate旗标 | 明确Watch/REPL MVP；自动hover后续 |
| completions / exceptionInfo | supportsCompletionsRequest / supportsExceptionInfoRequest；无exceptionInfo也可显示stopped异常原因 | 异常基本信息MVP；completion后续 |
| condition / hitCondition / logMessage | supportsConditionalBreakpoints / supportsHitConditionalBreakpoints / supportsLogPoints | MVP逐项验收，不支持则禁用 |
| dataBreakpointInfo / setDataBreakpoints | supportsDataBreakpoints；dataId/accessTypes/canPersist不等于跨run永久有效 | 后续 |
| setInstructionBreakpoints | supportsInstructionBreakpoints | 后续 |
| stepInTargets / restartFrame / goto* | supportsStepInTargetsRequest / supportsRestartFrame / supportsGotoTargetsRequest | 后续 |
| stepBack / reverseContinue | supportsStepBack；是真实回退目标，不是查看历史快照 | 后续 |
| restart / terminate / disconnect | supportsRestartRequest/supportsTerminateRequest；disconnect参数依terminate/suspendDebuggee能力与launch/attach语义 | MVP可stop→新run；attach不默认杀外部进程 |
| cancel | supportsCancelRequest；取消不成功也必须丢弃过期回包 | Phase1/MVP |

额外事件：thread更新线程列表；breakpoint更新会话绑定；output带category/group/source/variablesReference进入有界Console；loadedSource更新源码；process供展示；progressStart/Update/End只在声明支持后处理。所有事件不自动授予执行权限。

### Client 与 adapter capability 区分

- **Client capabilities** 由应用在 `initialize.arguments` 告诉 adapter，例如 `supportsVariablePaging`, `supportsRunInTerminalRequest`, `supportsStartDebuggingRequest`, `supportsMemoryReferences`, `supportsMemoryEvent`, `supportsInvalidatedEvent`。它们承诺“client能处理”。Studio 必须对 reverse request 能力默认不宣告，除非实现了host审批。
- **Adapter capabilities** 由 adapter 的 initialize response 返回，也可用 `capabilities` event增量更新，例如 `supportsConfigurationDoneRequest`, `supportsFunctionBreakpoints`, `supportsExceptionInfoRequest`, `supportsCompletionsRequest`, `supportsLoadedSourcesRequest`, `supportsReadMemoryRequest`, `supportsWriteMemoryRequest`, `supportsDisassembleRequest`, `supportsStepBack`。它们描述 adapter 能力。UI只在明确 true 时开放对应请求；unknown等同unsupported。
- `variablesPaging` 是 **client capability**（变量请求是否可以分页由client告诉adapter），并非 adapter“可分页”的能力位。DAP VariablesArguments 含 start/count/filter，只有client capability真时，adapter 才需要遵从分页参数。

### 事件和失效规则

- run/session/线程/暂停/frame 是不同状态层。stopped只改变一个或全部线程执行状态；continued也可只继续一个线程；terminated结束调试协议流程；exited带进程退出码；不能用一个`done`状态代替。
- scopes、variables、stack frame handles有限定暂停期；继续运行、session换代、或新的停止epoch都会使旧handle/request无效。回包必须核对当前 runId、threadId、stopEpoch、frameId和请求 generation；旧回包静默丢弃。
- `invalidated` 是缓存刷新提示，不是另一个停止/继续事件；`memory` 是内存范围更新；`capabilities` 是能力差异；三者不得混作状态转移。
- VS Code client在initialize时也向 adapter 宣告了 runInTerminal/startDebugging支持。Studio 安全边界刻意更保守：reverse request默认拒绝，且不能因收到DAP request自动运行命令、启动子调试session或执行工作区脚本；必须 host显式批准。

## 当前 foundation 对照

- [`frontend/application/debug-model.ts`](../frontend/application/debug-model.ts) 已按sessionId与runId过滤旧事件；threadStopped/resumed递增stopEpoch、清frames；选中frame仅属于ViewModel；`allThreadsStopped=false` 映射 `partial-unsupported`，不伪装成完整全局停止。
- [`frontend/application/debug-view-model.ts`](../frontend/application/debug-view-model.ts) 以generation/run/session/thread/stopEpoch/frame共同验回包；只有当前停止帧可以启动 inspection。
- [`frontend/domain/contracts.ts`](../frontend/domain/contracts.ts) 运行时与持久化结构分开；trace不能携带临时handle；Coverage支持 complete/partial/unknown 与 missing原因。
- [`frontend/canvas/documents.ts`](../frontend/canvas/documents.ts) 明确把手工画布与 TraceDocument 分开，trace快照剥离 runtime handles并deep freeze。
- [`frontend/application/ports.ts`](../frontend/application/ports.ts) 是测试/真实适配器边界；没有实现Dap transport、launch、evaluate、write、reverse request或workspace persistence。不要从类型定义推断实际支持。

当前底座只实现纯模型、焦点代际、DTO/投影、字节codec与host策略；真正的DAP request_seq调度、参数schema、超时、分页合并、socket/adapter均未实现。Typecheck和单测不等于VSCode UX已经复刻。

## 待查清单

1. 在当前VS Code固定 SHA 的 adapter broker/provider 层，确认 `runInTerminal` 与 `startDebugging` reverse request在client不支持时的协议错误处理细节；当前产品契约采取默认拒绝，不依赖该实现细节。
2. 完整核对 `supportsReadMemoryRequest`、`supportsDisassembleRequest` 等适配器 capability在VS Code目标view注册/显示的全部上游 gating；此文只确认上述实现要求与视图内请求路径。
3. 目标adapter对 `stopped` 和 `continued` 缺省allThreads*字段的兼容性；当前模型必须按协议字段谨慎处理，不推断整会话状态。
4. 各 view 的本地化空态字符串与不同配置组合截图；本契约未读取的 UI 文案不猜测。
