# 数据模型与边界

## 三种身份必须分开

| 身份 | 用途 | 有效期 |
|---|---|---|
| 运行身份 | sessionId、runId、threadId、stopEpoch | session/run 独立；暂停代随继续/新停点失效 |
| 协议句柄 | frameId、variablesReference、memoryReference 等 | 以适配器和暂停期为边界；不是地址或稳定对象 ID |
| 展示身份 | 文档 ID、快照 ID、变量路径、layout key | 布局可跨快照；只保证位置连续，不证明对象相同 |

核心源码见 [contracts.ts](../frontend/domain/contracts.ts)。它是 Studio 最小规范化子集，不是 VSCode 接口逐字复制，也不是全部 DAP schema。

当前模型按“单会话、全停快照”实现。数据结构保留 thread 维度；部分线程继续时不采集可能变化的共享对象。后续要支持部分线程暂停，必须增加线程与共享堆采集一致性策略。

## Runtime 和持久快照

- Session：身份、运行状态、适配器/运行时版本、capabilities、threads；adapter 名称与版本将由 language package 传入。
- Thread：身份、名字、运行状态、暂停代、当前栈帧。选中帧属于 ViewModel。
- Frame：session/run/thread/epoch 作用域内句柄、名称、源码位置、作用域。
- Scope：名称、expensive、子项句柄、分页/加载状态；未展开不代表没有数据。
- Value：显示值与类型、变量路径、可选结构分类/元数据/collector identity、children。数值字符串未经解析不能用作指针地址。
- Snapshot：捕获时间、来源/版本、coverage、预算与不完整原因、纯持久 DTO。源码当前已实现字段以 contracts.ts 为准；后续字段需 schema migration。
- ViewModel：聚焦 session/thread/frame、展开、选择、请求代、历史游标、布局偏好；当前仅实现焦点和请求代际保护。

coverage 的 complete 只表示声明的采集范围完整，永远不表示“整个进程内存”。需要按 root/path 定义 capture plan；在正式 recorder 接入前，不允许把所有未展开子项包装成 complete。

## 共用画布、独立事实源

```text
ManualBoard --用户编辑/撤销--> ManualScene
DebugSnapshot --选择/投影--> DebugScene
                           ↓
                共用 Scene / Card / Edge Renderer
                           ↑
              LayoutViewState + AnnotationOverlay
```

手绘板、调试记录、布局与注释是独立数据。调试快照只读；用户可以拖布局/加注释，但不能改写快照中的真实值。若用户要把调试结果用于手工推演，执行“复制为手绘板”，生成新的文档身份，并标记来源快照。

当前 Scene DTO 仅覆盖结构节点/边；手绘的笔迹、文字、形状和格子编辑语义还需在产品阶段补齐，不能据此宣称已移植旧画布。

## 画布投影规则

1. 栈帧、容器、结构体、引用/指针、堆块、张量元信息可进入画布；简单标量默认只留 Variables。
2. 别名线必须有显式采集器证据；同值、同文本地址、同 variablesReference 都不足以证明跨暂停身份。
3. collector identity 必须标明来源与范围；运行时地址重用不等于同一对象。持久快照可保留当次证据，不用于无限跨运行匹配。
4. 布局按调用位置/变量语义路径复用，不以当前执行行或列表呈现顺序作身份；遇到重命名/递归歧义显示新节点。
5. 节点数量、访问值数量、深度、页大小分别限额。只截断渲染还不够：采集和遍历也必须有界。
6. partial/unknown/预算命中都由 DTO 带出；前端显示“未采集”而不是“已删除”。动画仅表现两个已知快照差异，不生成虚构中间值。

## 拟议磁盘格式（尚未实现文件系统）

```text
project-root/
  .thinking-canvas/
    project.json            schemaVersion、相对源码 URI、语言启动配置
    boards/<board-id>.json   手绘对象与手绘步骤
    layouts/<view-id>.json   布局、视口、折叠/选择（本地用户态）
    notes/<document-id>.json 绑定快照/对象的标注
    traces/<run-id>/
      manifest.json         provenance、采集计划、预算、记录完整性
      snapshots.jsonl       不含临时协议句柄的快照
```

代码文件保持普通文件，不塞进画板 JSON。凭据/本地批准 token/绝对机器路径不进可分享项目；敏感输出和跟踪默认本地、不自动提交 Git。初始建议记录预算：最多 200 个暂停快照或 64 MiB（二者先到），保留用户固定记录；具体编码/压缩和自动清理在数据 spike 决定。

原子保存用同目录临时文件、验证、fsync、替换；坏文件不得部分覆盖当前文档。首次支持导入 legacy schemaVersion 1 时只生成新文件，绝不原位迁移旧 boards。

## 桥与安全数据流

前端与 host：JSON-RPC 2.0 方法 allowlist；host 与 adapter：DAP `seq/request_seq/type/command` 加字节帧，二者不是同一个协议。

拟议前端方法：workspace.readText/saveText、debug.start/stop/continue/step/inspect、trace.export。启动参数必须由 host 解析和校验，不允许前端发任意 shell 字符串；不暴露通用 raw DAP 代理。

当前 bridge_contract 只校验请求/响应（不支持 notification/batch），不是完整 RPC server；参数 schema、连接鉴权、消息大小、速率/队列、断线取消都待 spike。WebSocket 只绑定 loopback 随机端口；每次 app 实例随机 token、Origin/Host 校验、token 不写 URL/日志，测试恶意网页跨站连接。禁止外部导航使用有权限的 bridge。

执行批准由受信 host 签发：绑定工作区、adapter 身份/版本、配置摘要、操作集合、过期时间和资源预算。当前 Python 只提供策略与端口；运行监管没有实现，所以默认不能启动程序。批准后相同会话和范围内的步进不应每次弹确认；配置/目标/预算或额外执行表达式改变才重授。

资源限制不等于完整恶意代码沙箱。用户程序的文件/网络访问是否隔离需另立明确权限模型；MVP 的确认界面不能声称已实现虚拟机级隔离。
