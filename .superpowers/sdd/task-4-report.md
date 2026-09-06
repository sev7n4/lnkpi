# Task 4 报告：Runtime POST /v1/runs/cancel

## 提交

- `4fc2f8f feat(runtime): POST /v1/runs/cancel for product_visual`

## 实现结果

- 新增 `CancelRunRequest` 与 `cancel_run(...)`。
- `request_cancel` 始终先设置线程取消标记；空 checkpoint、缺少 flow 或非 `product_visual` 返回 `ok: true`、`skipped: true`、`reason: flow_not_supported`。
- Product Visual checkpoint 会统计完成数与总任务数，对未完成且有 `node_id` 的生成执行 best-effort `cancel_generation`，随后持久化 `phase=cancelled`、`run_cancelled=true` 与取消展示文案。
- 已取消 checkpoint 幂等返回，不重复调用远端取消。
- 新增带 `x-lnkpi-service-token` 鉴权的 `POST /v1/runs/cancel`，测试通过 monkeypatch 对齐 `settings.effective_runtime_auth_token`。
- `astream` 每轮 update 后检查取消标记，持久化 cancelled checkpoint，发送 `run_cancelled` 事件并退出流循环。

## TDD 证据

### RED

`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -p pytest_asyncio.plugin tests/test_runs_cancel_api.py -v`

首次运行在收集阶段失败：`ImportError: cannot import name 'CancelRunRequest' from 'app.runs'`，证明新增接口测试在实现前确实失败。

### GREEN

同一定向命令最终退出码 0：`2 passed`。

覆盖：

- 空 / 非 PV checkpoint 的 flag、skip 响应和重复请求幂等性；
- PV checkpoint 的 pending node 取消、完成/总数统计、cancelled 状态写入和重复请求不重复取消。

## 回归验证

`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -p pytest_asyncio.plugin tests/test_runs_stream.py tests/test_health.py tests/test_gen_scheduler_cancel.py -v`

退出码 0：`7 passed`。覆盖既有 NDJSON 流、运行时鉴权以及 Task 3 scheduler/gen_node 协作取消。

测试仅出现既有 Pydantic、Starlette 与 pytest-asyncio 弃用警告。

## 关注项

- Runtime cancel 路由在生产调用中没有用户身份，按 brief 仅注入 checkpointer；活跃任务依赖已设置的 cooperative cancel flag 在 gen scheduler/node 边界停止。传入 `nest`（测试/DI）时会立即 best-effort 调用远端 cancel。
- 已完成 brief 中可选的 `astream` 取消事件发送；现有 stream smoke test 回归通过。

## Review findings 修复（2026-09-06）

- 非 PV / 空闲未知 flow 返回 `flow_not_supported` 且清除遗留 flag；流内仅对 `flow_mode=product_visual` 执行取消收口。
- cancel endpoint 通过现有线程锁探测区分活跃与空闲：持锁 PV 仅设置 cooperative flag，不调用 `aupdate_state` 或远端取消；空闲 PV 持锁完成远端 best-effort cancel 与 checkpoint 写入后清除 flag。
- 未注入 Nest 且有 `session_id` 时构造并关闭生产 `default_nest`；`completed_tasks` 在 HTTP/SSE 统一使用 `gen_completed_keys` 数量；空白 `thread_id` 校验拒绝。
- RED：新增断言在旧实现下为 `5 failed`（sticky flag、忙锁竞态、流清理、空白 ID）。
- GREEN：`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest -p pytest_asyncio.plugin tests/test_runs_cancel_api.py -v` → `7 passed, 1 warning`。
- 语法：`python3 -m py_compile app/runs.py tests/test_runs_cancel_api.py` → exit 0。
- 仓库门禁：Prisma generate、`pnpm build` 均通过；`pnpm --filter @lnkpi/agent test` → `19 files / 124 tests passed`。
- 扩展回归：`tests/test_runs_stream.py` 与 3 个 scheduler cancel 测试通过；`tests/test_thread_busy.py` 两个既有测试单独复跑仍在进入 fake LLM 前的 5 秒等待点超时（`2 failed, 1 passed`），未修改该测试或其前置运行路径。

## Critical/Major follow-up（2026-09-06）

- `gen_scheduler` 与 `gen_node` 仅在 `flow_mode == "product_visual"` 时消费 cooperative cancel；scheduler 将 `flow_mode` 透传给 fan-out worker，campaign/atomic 不再进入 cancelled 分支。
- stream 遇到未设置或非 PV flow 时立即 `clear_cancel(thread_id)`；PV cancelled checkpoint 使用 `peek_cancel_reason(thread_id) or "user"` 保留请求原因。
- 无 Nest/session 且本地线程未活跃时不再留下 cancel flag；锁探测异常、非 PV skip、checkpoint 写入异常路径都会清理无法保证被消费的 flag。
- RED：新增 scheduler payload/campaign、gen_node campaign、unknown idle flow、stream missing/campaign flow 与 cancel reason 断言；旧实现首先在 scheduler payload 断言以 `KeyError: flow_mode` 失败。
- GREEN：定向测试 `tests/test_gen_scheduler_cancel.py tests/test_runs_cancel_api.py` → `15 passed, 1 warning`。
- 覆盖回归：`tests/test_runs_cancel_api.py tests/test_runs_stream.py tests/test_gen_scheduler_cancel.py tests/test_gen_scheduler.py tests/test_gen_node.py` → `33 passed, 2 warnings`。
- 语法检查：`python3 -m py_compile app/runs.py app/graph/nodes/gen_scheduler.py app/graph/nodes/gen_node.py tests/test_runs_cancel_api.py tests/test_gen_scheduler_cancel.py` → exit 0。
- 仓库门禁：`pnpm install --frozen-lockfile`、Prisma generate、`pnpm build` 均 exit 0；`pnpm --filter @lnkpi/agent test` → `19 files / 124 tests passed`。
