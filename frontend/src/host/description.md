# host

渲染器与本地宿主之间的接口层。`types.ts` 定义 HostClient/文件/语言/控制台类型；`demo-host.ts` 提供不执行代码的脚本会话；`ws-host.ts` 走 loopback WS JSON-RPC 并处理事件；`create-host.ts` 选择 pywebview/WS 或 Demo。token 不在 URL 中。