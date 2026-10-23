# desktop

Python 桌面宿主。`app.py` 是 pywebview 入口：启动 loopback 静态服务器、WS 桥、`bridge_info`，加载 `frontend/dist` 或 Vite；`studio_host/` 提供工作区、语言包、DAP 会话、脚本化适配器、默认拒绝的执行策略、JSON-RPC 桥和 Python/图视图；`analyzers/` 提供 TS/JS 静态分析器。Python 已接真实 debugpy + Windows Job Object；其他语言调试适配器与 Linux 监管尚未接入。