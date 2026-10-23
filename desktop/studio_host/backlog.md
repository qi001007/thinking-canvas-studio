# studio_host backlog

- [x] 保留 `ports.py`、`execution_policy.py`、`dap_framing.py`、`bridge_contract.py` 的既有安全/协议边界与测试。
- [x] `workspace.py`：路径穿越/绝对路径/盘符拒绝、2 MiB 上限、原子写、boards 读写。
- [x] `language_packages.py` + `languages/*/manifest.json`：Python/C++/TS-JS/Java 声明。
- [x] `dap_session.py`：initialize/launch/request/event、超时、反向请求默认拒绝。
- [x] `scripted_adapter.py`：内存 DAP 演示；停点/继续/步过/变量分页。
- [x] `debug_service.py`：DAP→归一化事件；stopEpoch 与 TS 模型一致；变量树预算/coverage。
- [x] `host_service.py` + `bridge_server.py`：WS JSON-RPC、token、Origin、allowlist、事件广播。
- [x] 新增工作区/语言包/脚本 DAP/桥集成测试；Python 共 46 项通过。
- [ ] 真实 `ExecutionSupervisor`（Windows Job Object/等效）与 debugpy adapter。
- [ ] GDB/js-debug/java-debug、LSP、Memory/Disassembly capability。
- [ ] trace 持久化、恢复与旧画板导入。
- [x] `windows_supervisor.py`：Windows Job Object 时间/内存/CPU/进程数 + wall timeout；debugpy 启动/回收；超时测试通过。
- [x] `real_debug_service.py` + `socket_transport.py`：debugpy attach、断点、locals、list 子项、单步、停止清理。
- [x] `host_approval.py`：单次 120 秒 receipt；`host_service.py` 把源文件 SHA-256、程序、断点、解释器、cwd、限额绑定到 config digest。
- [ ] Linux cgroup/rlimit；运行中改断点；更多容器/异常/共享引用；真窗口人工确认。
