# 数据模型

更新：2026-10-23。核心实现在 `frontend/core/domain/contracts.ts`、`frontend/core/canvas/*`；宿主实现见 `desktop/studio_host/*`。

## 三种身份

| 身份 | 字段 | 有效期 |
|---|---|---|
| 运行身份 | `sessionId`、`runId`、`threadId`、`stopEpoch` | 会话/运行独立；暂停代随继续/新停点失效 |
| 协议句柄 | `frameId`、`variablesReference`、`memoryReference` | 只在当前暂停期有效；不是地址或稳定对象 ID |
| 展示身份 | `CanvasNode.id`（布局键）、`valueId`、手动画板对象 ID | 布局可跨快照连续；不证明对象相同 |

`RuntimeHandle` 把运行身份、句柄种类和引用打包在一起；`DebugModel` 和 `DebugViewModel` 会拒绝来自旧 run/session/stopEpoch 的帧和回包。

## 共享 Scene / Card

手绘和调试使用同一个渲染器，但事实源不同。

```text
ManualBoard --用户编辑--> ManualStep.scene
DebugSnapshot --采集/投影--> SceneDto
                         ↓
                 SceneCanvas + CardBody
                         ↑
              LayoutViewState / Annotation
```

`CardData` 是共享视觉载荷：

- `array` / `matrix`：二维单元格；
- `list` / `set`：项列表；
- `dict`：键值行；
- `variable` / `node` / `text`：单值；
- `struct`：字段行；
- `pointer`：引用/目标；
- `tensor`：shape、dtype、预览；
- `stack-frame`：函数名、源文件、行号；
- `sticky` / `function`：手绘便签和函数卡。

调试投影只把结构化值做成节点；简单标量留在变量表。节点 `kind` 表示运行语义（`container`/`struct`/`pointer`/...），`card.kind` 表示视觉形态。布局键由源文件/函数/调用深度/变量路径生成；`valueId` 每次快照可以变化，不用于布局。

## 手绘文档

```ts
ManualBoard {
  id, title,
  scene: SceneDto,
  annotations, layout,
  steps: ManualStep[]
}
ManualStep { id, title, createdAt, scene }
```

- 布局/标注属于画板，不随步骤变化；步骤只冻结场景数据。
- 查看历史步骤只读；回到当前可继续编辑。
- 手绘与调试快照是两套文档；调试刷新不能覆盖手绘对象。

## 调试快照

```ts
TraceSnapshot {
  id, sequence, label, capturedAt,
  runId, sessionId, coverage,
  frames: PersistedFrame[]
}
```

- `createTraceSnapshot` 只保留白名单字段，剥离 `handle`，深拷贝并冻结。
- `coverage` 为 `complete` / `partial` / `unknown`；预算/深度/分页命中要写 `knownMissing`。
- 时间线保存暂停快照；不把“继续运行期间没有采样到”伪造成连续动画。

## 投影与差异

- `projectSnapshot` 把 `NormalizedDebugSnapshot` 或 `TraceSnapshot` 转为 `SceneDto`。
- 结构节点带 `CardData`；帧节点带源位置。
- 别名线只在显式 `collectorIdentity` 相同的时候生成；同值/同 `variablesReference` 不算证据。
- `diffScenes` 比较卡片单元格/项/字段，返回 `changedNodeIds`、`changedValueIds`、`changedParts`；画布据此高亮变化，不修改快照事实。
- 预算：500 节点、5000 访问值、64 深度、每页 100 值；命中即标记 partial。

## 工作区

```text
workspace/
  main.py
  two_sum.py
  notes.md
  .thinking-canvas/
    boards/demo.json
    traces/            # 预留
    layouts/           # 预留
    notes/             # 预留
```

- 代码保持普通文件；画板/跟踪/布局/注释分开。
- `WorkspaceStore` 拒绝绝对路径、`..`、盘符和目录穿越；只暴露 boards 子目录给桥。
- 文本读取/写入有 2 MiB 上限；写入使用同目录临时文件 + `fsync` + `os.replace`。
- 不把临时句柄、绝对机器路径或 token 写进可分享画板。

## 桥协议

渲染器 → Host 使用 JSON-RPC 2.0（WebSocket，loopback）：

| 方法 | 用途 |
|---|---|
| `bridge.authenticate` | 首条消息，token 认证 |
| `app.info` | 产品/模式/版本 |
| `languages.list` | 语言包 manifest |
| `workspace.list/readText/writeText` | 文件列表与文本读写 |
| `boards.load/save` | 手绘画板 |
| `debug.start/stop/continue/step/pause` | 会话控制 |
| `debug.stackFrames/scopes/variables` | 缓存/懒加载读取 |

Host → 渲染器使用 JSON-RPC 通知：

- `debug.event`：`runStarted` / `threadAdded` / `threadStopped` / `threadResumed` / `framesLoaded` / `runEnded`；
- `console.line`：有界控制台输出。

桥只接受 allowlist 方法；`bridge.authenticate` 之前不能调用其他方法；错误 token 关闭连接。当前 `ScriptedDapAdapter` 不执行用户代码。

## 真实适配器接入点

1. 在 `languages/<id>/manifest.json` 声明 adapter、扩展名、launch 模板与状态。
2. 实现受信 `ExecutionSupervisor`（Windows Job Object / Linux cgroup 或等效），并让 `ExecutionPolicy.enforces()` 只在真实限制生效时返回 `True`。
3. 用 supervisor 启动 adapter，把双向字节流交给 `DapSession`；不要暴露原始 DAP 给 renderer。
4. `DemoDebugService` 保留为演示/回归；真实服务应与它共享归一化事件结构。
5. 每个适配器单独记录 capabilities、错误路径、断点位置、变量分页和清理证据；不能用 Python 成功代替其他语言。