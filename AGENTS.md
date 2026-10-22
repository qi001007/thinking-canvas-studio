# Thinking Canvas Studio 协作规则

- 对话称呼用户为“主人”；讲解先说明功能与意义，再给代码细节。数学公式用标准 LaTeX。
- 架构/计划使用 Sol；按确认计划写代码使用 Luna（用户原文 lua，按可用 Luna 模型执行）。常规子代理使用 Luna。不能在当前会话切模型时委派 Luna，实现完成由主代理审查。
- 只在这个新仓库工作。旧 `E:\算法思考工具` 是只读 legacy，不删除、不迁移、不改写其源码、画板或标签。
- 编码前先读 docs/实时进度.md、docs/反馈.md、docs/handoff.md 和涉及模块的 description.md。
- 每个源码/文档/测试目录都有 description.md 和 backlog.md；记录该目录的实质变动。仓库根目录不放这两个文件。依赖、构建产物、Git 内部目录免除。
- 产品需求、实时进度、反馈、技术文档统一在 docs/。修完反馈再勾选，不把待验证事项勾成完成。
- 四个原则在 docs/编码原则.md：思考、简洁、精准、可验证；只改当前任务所需内容。
- GitHub 操作优先 GitHub MCP；本地 Git 操作可以用 git，不用 shell/curl 替代可用的 GitHub MCP。
- 真实用户代码执行须明确授权；启动配置、cwd、解释器/适配器、权限、限时/资源预算变更后重授。Watch/REPL/条件断点/数据格式化可能执行代码，也必须纳入授权。
- 当前没有强制资源监管实现。没有受信 supervisor 不得启动目标；不能靠前端确认布尔值当执行授权。
- 不复制整包 VSCode / Code-OSS workbench；不把 GPL 参考项目代码并入本体。代码复用逐项留来源和许可。
- 调试器的运行态只能由 DebugModel 管理；焦点/展开/历史游标只在 DebugViewModel。Presenter 不直接访问 adapter、文件或进程。
- 不把 variablesReference 当内存地址/跨暂停对象身份；未知和未采集必须可见。
- 新产品代码先受 docs/spike-plan.md 的验证门槛约束。已获授权的本底座测试不需要重复请求运行确认。
