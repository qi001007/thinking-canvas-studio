# tests backlog

- [x] 既有策略/DAP 帧/桥 envelope 测试保留并通过。
- [x] `test_workspace.py`：列表、读写、原子覆盖、路径穿越/盘符、大小上限、boards 坏 JSON。
- [x] `test_language_packages.py`：四语言 manifest 与空目录拒绝。
- [x] `test_debug_service.py`：脚本 DAP 启动/步过/停止；`stopEpoch` 1→3；变量/console；不执行用户代码。
- [x] `test_bridge_server.py`：错误 token 关闭；认证后 `app.info`；`debug.start/step` 事件流。
- [x] 验证命令：`python -m unittest discover -s desktop/studio_host/tests -t desktop -v`，46 项通过。
- [ ] 真实 adapter 的 DAP 日志、断点位置、超时/断线、进程清理；pywebview 真窗口。