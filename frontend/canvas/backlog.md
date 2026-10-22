# canvas backlog

- [x] 仅投影结构化值与栈帧，标量留在表格。
- [x] 保留每个结构变量展示节点；仅凭明确 collector identity 从当前变量节点连向首个代表节点，并为重复节点停止展开子项。
- [x] 拒绝将运行/结束中的运行时快照投影成旧帧；未知状态保留 unknown coverage。
- [x] 快照仅存纯 DTO；布局 key 与运行时 identity 分离。
