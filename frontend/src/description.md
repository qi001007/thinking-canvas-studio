# frontend/src

React 渲染层。`app` 组织布局与模式；`editor` 配置 Monaco；`canvas` 渲染共享 Scene；`panels` 提供顶栏/文件栏/检查器/时间线/控制台；`host` 定义 Demo/WS 宿主；`state` 保存 UI 与快照选择；`demo` 提供脚本化数据；`styles` 沿用 legacy tokens。它不直接启动进程或访问文件，所有宿主能力走 HostClient。