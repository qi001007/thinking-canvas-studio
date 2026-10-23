# canvas backlog

- [x] 仅投影结构化值与栈帧，标量留在表格。
- [x] 保留每个结构变量展示节点；仅凭明确 collector identity 从当前变量节点连向首个代表节点，并为重复节点停止展开子项。
- [x] 拒绝将运行/结束中的运行时快照投影成旧帧；未知状态保留 unknown coverage。
- [x] 快照仅存纯 DTO；布局 key 与运行时 identity 分离。
- [x] 新增 `diff.ts`：卡片单元格/项/字段差异与 changedValueIds。
- [x] `createManualStep` 克隆 scene；`createTraceSnapshot` 接受运行时帧并剥离句柄。
- [x] `projectSnapshot` 生成 list/dict/array/struct/pointer/tensor/stack-frame 卡片。
- [x] 运行时调用栈 calls 边与 origin=runtime；静态结构图/运行时图可切换。
- [x] 长容器投影：卡片最多 20 项/12 字段，`truncated/total` 供画布显示 `…` 与已显示数量；不再平铺 100 项。
- [x] `cardFromValue` 导出给运行时叠加；参数值卡支持 `value`；`static-frame` 与 `debug-watch` 用同一 Scene/Card 骨架。
