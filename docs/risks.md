# 风险与验证门槛

| 风险 | 影响 | 缓解与实际门槛 |
|---|---|---|
| 把变量树当完整堆 | 画出不存在的别名、删除、内存大小 | 显式provenance、coverage、collector identity；无证据不画 |
| 连续运行没有逐步事件 | “动画完整还原”承诺失真 | 只播已采集暂停快照；自动步进另设计节奏/开销，丢样标gap |
| 张量隐藏storage/stride/device | 数值显示与实际内存布局混淆 | CPU tensor专用collector先验；GPU不在MVP，禁止自动搬整张量到CPU |
| DAP句柄复用/晚回包 | 旧状态覆盖新帧 | session/run/thread/stop epoch/request generation校验与回归测试 |
| 多线程部分暂停 | 同一画布读到互相矛盾的共享堆 | 当前全停门槛，后续引入线程/采集一致性模型 |
| 容器/对象递归规模 | UI或adapter失去响应 | 采集分页、总字节/项数/深度预算、节点裁剪；静默截断不算通过 |
| WebView2/Monaco焦点/worker | 白屏、快捷键误触、中文输入错 | S1真实窗口/IME/DPI验收，不能只浏览器HTTP测通 |
| monaco-languageclient兼容层 | 轻量目标被依赖膨胀破坏 | classic与Monaco-only实测bundle/启动，并清点license |
| Python属性/Watch副作用 | 查看也执行目标逻辑 | 执行授权覆盖允许求值范围；未知属性formatter不自动递归调用 |
| loopback被恶意网页访问 | 本地文件/运行权限滥用 | 随机token、Origin/Host校验、严格方法参数allowlist、禁止远程绑定 |
| 资源限制不完整 | 无限循环、内存耗尽、子进程残留 | 实现真实OS监管前fail closed；按实际平台测试整个进程树 |
| 存储膨胀/泄露 | 跟踪大量值与敏感输出 | 默认有界、本地、主动导出；code/trace/ui state分开，禁止自动Git提交 |
| 许可/安装链漂移 | 无法合法或可重复分发 | 锁版本、hash、SBOM、语言包许可单列 |
| 跨平台过早扩展 | 重复维护路径映射和资源监管 | Windows先验；WSL作为另一运行环境单独验收 |
