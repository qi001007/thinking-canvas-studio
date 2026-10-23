# domain backlog

- [x] 定义 generation-scoped DAP 句柄与显式覆盖完整性。
- [x] 区分结构变量的身份依据与普通 DAP 引用编号。
- [x] 增加 `CardData`、`ContainerKind`、`CanvasNode.card`、`CanvasEdge.label`；手绘/调试共用视觉载荷。
- [x] `TraceSnapshot` 增加 sequence/label；`ValueSnapshot/PersistedValue` 增加 containerKind；`CanvasNode.kind` 增加 manual。
- [x] 静态卡片种类（class/parameter/module/import/call/external/loop）、`CanvasNode.origin` 与结构边种类。
