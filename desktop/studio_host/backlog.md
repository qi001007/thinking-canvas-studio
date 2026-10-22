# studio_host backlog

- [x] 添加 `ports.py`：ExecutionSupervisor、AdapterTransport、WorkspaceStore 与资源上限数据契约。
- [x] 添加 `execution_policy.py`：短期随机 session grant 绑定规范工作区、适配器身份/版本、不可变操作集、配置 SHA-256 与正向资源上限；launch/attach 一次绑定，会话操作可重复，disconnect 关闭会话。发行要求可信宿主审批收据校验器。无校验器或没有 OS 强制能力的 supervisor 时拒绝；grant 发行器不得暴露给桥接层。
- [x] 添加 `dap_framing.py`：UTF-8 JSON、Content-Length 增量解码与编码，覆盖半包/粘包、单次 receive chunk/头/体大小限制、非有限数/重复键拒绝及协议错误；坏帧后 decoder 失效。
- [x] 添加 `bridge_contract.py`：JSON-RPC 2.0 请求 schema、显式方法 allowlist、禁止桥接自授 grant、响应 ID 匹配；仅 envelope 校验，不提供 request dispatch 或 request-id 幂等。
- [x] 增加纯标准库 `unittest` 自测；假 supervisor 只验证策略分支，不启动或监管进程。
- [x] 独立 review 回归：可变 scope 输入、session 绑定/重复会话操作、JSON-RPC 重复待响应 ID/notification、DAP 超大 chunk/超长长度/非标准 JSON/deep recursion，以及 bool/type 边界。
- [x] 根级 unittest discovery 所需的 `tests/__init__.py`；授权成功时返回经 supervisor 检查且不超过 grant 上限的实际请求预算。
- [x] 文档约束：可信宿主的强制 stop/cleanup 不得因 grant 到期而被 `authorize` 阻塞；runtime 尚未实现。
- [ ] 后续实现 OS 级 timeout kill、内存/CPU/进程数限制前，不得把 `enforces()` 报为成功；当前没有真实 supervisor 实现。
