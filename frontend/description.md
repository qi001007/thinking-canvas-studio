# frontend

Monaco + React 的桌面渲染层与纯 TypeScript 核心。`src/` 负责界面、编辑器、画布、面板、宿主客户端和 UI 状态；`core/` 负责调试模型、快照、场景投影、卡片与差异，不依赖 DOM/网络/文件。当前浏览器用 DemoHost，桌面用 WS Host。