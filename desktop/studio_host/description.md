# studio_host

本包定义桌面宿主的最小安全边界：抽象端口、默认拒绝的短期 session grant 策略、DAP Content-Length 增量帧处理，以及 JSON-RPC 2.0 allowlist/响应 ID 校验。grant 发行时复制操作集合；launch/attach 仅允许绑定一次会话，step/continue 等已授权会话操作可重复，disconnect 后关闭会话；授权返回请求实际预算，而 grant 中的资源限制只是上限。宿主强制 stop/cleanup 必须走不受 grant 过期阻塞的可信宿主控制路径，不能统一经由 `authorize`；当前尚无 runtime 或 cleanup 实现。DAP 输入按 receive chunk 限长，调用方必须遵守该上限。桥接模块只校验 envelope，不派发请求，也不实现 request-id 幂等。模块不监听端口、不启动适配器、不执行用户代码。Windows Job Object 与 Linux cgroup 等强制资源限制尚未实现，因此默认策略不会放行执行。
