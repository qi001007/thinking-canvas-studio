# core backlog

- [x] 从 `frontend/` 根迁入 `core/`，保持纯逻辑边界；现有 16 项测试迁移后仍通过。
- [x] `CardData`、`containerKind`、Scene/Card 渲染载荷；投影只画结构化值。
- [x] `diffScenes`：卡片单元格/项/字段差异；手绘与调试快照共用。
- [x] `createManualStep`：克隆场景；手绘布局/标注不随步骤变化。
- [x] `TraceSnapshotInput` 允许运行时帧直接传入后再剥离句柄。
- [ ] 真实采集下的 tensor/复杂容器卡片；大容器分页与 coverage 细化。