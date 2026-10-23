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

- [x] `workbench.py`：干净工作台 + 隐藏 context 模块；源文件 import/顶层定义继承；源文件 hash 绑定 receipt。
- [x] `static_analysis.py`：AST 函数/类/参数/字段/变量/调用/循环/import/继承/returns/flows；预算与语法错误处理。
- [x] 静态分析/工作台测试；Python 共 57 项通过。
- [x] `graph_views.py`：总览/结构/数据、聚焦、类成员一层 + 方法下钻、阅读上限 18/12/36；方法标题带类名。
- [x] TS/JS 静态分析接入：`_analyze_js` 调 Node 分析器，再走 `graph_views`；非 .py 真实运行拒绝。
- [ ] 递归/超大类自动聚合、跨文件符号解析；C/C++/Java 分析器；TS workbench/js-debug。
- [x] 完整运行自动逐行断点/自动 continue；帧轴回放/调速；fixture 12 帧集成测试通过。
- [x] `RealDebugService(auto_record)`：自动逐行断点/自动 continue/500 帧上限；自动记录集成测试。
- [x] P0a：`debug.variablesPage` 变量分页（10 万项 fixture）、`debug.evaluate` Watch/REPL（停点代际校验）、`allowEvaluate` 写入 config digest 与原生确认、暂停按钮接入。
- [ ] P0b：条件/日志/异常断点、setVariable、重启、线程/栈分页、完整能力矩阵。
- [x] `graph_views.default_focus` 跳过 `__main__ · 测试入口`，静态/运行时默认聚焦真正的用户函数（带参数标签）。
- [x] `static_analysis.py`：`if/else` → `branch` 节点，嵌套 `for/while` 用 `nested` 边，Python 推导式生成控制节点；新增嵌套控制测试，Python 共 57 项通过。
