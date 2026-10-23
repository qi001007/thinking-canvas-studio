# src backlog

- [x] 建立 StudioApp、Topbar、FileSidebar、Inspector、Timeline、ConsolePanel。
- [x] Monaco 编辑、语法高亮、断点 gutter、当前行、Ctrl+S；裁剪 Monaco 语言包，主包约 3.0 MB。
- [x] SceneCanvas 自动适配、卡片/边、差异高亮、手绘拖动；手绘工具新增卡片。
- [x] HostClient：DemoHost 与 WebSocketHost；桌面 bridge_info 等待；`__studioBridge` 仅测试注入。
- [x] 手绘模式隐藏调试面板/控制台，检查器只显示手绘对象。
- [x] 桌面“真实运行”按钮：原生确认 → WS `debug.startReal` → 真实调试标记/变量/画布。
- [x] 函数工作台入口、静态度量/结构视图、结构/运行切换；保存后画布更新。
- [x] 帧轴时间线（滑块、500 帧上限）。
- [ ] 真实窗口 IME/DPI/快捷键；运行中改断点；LSP；完整手绘笔迹/连线/文本。
- [ ] 真实 adapter 的懒加载变量树与 Watch/REPL。- [x] 静态结构 BFS 布局/边标签/最小 68% 缩放；静态视图隐藏空检查器。
- [x] 完整运行入口/调试运行入口；时间线播放/暂停/0.5–4× 调速；回放按帧刷新画布。
