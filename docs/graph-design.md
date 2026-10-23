# 结构图设计

更新：2026-10-23。结构图是产品核心，不是调试面板的装饰。

## 参考与取舍

| 参考 | 可借用 | 不照搬 |
|---|---|---|
| [VSCode Call Graph](https://marketplace.visualstudio.com/items?itemName=LuoZhihao.call-graph) | 用 Call Hierarchy 的 incoming/outgoing calls；maxDepth、ignore 文件、以入口函数为中心 | 它只产 Graphviz 静态图；我们不依赖 VSCode 扩展或整包 workbench |
| [Function Call Graph](https://marketplace.visualstudio.com/items?itemName=PrashantSharma.function-call-graph) | JS/TS 函数调用图；聚焦某函数；LSP 级别调用解析 | 不把 LSP 调用树直接当完整图；需要自己的布局/过滤 |
| [Code Visualizer](https://marketplace.visualstudio.com/items?itemName=SirilGanjai.code-visualizer) | C/C++/Python 调用层级流程图；缩放、搜索、可定制视图 | 不支持运行时；也没有数据流/类字段层 |
| [CodeReader](https://marketplace.visualstudio.com/items?itemName=kongming.code-reader-assistant) | 多语言调用图；Mermaid/Graphviz/文本树多种输出 | 只读快照；不把 LLM 生成的结构当 AST 事实 |
| [GitDiagram](https://github.com/ahmedkhaleel2004/gitdiagram) | 交互式架构图、点击组件到源码、分层配色 | 它用模型生成架构摘要；我们的调用/数据边必须来自 AST/运行时，不让模型猜 |
| [CodeGraph](https://gitee.com/mirrors/CodeGraph) | 代码结构图、缩放/拖拽、点击导航 | 不复制其实现；仅参考交互 |

**GitHub 本身没有可直接调用的通用“代码关系图”API**。公开可查的更接近 GitDiagram/CodeGraph 这类外部可视化工具；VSCode 原生只有文本 Call Hierarchy，Call Graph 类插件是把它渲染成图。因此我们只借用交互范式，关系和节点由自己的分析器产生。

## 三种视图

| 视图 | 默认内容 | 目的 |
|---|---|---|
| 总览 | 模块、import、类、顶层函数；方法折叠进类卡片；方法调用上提到类；不画外部调用和调用点卡 | 先看“这个文件与谁有关” |
| 结构 | 聚焦类：类、基类、字段、方法（一层）；聚焦方法/函数：参数、局部变量、循环、返回/数据流、调用目标 | 先看成员，再按需下钻函数内部 |
| 数据 | 聚焦类：字段和构造输入；聚焦方法/函数：局部容器、读写、返回变量、flows/contains | 看数据结构与变化关系，而不是所有表达式 |

- 默认聚焦用户最近写的类（没有类则最近写的函数），不聚焦继承来的 context 节点。
- 类视图只展开一层：字段/方法卡用三列网格；要看方法内部，在“聚焦”下拉里选该方法或函数。
- 方法/函数视图不画调用点卡；调用关系直接落成 `caller -> target` 的 `calls` 边，避免 `len`/`range`/`self.points[...]` 这类调用卡把画面塞满。
- 总览里方法折叠到类卡片，方法级 calls 上提到类，保留依赖；内置函数不生成外部节点。
- 视图之间共享节点/边 ID；切换视图不重新解析源码（一次分析、三种过滤）。
- 渐进展开上限：总览最多 18 个顶层符号；类结构最多 6 字段 + 6 方法 + 基类；类数据最多 12 字段/参数；方法/函数视图最多 36 节点。未显示的成员仍在聚焦列表里；大文件命中分析预算时显示 `partial`。

## 节点/边语义

节点：module、class、function、parameter、variable、loop、call、import、external；`origin: static`。方法节点用 `类名.方法名` 作标题；调用点节点（`kind: call`）只保留在原始分析结果里，结构视图默认不显示。

主要边：

- `defines` / `method` / `field` / `nested`：结构归属；
- `parameter`：函数输入；
- `calls`：函数/方法到被调函数/类/外部依赖；总览使用直达边，详细视图另有 callsite；
- `targets`：callsite 到目标；
- `flows` / `produces`：变量/调用结果的数据流；
- `returns`：返回值到函数；
- `inherits`：类到基类；
- `imports` / `uses`：模块/函数到依赖；
- `reads` / `writes` / `iterates`：字段/循环关系；
- `contains`：结构包含。

静态边只来自 AST/已知源码上下文；不推断运行时对象身份。运行时画布继续使用 session/run/stopEpoch 快照；静态与运行不互相覆盖。

## 布局

- 前端用 [dagre](https://github.com/dagrejs/dagre)（MIT）做有向分层布局（TB、network-simplex），不再手写 BFS 列。
- 类结构/类数据用专门的三列成员网格：类卡在左上，基类/字段/方法按类型排序排在下方；比 dagre 的宽横排更容易读。
- 节点尺寸来自卡片类型；静态卡片宽度比运行时卡片窄一档，减少长排。
- 画布用 `ResizeObserver` 监听分栏尺寸；切换视图、拖动分栏、窗口变化都会重新适配。静态最小缩放 42%，内容仍然放不下时从左上开始，允许平移。
- 边标签只在 calls/returns/inherits/imports 默认显示，减少标签噪声；其余边靠颜色和检查器解释。

## 语言适配器契约

分析器输出同一 `Scene`：

```text
Python  -> static_analysis.py (ast)
TS/JS   -> desktop/analyzers/js_analyzer.mjs (TypeScript compiler API)
C/C++   -> 待接 clang/tree-sitter；不拿正则伪造成 AST
Java    -> 待接 javac/JDT/tree-sitter
```

`graph_views.py` 是语言无关的视图/聚焦过滤；宿主只负责把分析器结果转成统一 Scene。新增语言先保证节点/边语义一致，再接视图和聚焦。

TS/JS 分析器由宿主 `node js_analyzer.mjs <file>` 调用，输出同一 Scene JSON；它处理类/接口、继承、字段、方法/构造函数、参数、变量、数组/对象/张量字面量、调用、循环、返回和 import。限制是**单文件、无类型检查、无跨文件解析**；解析失败时返回空图和错误，不伪造结构。

## 失败边界

- 语法错误返回空图 + unknown coverage，不保留上一份图冒充当前文件。
- 分析预算 320 节点/520 边；超出标 partial。视图上限（18/12/36）是阅读策略，不是分析完整性声明。
- 总览/结构/数据按聚焦过滤后会隐藏节点；隐藏不等于不存在，聚焦列表仍可到达类/方法/函数。
- 工作台 context 只对 Python 生成；TS/JS 目前是文件级静态图，真实调试仍只支持 Python。
- 跨文件符号解析、递归调用分层、超大类的自动聚合尚未实现；当前用聚焦、节点上限和 `partial` 标记兜底。
