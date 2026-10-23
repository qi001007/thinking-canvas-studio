# tests backlog

- [x] 既有策略/DAP 帧/桥 envelope 测试保留并通过。
- [x] `test_workspace.py`：列表、读写、原子覆盖、路径穿越/盘符、大小上限、boards 坏 JSON。
- [x] `test_language_packages.py`：四语言 manifest 与空目录拒绝。
- [x] `test_debug_service.py`：脚本 DAP 启动/步过/停止；`stopEpoch` 1→3；变量/console；不执行用户代码。
- [x] `test_bridge_server.py`：错误 token 关闭；认证后 `app.info`；`debug.start/step` 事件流。
- [x] `test_real_debug_service.py`：真实 debugpy 断点/locals/list/单步/停止清理；`test_windows_supervisor.py`：Job Object 限额 + wall timeout；`test_approval_registry.py`：单次 scope 绑定。
- [x] `test_static_analysis.py`：工作台继承 context、类/字段/调用/循环/returns 图、语法错误不伪造结构、工作台稳定创建/读写。
- [x] `test_real_debug_service.test_record_mode_builds_a_complete_frame_timeline`：自动逐行记录、循环帧、runEnded。
- [x] 验证命令：`python -m unittest discover -s desktop/studio_host/tests -t desktop -v`，57 项通过（含变量分页/求值、嵌套控制、自动记录、TS 静态分析、图视图聚焦）。
- [x] `test_static_analysis.py`：类结构一层、方法聚焦展开、TS 结构/方法下钻；不再把方法内部变量当类视图成员。
- [x] `test_real_debug_service.test_long_variables_are_paged_and_watch_evaluates_at_stop`：10 万项列表首批 100、分页继续、Watch `len(nums)`。
- [x] `test_static_analysis.test_nested_loops_branches_and_comprehensions_are_nested_nodes`：嵌套 for、if、推导式节点与 nested 边。
- [ ] 大型图/跨文件/递归/张量静态分析；运行中改断点；GDB/JS/Java；IME/DPI。