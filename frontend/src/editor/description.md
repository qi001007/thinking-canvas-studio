# editor

Monaco 集成。`monaco-setup.ts` 配置 worker、主题与语言注册；`MonacoEditor.tsx` 创建编辑器、模型、断点 gutter、当前行装饰和 Ctrl+S。只依赖 Vite 的 `?worker` 导入，不加载完整 VSCode workbench。