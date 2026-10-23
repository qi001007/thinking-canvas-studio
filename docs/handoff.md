# 交接说明

更新：2026-10-23。当前是 **可运行底座**；Python 真实 debugpy（含变量分页、Watch、REPL、暂停）、函数工作台、三视图静态结构图（Python/TS-JS）、完整运行记录与回放已接通，C/C++/Java 与其余真实调试适配器待填。

## 先读

README → 实时进度 → architecture → data-model → vscode-debug-contract → 当前 spike。

旧项目 `E:\算法思考工具` 只用于看视觉/卡片/时间线/交互，不是代码基座；不要把它整个加入上下文。

## 目录与所有权

```text
frontend/
  src/
    app/          StudioApp：布局、模式切换、分栏
    editor/       Monaco 初始化、主题、断点/当前行
    canvas/       SceneCanvas：共享卡片/边/拖动/缩放/高亮
    panels/       Topbar、FileSidebar、Inspector、Timeline、Console
    host/         HostClient 接口、DemoHost、WebSocketHost、createHost
    state/        StudioStore：UI/运行/快照/手绘状态
    demo/         脚本演示数据（bubble sort）
    styles/       tokens 引入、app/canvas/editor CSS
    types/        Monaco 模块声明
  core/
    domain/       RuntimeHandle、Session/Frame/Scope/Value、CardData、Scene
    application/  DebugModel、DebugViewModel、DAP 端口
    canvas/       projector、documents、diff
    presentation/ Presenter DTO、tokens
    tests/        Node 原生测试
desktop/
  app.py          pywebview 入口、静态服务器、bridge_info
  studio_host/
    bridge_server.py   WS JSON-RPC、token/Origin/allowlist
    host_service.py    方法分发、真实运行审批、工作区/语言/调试服务
    host_approval.py   单次、限时、绑定 scope 的审批 receipt
    windows_supervisor.py Job Object 限额 + debugpy 启动/回收
    real_debug_service.py 真实 debugpy attach/采集
    static_analysis.py Python AST → 静态 Scene
    graph_views.py    语言无关的总览/结构/数据过滤、聚焦与阅读上限
    workbench.py      干净工作台 + 隐藏继承 context
    socket_transport.py  loopback DAP socket
    workspace.py       安全路径、原子写、boards
    language_packages.py manifest 加载
    dap_session.py     DAP request/event/reverse-request
    scripted_adapter.py 内存 DAP 演示
    debug_service.py   DAP→归一化事件、采集、预算
    execution_policy.py 默认拒绝的 grant 策略
  analyzers/
    js_analyzer.mjs   TypeScript compiler API → 同一静态 Scene（Node 子进程）
languages/*/manifest.json
docs/
```

## 当前真实链路

1. `StudioApp` 启动 → `createHostClient`。
2. 浏览器：`DemoHostClient`；桌面：pywebview `bridge_info` → `WebSocketHostClient`。
3. `StudioStore.startDebug` → `debug.start` → `HostService` → `DemoDebugService` → `ScriptedDapAdapter`。
4. `framesLoaded` → `createTraceSnapshot` → `projectSnapshot` → `SceneCanvas`；Timeline 追加；Inspector 显示变量/栈。
5. 步过/继续 → `threadResumed`/`threadStopped`/`framesLoaded`，`stopEpoch` 递增，旧句柄失效。

## 工作台/静态图扩展点

- `workbench.py` 只支持 Python；`_template`/`_context_source` 是继承机制的入口。
- `static_analysis.py` 是 Python 启发式结构图；`executable_lines` 供完整运行自动设断点。`graph_views.py` 是语言无关的视图/聚焦过滤；新增语言时按“节点/边契约”提供等价分析器，不要把静态推断写成运行时事实。
- 真实变量分页走 `debug.variablesPage`；`ValueSnapshot.childCount/hasMore` 表示是否还有页。列表/数组的后续页通过 `evaluate` 切片（需要 `allowEvaluate` 授权）；字典/集合暂不支持后续页。
- Watch/REPL 走 `debug.evaluate`；服务按 `sessionId/runId/stopEpoch` 校验句柄。`allowEvaluate` 写入 config digest，原生确认明确告知用户；脚本演示的 `evaluate` 为 false。
- TS/JS 由 `desktop/analyzers/js_analyzer.mjs` 解析，宿主 `_analyze_js` 调用后再过 `graph_views`；不执行 Node 中的用户代码。
- UI 的“静态/运行”视图在 `StudioStore.canvasView`，静态图的“总览/结构/数据”在 `graphView`，聚焦节点在 `graphFocus`。
- 静态布局：`SceneCanvas` 的 dagre TB + 类/函数成员网格 + 大方框区域 + `ResizeObserver` 自动适配；阅读上限在 `graph_views.py`。
- 运行时叠加：`StudioStore.runtimeOverlay` 用当前帧的值覆盖同名静态变量/参数卡；没有匹配值时回退 `projectSnapshot`。循环轨道/赋值证据/张量元数据仍待补。
- 完整运行由 `RealDebugService(auto_record=True)` 自动逐行断点/continue；回放由 `StudioStore.togglePlayback/setPlaybackSpeed` 驱动，帧上限 500。

## 添加其他语言适配器的顺序

1. **复用 supervisor/审批。** Python 路径已经证明原生确认 → receipt → GrantAuthority → Job Object。新语言必须走同一条受信链路；不能在前端传布尔值放行。
2. **复用 DapSession。** 用 supervisor 启动 adapter，把双向字节流接入 `DapSession`；不要绕过它直接发原始 DAP。
3. **新建 `RealDebugService` 变体。** 复用 `real_debug_service.py` 的归一化事件/采集/预算结构；按语言调整 launch/attach、变量类型分类、作用域过滤。
4. **语言包。** 在 `languages/<id>/manifest.json` 写 adapter、扩展名、launch 模板；真实安装状态不要伪造。
5. **验收。** 每种语言独立记录 capabilities、断点位置、变量分页、错误路径、进程清理；不能用 Python 成功代替其他语言。

## 填 UI 的顺序

- 新面板：在 `frontend/src/panels` 加组件，数据从 `StudioStore` 取；不要另存运行事实。
- 新卡片：扩展 `CardData` 联合类型 → `projector` 映射 → `SceneCanvas/CardBody` 渲染 → diff 测试。
- 新交互：先在 `StudioStore` 定义动作；UI 只调用动作；手绘与调试用不同写入路径。
- 快捷键：编辑器内交给 Monaco action；画布单字母键必须在非编辑焦点时启用。

## 门禁

```powershell
npm run typecheck
npm test
npm run test:python
npm run build
python desktop/app.py --smoke
```

UI 改动需启动 Vite 并用真实浏览器/窗口点过；只看 diff 不算。真实适配器需保存 DAP 日志、capabilities、进程清理证据；不能只用 mock。

## 下一个任务

**调试 P0b + 画布 v2 余项。** P0b：条件/日志/异常断点、改变量、重启、线程/栈分页、暂停的运行中 UI 测试；画布：逐迭代循环轨道、带证据的赋值/读取边、张量卡、超大框视口虚拟化。之后再做跨文件符号解析、真窗口 IME/DPI/崩溃恢复，以及 C/C++/Java/GDB/js-debug/java-debug/LSP 逐个 spike。

## 禁止

- 不复制 Code-OSS workbench/扩展市场。
- 不把 `ScriptedDapAdapter` 的数据标成真实调试。
- 不在没有 supervisor 时执行用户代码。
- 不把 `variablesReference` 当内存地址或稳定对象身份。
- 不让调试快照覆盖手绘画板。