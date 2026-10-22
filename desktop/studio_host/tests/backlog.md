# tests backlog

- [x] `test_execution_policy.py` 覆盖缺失/伪造 grant、工作区/适配器/版本/操作/config 不匹配、过期、超限及无强限制拒绝；另覆盖不可变操作集、start 仅成功后绑定一次、session 操作重复和审批/supervisor 必须返回 literal `True`。
- [x] `test_dap_framing.py` 覆盖 UTF-8 字节分片、半包/粘包、受限 receive chunk、非法头/长度/JSON、非有限值/重复键/deep recursion、限额类型及编码失败。
- [x] `test_bridge_contract.py` 覆盖 schema、未知/禁止方法、响应 ID 匹配/重复 pending ID，以及拒绝 notification。
- [x] 验证命令：Python 3.11 `python -m unittest discover -s studio_host\\tests -v`，34 项通过；没有启动适配器或用户脚本。
- [x] 增加较低请求预算回归，确认授权结果携带实际请求预算；添加测试包初始化以支持 root discovery。
