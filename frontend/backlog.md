# frontend backlog

- [x] 定义会话、线程、栈帧、作用域、变量与 generation-scoped 运行句柄。
- [x] 用纯 reducer 隔离 run 和 stop epoch，并拒绝非全停线程的 inspect。
- [x] 将焦点唯一保存在 ViewModel；部分继续会清理所有暂停句柄，直到再次确认全停。
- [x] 加入聚焦帧请求代际门控、能力命令状态、Canvas 投影和纯 DTO 快照。
- [x] 用 Node 测试覆盖过期回复、跨运行隔离、partial capture、标量抑制及手绘板隔离。
- [x] Trace 深拷贝白名单字段；画布稳定键与执行时 identity 分离，并报告预算截断。
