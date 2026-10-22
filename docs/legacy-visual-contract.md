# Legacy Thinking Canvas 视觉与交互契约

此文档锁定现有 `E:\算法思考工具` 网页版的视觉习惯，作为 Thinking Canvas Studio 借鉴输入。用户已经认可这些美学和交互原则，新产品应继承暖纸色、卡片、右侧检查器和底部时间线；为新增编辑器与调试面板适配空间，不随意另起视觉风格。

## 旧设计 token 和源码位置

旧版 token 唯一入口是 [`web/css/tokens.css`](E:/算法思考工具/web/css/tokens.css)：

| 类别 | 旧值 / 规则 | Studio 使用边界 |
|---|---|---|
| 画布 / 页面 | `--paper: #f6f4ef`, `--paper-deep: #efece4`; `--surface: #fff`, `--surface-soft: #fbfaf6`, `--surface-tint: #f4f1e9` | 可以保留暖色画布与白色内容面的舒适感；需先看数据可读性、调试态颜色，不照搬旧应用全屏布局。 |
| 文本 | `--ink: #24313d`, `--ink-soft: #3d4b57`, `--muted: #6d7a86`, `--faint: #9aa4ae`; `--font-ui: Inter, Noto Sans SC, Microsoft YaHei, system-ui...`; `--font-mono: JetBrains Mono, Cascadia Code, SFMono-Regular, Consolas, monospace` | 保留清晰字阶和等宽数据；保留原字号层级；Monaco正文与新增调试信息按阅读任务设字号，并通过真实窗口对比验证。 |
| 边线 | `--line: #e5e1d8`, `--line-strong: #d5cfc2` | 轻边线，边界清楚即可。 |
| 主色 | `--accent: #2f5d8a`, `--accent-bright: #3d76b3`, `--accent-soft: #e9f1f8`, `--accent-ink: #234a70` | 用于选中、焦点、主要操作；保留状态一致性，避免所有数据都染蓝。 |
| 状态色 | amber `#c58f25` / `#fff3cf` / `#e4bf63` 表示变化；green `#3d7a58` / `#eaf4ec` / `#9dc3a9` 表示新增；red `#b45454` / `#fbeaea` 危险；violet `#76558f` / `#f2ebf7` 辅助；`--blue-soft #e8f0fa` | 不直接复用“旧语义”做程序状态：应为运行、停止、异常、能力缺失、数据不完整分别定义新语义并检查色盲/对比度。琥珀/绿只适合数据 diff、新增项。 |
| 阴影 / 圆角 | `--shadow-sm: 0 1px 2px rgba(35,45,55,.045)`；md为轻阴影+`0 12px 26px rgba(...,.055)`；lg `0 18px 48px rgba(...,.16)`；`--radius: 12px`, `--radius-sm: 8px` | 可复用轻阴影层次与中圆角，不需给每个数据块浮起效果。 |
| 旧布局度量 | `--topbar-h: 54px`, `--boards-w: 212px`, `--tools-w: 168px`, `--inspector-w: 292px`, `--pane-split: 5px`, `--timeline-h: 48px` | 作为初始布局基线沿用；新增编辑器与调试面板后再依据窄窗/拖动测试调整，保留可拖分栏与状态持久化。 |
| 滚动条 | `--scroll-thumb: #cec7b9`, hover `#b3aa99` | 旧版默认透明、hover对应容器才出现。Studio可沿用隐式滚动作为候选，但需确保关键列表的滚动可发现。 |

样式分布：页面栏与时间线在 [`web/css/app.css`](E:/算法思考工具/web/css/app.css)，白卡/选中/数据类型状态在 [`web/css/canvas.css`](E:/算法思考工具/web/css/canvas.css)，通用控件与右侧检查器在 [`web/css/components.css`](E:/算法思考工具/web/css/components.css)。

## 值得保留的视觉和交互原则

- **留白画布 + 数据归属明确**：旧截图 `screenshots/empty.png` 是空白的暖纸色点阵工作区，中间只有一个主要“放一个数组”动作；`screenshots/hero.png` 左侧为画板、工具栏，中间对象画布，右侧 inspector，底部时间线。这个结构适合空间布局模型，Studio可以抽取“中心内容 + 辅助上下文”关系，不必原样照搬 4栏。
- **细弱边界**：白卡、暖纸背景、薄边线、小阴影，焦点用accent outline；变化用琥珀、插入用绿色、当前元素用蓝框。保持层级优先于装饰。
- **卡片操作有结果**：旧规范要求每个卡片图标必须实际执行可见动作；在只读历史模式中必须反馈只读状态，不能静默响应。
- **历史浏览为只读视图**：时间线按序号和标题显示步骤，变化数作为摘要；进入某步时顶部只读 banner提示“正在查看第…步 · 只读”；用户可回到当前。选中时间线chip自动滚入视口，前后导航根据边界禁用。源码：[timeline.js](E:/算法思考工具/web/js/ui/timeline.js)、[canvas.js](E:/算法思考工具/web/js/ui/canvas.js)、[steps.js](E:/算法思考工具/web/js/core/steps.js)。
- **按上下文显示 inspector**：历史步优先，多选次之，单对象再到整个画板；board summary显示对象/步骤/未记录计数，步骤显示标题备注与变化摘要。源码：[inspector.js](E:/算法思考工具/web/js/ui/inspector.js)。
- **短提示而非常驻说明**：旧规范规定常驻文案仅操作必需，状态提示短暂且一行、失败或不可见动作才 toast；列表内部滚动，不让增长列表撑开整个视图；颜色字号间距集中走 tokens。

## Studio 的状态隔离约束

1. **手绘画布是用户创作内容**。现有自由画布对象包含 shape/pen/text/sticky/connector/node等。历史快照仅用于浏览，不应因实时 runtime更新而覆盖、移动或重置用户手动节点和注释。
2. **运行时快照和用户布局分开保存**。`frontend/canvas/documents.ts` 定义 `ManualBoard` / `TraceDocument`，注释与layout可以各自关联；运行时数据刷新只影响 runtime document / projection，不应把runtime状态写进手工board。
3. **布局key与runtime identity分离**。场景节点由稳定layout id映射 `valueId`；Dap handles临时、只在run和stop epoch有效；旧trace保存时剥离handles。新一轮运行不能借用上一轮layout的临时引用。
4. **只读历史与可编辑当前画布分清**。旧版查看某一步时不允许编辑。Studio应对历史trace/运行结果使用显式只读视觉；不要以禁用控件造成“无响应”，可以显示原因短提示。
5. **适配器能力不完整时保留结构与缺失说明**。不要把未知结构字段补猜成“无子项”；保存coverage的partial/unknown与knownMissing，局部刷新不应清掉用户注释和已有截图证据。

## 布局继承与新增面板适配

手绘模式保持画板、工具、卡片、检查器与时间线的熟悉关系。调试模式增加代码编辑器及 Variables/Watch/Call Stack，按内容需要折叠辅助栏，保持列表内部滚动和可拖分隔条。卡片颜色、圆角、阴影、指针胶囊与变化高亮继续使用同一套 tokens。实际窗口在 1100px 与 1450px 宽度及常见 DPI 下对照验收；不能仅凭源码宣称新UI已经保留旧体验。

## 旧版设计依据

- [`docs/前端设计规范.md`](E:/算法思考工具/docs/前端设计规范.md)：极简、布局、状态与滚动、字面量批量输入、卡片控件行为、窄窗口截图要求。
- [`web/css/tokens.css`](E:/算法思考工具/web/css/tokens.css)、[`web/css/app.css`](E:/算法思考工具/web/css/app.css)、[`web/css/canvas.css`](E:/算法思考工具/web/css/canvas.css)、[`web/css/components.css`](E:/算法思考工具/web/css/components.css)：原tokens及组件样式。
- [`web/js/ui/timeline.js`](E:/算法思考工具/web/js/ui/timeline.js)、[`web/js/core/steps.js`](E:/算法思考工具/web/js/core/steps.js)、[`web/js/ui/inspector.js`](E:/算法思考工具/web/js/ui/inspector.js)、[`web/js/ui/canvas.js`](E:/算法思考工具/web/js/ui/canvas.js)：历史、只读和检查器分支。
- [`screenshots/hero.png`](E:/算法思考工具/screenshots/hero.png)、[`screenshots/empty.png`](E:/算法思考工具/screenshots/empty.png)：本次实际查看的两张桌面截图；窄窗口现状没有从截图验证，不能据此声称移动端或窄窗已通过。
