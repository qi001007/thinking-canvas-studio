# analyzers backlog

- [x] `js_analyzer.mjs`：TypeScript compiler API → 统一 Scene；类/函数/字段/参数/调用/循环/继承/import。
- [x] 修正 `TensorPath` 误判 tensor；补 `this.x` 类字段边；direct calls 只连 function/class/external。
- [x] 宿主 `_analyze_js` + 视图过滤 + Python 测试 `test_typescript_views_use_real_compiler_ast`。
- [ ] C/C++/Java 分析器（clang/tree-sitter/JDT），不用正则伪造 AST。
- [ ] 跨文件解析、类型信息、TS workbench 与 js-debug。