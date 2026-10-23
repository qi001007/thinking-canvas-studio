# analyzers

Node 子进程静态分析器。`js_analyzer.mjs` 用 TypeScript compiler API 解析单个 `.ts/.tsx/.js/.jsx` 文件，输出与 Python 分析器相同的 Scene/Card JSON：类/接口、继承、字段、方法/构造函数、参数、变量、调用、循环、return、import 和外部依赖。宿主在 `host_service._analyze_js` 中调用，再交给 `graph_views` 做总览/结构/数据过滤。

- 只读解析，不执行用户代码。
- 单文件，无类型检查、无跨文件符号解析。
- 语法错误返回错误，不伪造结构；`Tensor` 类名不等于 tensor 值。
- C/C++/Java 分析器未来放这里，必须使用真实解析器。