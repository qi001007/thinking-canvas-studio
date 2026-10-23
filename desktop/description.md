# desktop

Python 桌面宿主。`app.py` 是 pywebview 入口：启动 loopback 静态服务器、WS 桥、`bridge_info`，加载 `frontend/dist` 或 Vite；`studio_host/` 提供工作区、语言包、DAP 会话、脚本化适配器、默认拒绝的执行策略和 JSON-RPC 桥。真实语言适配器与 OS 级 supervisor 尚未接入。