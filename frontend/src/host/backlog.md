# host backlog

- [x] DemoHost：脚本化停点/步过/变量/调用栈；明确 `scripted` 标记。
- [x] WebSocketHost：认证、请求/响应、事件/控制台通知、超时、dispose。
- [x] createHost：pywebview `bridge_info` 等待；测试注入 `__studioBridge`。
- [x] `startRealDebug` + pywebview `approve_run`；真实会话 `scripted:false`。
- [x] `analyzeFile(path, view, focus)` 透传图视图/聚焦；静态分析结果含 focusOptions/stats。
- [x] `getVariablePage` / `evaluate`：`debug.variablesPage` 与 `debug.evaluate` 的 WS 客户端；DemoHost 明确拒绝求值。
- [ ] 运行中改断点、错误码/取消/重连；原生确认人工验证；token 生命周期轮换。