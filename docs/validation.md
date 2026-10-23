# 验证记录

日期：2026-10-23。环境：Windows，Node 24.12.0，npm 11.6.2，Python 3.11.4，Edge 155（无头 CDP），pywebview 6.2.1，websockets 17.1，debugpy 1.6.7。

## 本轮验证

| 检查 | 结果 | 意义 |
|---|---|---|
| `npm run typecheck` | 通过 | React/TS/Monaco 严格类型检查 |
| `npm test` | 19 项通过 | 生命周期、投影、卡片、单元格 diff、手绘步骤、预算 |
| `python -m unittest discover -s desktop/studio_host/tests -t desktop -v` | 56 项通过 | 策略、DAP 帧、桥、工作区、语言包、脚本 DAP、WS、真实 debugpy、100,000 项变量分页/求值、Job Object 超时、静态分析/工作台、TS 分析、自动记录 |
| `npm run build` | 通过 | Monaco 主索引约 3.09 MB，gzip 约 820 KB |
| `python desktop/app.py --smoke` | 通过 | 桥端口、工作区 3 个文件、app.info |
| 浏览器 1680×1050（无头 Edge + CDP） | 通过 | Monaco、卡片、变量树、时间线、步过差异、手绘加卡/记录 |
| 浏览器 → Python WS 桥 → 脚本 DAP | 通过 | `debug.start`、`framesLoaded`、`debug.step`；epoch 1→3；seen 数据更新 |
| 真窗口 pywebview（隐藏） | 加载 + 原生确认 + 真实运行通过 | WebView2 加载 dist；bridge_info；原生确认框点击“确定”；debugpy 停点/步过；4 张卡片、真实变量；IME/DPI/快捷键/崩溃恢复未验收 |
| 真实 debugpy | 通过 | fixture 断点、locals、list 子项、单步 total 0→1、停止清理；Job Object 限额；真实 UI 步过后 `seen={5:0}`、行 7→8 |
| 函数工作台 + 静态结构 | 通过 | 干净工作台 2 个静态节点；保存 `TensorPath` 类后 12 节点/20 关系；类/字段/方法/参数/循环/调用出现 |
| 静态图三视图 | 通过 | 最终构建 + 全新 Python 桥 + 无头 Edge 1680×1050：总览 9 卡 @62%、类结构 6 卡 @100%、类数据 4 卡 @100%、方法结构 7 卡 @87%；卡片边界在画布内 |
| TS/JS 静态图 | 通过 | `fixture.ts` 总览 3 卡、结构 8 卡；使用 TypeScript compiler API；非 Python 真实运行按钮禁用 |
| 大文件渐进展开 | 通过 | `static_analysis.py`：总览 11 节点 @50%、类结构 17 卡 @73%、类数据 17 节点，coverage partial；聚焦方法可继续查看 |
| 变量分页 / Watch / REPL | 通过 | 真实 debugpy `main.py:7`：Watch `len(nums)=1000`，REPL 返回 `1000`，`nums` 从 100 项加载到 151 项；截图 `docs/screenshots/debug-watch.png` |
| 100,000 项数组 | 通过 | 首批 100 项；`debug.variablesPage` 从第 100 项继续返回 5 项；`len(nums)=100000`，不一次性渲染完整数据 |
| 帧轴时间线 | 通过 | Demo 步过后 2 帧、滑块当前值 1；500 帧上限 |
| 完整运行记录 | 通过 | fixture 自动记录 12 帧，包含循环行 3/4、函数行 2/5、测试行 8/9；自动继续到结束 |
| 回放 | 通过 | 时间线播放按钮从帧 0 开始，1.2 秒后滑块移动、暂停可用；速度选项 0.5–4× |
| Job Object wall timeout | 通过 | 1 秒限额终止目标；测试使用自含 fixture |
| GDB/JS/Java 调试 | 未执行 | 只有语言 manifest；TS/JS 已接静态图但仍未接 js-debug；每种语言单独验收 |
| 用户代码执行 | 未执行 | 脚本化适配器；没有启动目标进程 |

## 本轮的判定边界

- 浏览器预览的“脚本演示”是脚本化 DAP 数据；桌面窗口的“真实运行”是 debugpy。
- 浏览器通过不等于 pywebview 窗口通过；隐藏窗口真实运行 + 原生确认框自动点击通过，但 IME/DPI 与人工操作仍未验收。
- 手绘编辑器只有基础卡片/拖动/步骤；旧版笔迹/连线/文本能力未移植。
- 静态 AST 是启发式；大型类/递归/跨文件图用聚焦、成员上限和 `partial` 兜底，尚未自动聚合；工作台运行会执行源文件顶层代码。
- 静态图三视图有阅读上限（总览 18 符号、类 6 字段 + 6 方法、类数据 12、方法 36）；隐藏的成员仍可在聚焦列表中选择。
- TS/JS 只用 TypeScript compiler API 做单文件静态分析；没有类型检查、跨文件解析或运行时数据。
- Watch/REPL/分页求值会执行用户代码；真实运行的原生确认已明确包含该授权，记录模式禁用 Watch。
- 列表/数组的后续分页通过 `evaluate` 切片读取；字典/集合在 DAP 不支持分页时会拒绝继续，不会重复返回第一页。
- 画布仍是平铺栈帧卡/变量卡，函数大方框和语义边尚未实现。
- 运行中修改断点尚未同步；断点只在启动时下发。
- 连续运行中的每次赋值没有采集；只保存已发生的暂停快照。
- 没有 Windows Job Object 或原生确认时，真实运行不放行；Linux 监管未实现。

## 已覆盖的失败路径

- 继续/新停点后旧句柄与旧回包失效；跨 run/session 事件被拒。
- 全停期间新增线程使旧快照不可继续 inspection。
- DAP 半包/粘包/UTF-8/超长头体/非法 JSON/重复键/非有限数/递归错误。
- WS 错误 token 关闭；未授权 Origin 拒绝；未知方法/参数错误。
- 工作区目录穿越、盘符、绝对路径、超大文本、坏 boards JSON。
- 画布预算截断、无证据不画 alias、标量不进画布。

## 发布声明边界

可声明：**Python 工作台 + 三视图静态结构图（Python/TS-JS）+ 真实 debugpy 调试 + 完整运行记录/回放在 Windows Job Object 限额下可用；底座、脚本演示与桥均经测试。** 不可声明：C/C++/TS/Java 调试已可用、静态图覆盖完整大文件/跨文件、IME/DPI 已验收、完整内存/张量追踪、文件/网络沙箱已实现、自动记录覆盖跨文件调用。