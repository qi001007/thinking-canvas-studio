# 验证记录

日期：2026-10-23。环境：Windows，Node 24.12.0，npm 11.6.2，Python 3.11.4，Edge 155（无头 CDP），pywebview 6.2.1，websockets 17.1。

## 本轮验证

| 检查 | 结果 | 意义 |
|---|---|---|
| `npm run typecheck` | 通过 | React/TS/Monaco 严格类型检查 |
| `npm test` | 19 项通过 | 生命周期、投影、卡片、单元格 diff、手绘步骤、预算 |
| `python -m unittest discover -s desktop/studio_host/tests -t desktop -v` | 46 项通过 | 策略、DAP 帧、桥、工作区、语言包、脚本 DAP、WS 集成 |
| `npm run build` | 通过 | Monaco 主包约 3.0 MB，gzip 约 0.8 MB |
| `python desktop/app.py --smoke` | 通过 | 桥端口、工作区 3 个文件、app.info |
| 浏览器 1680×1050（无头 Edge + CDP） | 通过 | Monaco、卡片、变量树、时间线、步过差异、手绘加卡/记录 |
| 浏览器 → Python WS 桥 → 脚本 DAP | 通过 | `debug.start`、`framesLoaded`、`debug.step`；epoch 1→3；seen 数据更新 |
| 真窗口 pywebview（隐藏） | 基础加载通过 | WebView2 加载 dist；bridge_info 注入；4 张卡片；IME/DPI/快捷键/崩溃恢复未验收 |
| 真实 debugpy/GDB/JS/Java | 未执行 | 没有受信 supervisor；默认拒绝 |
| 用户代码执行 | 未执行 | 脚本化适配器；没有启动目标进程 |

## 本轮的判定边界

- 界面里的“脚本演示”是脚本化 DAP 数据；不是真实语言调试。
- 浏览器通过不等于 pywebview 窗口通过；桌面壳代码已写，但未做本轮真窗验收。
- 手绘编辑器只有基础卡片/拖动/步骤；旧版笔迹/连线/文本能力未移植。
- 连续运行中的每次赋值没有采集；只保存已发生的暂停快照。
- 没有 supervisor，因此“运行”不会执行用户代码。

## 已覆盖的失败路径

- 继续/新停点后旧句柄与旧回包失效；跨 run/session 事件被拒。
- 全停期间新增线程使旧快照不可继续 inspection。
- DAP 半包/粘包/UTF-8/超长头体/非法 JSON/重复键/非有限数/递归错误。
- WS 错误 token 关闭；未授权 Origin 拒绝；未知方法/参数错误。
- 工作区目录穿越、盘符、绝对路径、超大文本、坏 boards JSON。
- 画布预算截断、无证据不画 alias、标量不进画布。

## 发布声明边界

可声明：**有可运行、经单测与浏览器/桥链路验证的底座。** 不可声明：真实 Python/C/C++/TS/Java 调试已可用、pywebview 真窗口已验收、完整内存/张量追踪、沙箱已实现。