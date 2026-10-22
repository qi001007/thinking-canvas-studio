# 给下一位实现者

## 先读

README → 实时进度 → architecture → vscode-debug-contract → 当前spike。不要把整个legacy仓库加入新任务上下文；需要视觉细节时按 legacy-visual-contract 的路径只读查阅。

## 目录与所有权

```text
Thinking-Canvas-Studio/
  frontend/
    domain/          最小调试/快照/Scene数据契约
    application/     DebugModel、DebugViewModel、纯端口
    canvas/          投影、手绘/trace文档隔离
    presentation/    面板DTO、能力与状态门控、legacy tokens
    tests/           生命周期/投影/持久快照回归测试
  desktop/
    studio_host/     Python授权策略、DAP帧、桥契约、host端口
      tests/         纯标准库测试，不启动目标程序
  docs/              产品、契约、源码索引、架构、计划、进度、反馈
  package.json       仅TypeScript开发依赖
  tsconfig.json      严格类型检查；无产品构建流程
```

当前不建几十个空插件包。renderer、语言包、spikes目录按验证任务逐个增加；每个实际维护目录加description/backlog。

## 当前可接入的接口

- DapClient只是端口；实现时用线程上下文请求stack，再用frame请求scopes，再用variablesReference分页请求变量，不能先有frame才能取stack。
- Broker输入只接受定义的方法与schema；不要暴露“任意命令/任意DAP/任意路径”。
- UI状态集中在ViewModel；模型只处理运行事实和当前有效数据；保持晚回包拒绝行为。
- Scene的layout key与对象identity不同。当前合并/连线只接受显式collector证据；不要用正则解析repr猜地址。
- Python GrantAuthority只有host接收真实用户批准后可签发；ApprovalVerifier/Supervisor都是可信依赖，不能由renderer替换。
- 当前只实现最小JSON-RPC request/response校验和DAP byte framing。没有request dispatcher、socket或子进程启动器。
- 手绘Scene尚无完整pen/text/shape编辑语义。纯手绘能力是后续产品工作，不能说已恢复旧画布。

## 接下来的第一个任务

执行spike S1/S1b：Monaco + pywebview本地窗口，沿用tokens，验证worker/IME/快捷键/性能。先静态编辑，之后才请求S2/S9/S3所需的真实运行授权。不要直接堆完整IDE、四语言或动画。

## 交接验收

- 跑README里的全部底座验证；新缺陷补针对性回归。
- 真实浏览器/桌面验收与纯单测分开报告；不以mock替代adapter日志。
- 记录版本、机器、fixture、命令、截图、数值；每个步骤更新实时进度和反馈。
- 使用Luna实现，Sol审查架构。若模型不能自行切换，委派Luna子代理并审查结果。
