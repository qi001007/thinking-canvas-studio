# frontend/core

纯 TypeScript 核心，不碰 DOM、网络、文件或进程。`domain` 定义运行句柄/快照/卡片/场景；`application` 提供 DebugModel、DebugViewModel 与 DAP 端口；`canvas` 提供投影、Trace/手绘文档、差异；`presentation` 提供面板 DTO 和 legacy tokens。React 层只消费这些纯数据。