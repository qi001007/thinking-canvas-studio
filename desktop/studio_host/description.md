# studio_host

本地宿主包。`bridge_server.py` 提供 loopback WS JSON-RPC、token/Origin/allowlist；`host_service.py` 分发 app/workspace/boards/debug 方法；`workspace.py` 做路径约束、原子写与 boards；`language_packages.py` 加载四语言 manifest；`dap_session.py` 处理 DAP request_seq/事件/超时/反向请求；`scripted_adapter.py` 提供不执行进程的演示数据；`debug_service.py` 归一化事件并采集变量树；`execution_policy.py` 保持默认拒绝。真实 supervisor 未实现。