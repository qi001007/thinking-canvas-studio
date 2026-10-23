# 审查与旧版保留记录

核对时间：2026-10-23（Asia/Shanghai）。新目录布局由用户在本轮明确选择。

## 结论

外部计划方向通过，但不是“无技术难度的复制工程”。采用 Monaco/LSP/DAP 与自主画布，拒绝把静态编辑、暂停变量树、整个内存分配历史和 GPU 张量追踪混为一种能力。详见 architecture.md。

用户最终要求写可交接底座，所以本轮实施纯模型、协议与安全边界；真实运行、桌面窗口和完整产品UI仍按spike阶段推进。没有把“先不要大规模实现”理解为禁止一切框架代码。

## 保留证据

- 旧目录：E:\算法思考工具。
- 旧分支：main；本地HEAD：9a4c1563e28679c1c54a57b5327d89f22d0a50ca（发布证据文档提交）。
- v0.3.9标签指向：a1880adba9b9676eb807e2ae9eae28a18094d2b3。
- 通过GitHub MCP读取并核对 [已发布 v0.3.9](https://github.com/qi001007/thinking-canvas/releases/tag/v0.3.9)，不是仅相信本地文档。
- 本地exe与Release资产SHA-256一致：29d95b4f2722d17f5bc998decb33a9ce7b436434873c70ab3d86506e1fc4b3f3。
- 旧项目开始时git status为空。用户画板文件、tokens、前端规范和exe基线哈希见 legacy-baseline.json；没有把画板内容复制进新仓库。

## 清理方式

删除旧文件：0；移动旧文件：0；改写旧源代码：0。

已确认独立目录后，采用从零建新仓库完成架构隔离，保留原目录作为legacy/manual reference。新仓库不继承旧 .git、app/web/site/tests、历史构建缓存、exe或boards；沿用的资产只有带 MIT 来源声明的 `tokens.css`、品牌图和图标。新仓库独立 Git 初始提交，已发布到 https://github.com/qi001007/thinking-canvas-studio（main）。

## 后续破坏性操作

如果将来决定删除/搬移旧目录，应重新给出具体清单和可恢复归档，确认用户画板在备份中后才执行。新仓库开发不需要先删除旧仓库。

## 2026-10-23 方向纠正

主人明确：本产品是新的轻量代码编辑器 + 语言无关图形调试器，不是旧画布的改良版。旧项目只读参考视觉/卡片/时间线；新架构见 architecture.md。Phase 1 底座已落地（Monaco、共享画布、脚本化 DAP、WS 桥、工作区）；真实适配器未接。
