# 交接说明

更新：2026-10-23。当前是 **可运行底座**，真实适配器待填。

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
    host_service.py    方法分发、工作区/语言/调试服务
    workspace.py       安全路径、原子写、boards
    language_packages.py manifest 加载
    dap_session.py     DAP request/event/reverse-request
    scripted_adapter.py 内存 DAP 演示
    debug_service.py   DAP→归一化事件、采集、预算
    execution_policy.py 默认拒绝的 grant 策略
languages/*/manifest.json
docs/
```

## 当前真实链路

1. `StudioApp` 启动 → `createHostClient`。
2. 浏览器：`DemoHostClient`；桌面：pywebview `bridge_info` → `WebSocketHostClient`。
3. `StudioStore.startDebug` → `debug.start` → `HostService` → `DemoDebugService` → `ScriptedDapAdapter`。
4. `framesLoaded` → `createTraceSnapshot` → `projectSnapshot` → `SceneCanvas`；Timeline 追加；Inspector 显示变量/栈。
5. 步过/继续 → `threadResumed`/`threadStopped`/`framesLoaded`，`stopEpoch` 递增，旧句柄失效。

## 填真实适配器的顺序

1. **Supervisor 先于 adapter。** 实现受信 `ExecutionSupervisor`，让 `ExecutionPolicy.enforces()` 只在真实限制生效时返回 `True`；没有它不得启动 debugpy/GDB。
2. **复用 DapSession。** 用 supervisor 启动 adapter，把双向字节流接入 `DapSession`；不要绕过它直接发原始 DAP。
3. **新建真实 DebugService。** 可复制 `DemoDebugService` 的事件/采集结构，替换 `ScriptedDapAdapter`；保持 `runStarted`、`threadStopped`、`framesLoaded` 的 epoch 约定。
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

**真窗口验收 + Python debugpy 垂直闭环。** 先证明 pywebview 窗口能加载 renderer、`bridge_info` 能挂上、IME/DPI/快捷键正常；再接 debugpy + supervisor。不要在真实适配器之前继续堆面板或四语言。

## 禁止

- 不复制 Code-OSS workbench/扩展市场。
- 不把 `ScriptedDapAdapter` 的数据标成真实调试。
- 不在没有 supervisor 时执行用户代码。
- 不把 `variablesReference` 当内存地址或稳定对象身份。
- 不让调试快照覆盖手绘画板。