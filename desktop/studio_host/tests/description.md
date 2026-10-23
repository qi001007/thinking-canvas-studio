# tests

宿主标准库测试：授权策略、DAP 帧、JSON-RPC envelope、工作区路径/原子写、语言包、脚本化 DAP 会话，本地 WS 桥（认证/错误 token/事件）、真实 debugpy（Job Object 下断点/locals/单步/清理）、wall timeout、工作台/Python 静态图/TS 静态图/图视图聚焦与语法错误。除桥测试会绑定 loopback 端口外，不启动浏览器、WebView、真实适配器或用户脚本；TS 测试会调用 Node 子进程解析 fixture。