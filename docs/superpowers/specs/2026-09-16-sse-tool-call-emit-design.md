# Explore SSE `tool_call` 漏报 — 工具循环观测契约

> 日期：2026-09-16  
> 状态：**已批准**（补丁版 C：循环 emit + `_emit` helper；不包 `_call_inner`）  
> 产品：超创平台（lnkpi）无限画布 / Agent Runtime  
> 父规格：[2026-09-14-agent-atomic-as-tools-design.md](./2026-09-14-agent-atomic-as-tools-design.md)（V2 / §6.0.2 B9）  
> 前置：[2026-09-16-agent-bare-gen-propose-bind-design.md](./2026-09-16-agent-bare-gen-propose-bind-design.md)（#349；画布 pending 已通、SSE 名仍空）  
> 实现 plan：[../plans/2026-09-16-sse-tool-call-emit.md](../plans/2026-09-16-sse-tool-call-emit.md)

---

## 0. 决策摘要

| # | 决策 |
|---|------|
| **TC-D1** | 根因：explore LLM 循环与 mandatory `_invoke_tool` 本地 `ainvoke`，**从不** `emit({type: tool_call})`。`NestEventProxy` 只转发 `canvas_action` / `node_status`。Nest `streamFromRuntime` **原样** yield NDJSON；`TRACE_PERSIST` 与前端已认 `data.name`。不是 Nest 丢事件，不是 bind 失败。 |
| **TC-D2** | 方案 **补丁版 C**：观测语义是「工具循环决定调用 `name`」，不是「Nest HTTP 发生了」。共享 `maybe_emit_tool_sse`，只在 explore LLM 循环与 `_invoke_tool` 调用。 |
| **TC-D3** | **禁止** `NestEventProxy._call_inner`（及显式写方法）自动包 `tool_call`。禁止用 `canvas_action` 反推工具名去让 P7 变绿。 |
| **TC-D4** | 载荷钉死：`tool_call` 在 `ainvoke` **之前**；`tool_result` 在返回之后（含 unknown tool / error dict）。`name` 不过滤（含 `tool_search` 与若被调用的 `run_*`）。 |
| **TC-D5** | `arguments` / `result` **截断**（§2.1）。emit 失败 **不得** 打断工具。sink 缺 `_emit` 或非 awaitable → no-op（兼容 MagicMock nest 单测）。 |
| **TC-D6** | **不改** H8、**不改** V2 P7 脚本判定、不改 bind / 窄集 / 系统提示、不改前端解析。`make_explore_node(llm, nest)` 签名不增加第三参数。 |
| **TC-D7** | 修订 bind **BG-D6** 跟进假设：bind 绿且画布 pending、SSE `tools=[]` → **先修本档**。单测证明会 emit 而生产仍空，才开 prompt/模型切片。本 PR **不做** 模型切片、**不做** mandatory 出图直调。 |

### 金标句（与 bind 相同）

> 帮我生成一张蓝色天空产品主图

### 非目标

- 2d.4 删 `LEGACY_LANE_SHIM`、Phase 3  
- 扩大默认窄集、mandatory 生成直调、`run_*` 进 visible  
- 弱化 P7 / 用 H8 代替 V2  
- prompt / 模型切片、前端改 `tool_call` 解析  
- Nest HTTP 级 tracing、给 `NestEventProxy` 新增 public `emit_tool_call` API  

---

## 1. 背景

生产 V2（#349 后）金标句：`flow_mode=canvas_agent`，画布出现 `pending_confirm`，SSE `tools=[]`。P7 读 `et == "tool_call"` 且 `data.name|tool|toolName`。侧栏 `applyToolCall` 只用 `data.name`；无 `tool_call` 时执行轨迹显示「没动手」，画布已经摆了待确认节点。

这是 **轨迹撒谎**，不是出图失败。`canvas_action` 仍是突变 SSOT；`tool_call` 是「agent 选了哪个工具」的契约，供 P7、`TRACE_PERSIST`、侧栏三方共用。

---

## 2. 钉死规则

### 2.1 Helper（新文件）

路径：`services/agent-runtime/app/graph/tool_sse.py`

```
maybe_emit_tool_sse(sink, event) -> None
```

- `emit = getattr(sink, "_emit", None)`；非 callable 则 return。  
- `out = emit(event)`；仅当 `inspect.isawaitable(out)` 才 `await out`。  
- **任何**异常吞掉（`logger.debug` + `exc_info`），不向上抛。  
- 不读 `sink.emit_tool_call`；不改 `NestEventProxy.__getattr__` / `_call_inner`。

`cap_tool_sse_payload(value, *, kind: "arguments" | "result") -> Any`：压成 JSON 兼容对象，再 `json.dumps` 的 **UTF-8 字节 ≤ 2048**（常量 `TOOL_SSE_MAX_JSON_BYTES = 2048`）。

截断算法（唯一）：

1. `kind="result"` 且 value 为 `dict`：只保留键 `ok`、`error`、`error_type`、`status`、`userMessage`、`node_id`、`nodeId`、`retry_hint`（有则抄，无则省略）；`userMessage` / `error` 字符串再切到 200 字符。  
2. `kind="result"` 且非 dict：`{"repr": str(value)[:200]}`。  
3. `kind="arguments"`：非 dict 当 `{}`；dict 原样进入步骤 4（不做键白名单）。  
4. `json.dumps(..., ensure_ascii=False, default=str)` 得 `s`；若 `s.encode("utf-8")` 长度 > 2048，改为 `{"_truncated": true, "preview": ...}`，并缩短 `preview` 直到 **返回值** 再 `json.dumps` 的 utf-8 长度 ≤ 2048。

### 2.2 挂点与顺序

**Explore LLM 循环**（`nodes/explore.py`，现 ~255–288）：对每个 `tc`：

1. `await maybe_emit_tool_sse(nest, {type: tool_call, data: {name: str(name), arguments: cap(args or {})}})`  
2. 现有 `ainvoke` / unknown / except（逻辑一字不改）  
3. `await maybe_emit_tool_sse(nest, {type: tool_result, data: {name: str(name), result: cap(result)}})`  
4. 其后 `extract_canvas_commands` / `ToolMessage` 不变  

未知工具、异常结果也走 1 和 3。`get_canvas_summary` **不**走 helper。

**Mandatory**：`run_mandatory_explore(..., event_sink: Any | None = None)`；`_invoke_tool` 与 `_mandatory_ui` / `_mandatory_lifecycle` / `_mandatory_asset` 增加同名可选参数，默认 `None`，原测试不传仍合法。explore 调用 mandatory 时 `event_sink=nest`。`_invoke_tool` 在 `ainvoke`（或 unknown 赋值）前后同样 1 / 3。

既有 `run_mandatory_explore(...)` 测试不传 `event_sink` 必须仍绿（T4）。

### 2.3 载荷（钉死）

```json
{"type": "tool_call", "data": {"name": "<tool>", "arguments": {}}}
{"type": "tool_result", "data": {"name": "<tool>", "result": {}}}
```

- `name` 用循环里的工具名（LLM `tool_calls[].name` 或 mandatory 传入的 `"undo"` 等）。  
- P7 只读 `tool_call` + `name`；`arguments` 不得为 P7 门禁。  
- 不把 `canvas_action` 改写成 `tool_call`。  
- 不按名字过滤 `run_*`。

Nest 与前端 **零改动**：`AgentStreamEvent` 已含两类型；`TRACE_PERSIST` 已含；`applyToolCall` 已读 `data.name` / `data.result`。

### 2.4 测试文件

| 文件 | 责任 |
|------|------|
| `tests/test_tool_sse.py` | helper：截断、MagicMock sink 不抛、非 awaitable no-op、emit 抛错不传播 |
| `tests/test_explore_tool_sse.py` | 假 LLM 先 `upsert_media_node` 再 `propose_generation`；`nest._emit` 捕获顺序与名字（T1）；读摘要不出现 `tool_call`（T2） |
| `tests/test_explore_mandatory.py`（追加） | 传带 `_emit` 的 sink，undo 路径至少一条 `tool_call` name=`undo`（T3）；不传 sink 既有测仍绿（T4） |

**禁止修改：** `deploy/prod-phase-2d3-h8-verify.py`、`deploy/prod-phase-v2-bare-gen-verify.py`。

---

## 3. 验收硬表

| ID | 检查 | 唯一期望 |
|----|------|----------|
| **T1** | 假 LLM：upsert 再 propose | 两条 `type=tool_call`，名字与顺序对；各有对应 `tool_result` |
| **T2** | explore 开头 `get_canvas_summary` | **无** `tool_call` |
| **T3** | mandatory undo + `event_sink` | ≥1 条 `tool_call` 且 `name=undo` |
| **T4** | MagicMock nest / 不传 `event_sink` | 工具成功，既有 mandatory 测绿 |
| **T5** | `cap_tool_sse_payload(..., kind="result")` 超大 dict | 输出再 dumps 的 utf-8 ≤ 2048；含 `_truncated` 或已裁键 |
| **P7** | 生产现有 V2 脚本 | **一字不改**必须绿：upsert 后 propose + pending + 无 `run_*` |

合入后判责：T1 绿且 P7 `tools=[]` → Nest 丢事件或模型未调（本档范围外）。T1+P7 均绿 → 关闭漏报。仍无 pending → 回到 bind，不是本档。

---

## 4. 回滚

删除 `tool_sse.py` 与两处 `maybe_emit_tool_sse` 调用（及 `event_sink` 参数）即回到漏报前；画布突变与 bind 不受影响。

---

## 5. 后续（未授权）

- T1 绿、P7 仍空 → Nest 丢事件排查，或 prompt / 模型切片  
- regen 同会话 propose  
- 确认后真出图（2c）  

---

## 6. 自检（写档时）

- [x] 无 TBD 阻塞合入；plan 文件名已预留，不在本档范围  
- [x] C 与「禁止 `_call_inner`」不矛盾；helper 只碰 `_emit`  
- [x] MagicMock / emit 失败 / 截断均有可测规则  
- [x] 未改 H8 / P7 脚本 / 前端 / bind；未滑入 2d.4 / Phase 3 / 模型切片  
- [x] 金标句与 P7 成功标准与 bind 档一致  
