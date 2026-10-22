# 验证记录

日期：2026-10-23。环境：Windows，Node 24.12.0，npm 11.6.2，Python 3.11.4。TypeScript 5.9.3已锁定。

## 本轮验证

| 检查 | 结果 | 意义 |
|---|---|---|
| npm run typecheck | 通过 | 纯TS模块的严格类型检查 |
| npm test | 16项通过 | Node直接运行node:test测试，覆盖生命周期/回包/投影/快照边界 |
| python -m unittest discover -s desktop/studio_host/tests -t desktop -v | 35项通过 | 标准库policy/codec/RPC边界，不启动目标程序 |
| 旧版工作区/关键文件哈希 | 保留 | 起始Git干净、exe对齐Release，交付再复核；legacy-baseline.json |
| 每个维护目录description/backlog | 已检查 | node_modules/Git/构建目录不计 |
| 真实适配器/桌面UI/进程限额 | 未执行 | 尚无实现；不以test double为运行证据 |

## 检查覆盖的实际风险

- resume、不同session/run、选帧变化和部分继续时，旧句柄/回包失效。
- 全停期间新增线程使旧快照不可继续inspection；UI缺少状态或能力时默认禁用。
- trace移除活句柄、复制输入而不冻结调用方数据；手绘事实源独立。
- 标量留变量表；别名必须有collector证据且保留每个变量名；布局不随执行行/列表重排跳动。
- 场景节点、访问量、深度限额产生显式partial；运行态不投射陈旧frame。
- 授权必须由可信host审批范围签发；可变set不能签发后扩权；launch/attach只绑定一次；不同会话/配置/预算/到期均拒绝。
- DAP Unicode按字节长度；分片/粘包；超长header/body/chunk；非法JSON/重复键/非有限数/递归错误；失败decoder不可继续复用。
- JSON-RPC未知方法、grant方法、非法ID/response、重复pending ID/notification明确拒绝。未实现request dispatch与入站幂等。

## 过程限制与已纠正问题

Node测试运行器默认使用子进程，在当前沙箱触发spawn EPERM；测试命令改为Node直接执行测试入口，实际16项测试完整执行，未将环境错误归为产品bug。

Python最初从仓库根目录带top-level发现测试时缺tests包初始化；已加__init__.py并重跑README命令通过。

未安装Monaco、pywebview新版本、LSP、debugpy新版本、Java或GDB；只安装TypeScript开发依赖。未运行用户代码、未训练、未执行任何真实调试fixture。

## 发布声明边界

可声明“有可交接、经单元测试的底座”。不可声明“IDE已可用”“四语言已支持”“完整内存追踪”“桌面视觉通过”或“沙箱已实现”。
