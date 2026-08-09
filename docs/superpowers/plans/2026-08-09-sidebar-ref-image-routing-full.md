# Agent 侧栏引用生图路由 — 全量实施计划（P0 + P1 + P2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [design spec](../specs/2026-08-09-sidebar-ref-image-routing-design.md) 完成 P0 止血、P1 Route Unification 架构收敛、P2 执行层对齐；修复 `@T1 请按风格3出图` 及同类路由/clarify 断裂，建立 Cascade Router + precedence 表 + eval 契约，禁止再堆 hint 表。

**Architecture:** P0 在现有 `decide_route` 上叠 IR 扩展、ref fast path、统一 `clarify_context`；P1 引入 `route_features` + `route_precedence` + `clarify_gate`，`decide_route` 瘦身为 orchestrator；P2 统一 `GenerationRequest` 与 IR slots。LLM 仅 L2 parse，L0 无 LLM。

**Tech Stack:** Python 3.11+, LangGraph, pytest, YAML eval sets (`eval-route-set.yaml`, `eval-intent-set.yaml`), `deploy/prod-*-verify.py`

**Spec:** [2026-08-09-sidebar-ref-image-routing-design.md](../specs/2026-08-09-sidebar-ref-image-routing-design.md)

## Global Constraints

- 满足 design §3 全部 `R-*`、§9 全部 `RU-*`、验收 AC-01–AC-07；不得回退 PR #197 video IR
- P0 合并后 **禁止** 向 `MARKETING_HINTS` / `ATOMIC_CREATE_HINTS` 新增 permanent 条目（§9.17）
- route 澄清 follow-up **禁止** default chat（R-CL-05）
- atomic image：`prompt` + `localRefs` 分离（R-ALIGN-01）
- P1 后 `decide_route` **零** substring hint 路由（§9.16）
- 路由 PR 必须附带 `eval-route-set` case 或更新期望（RU-8）
- 工作目录：`services/agent-runtime/`；`pytest tests/ -q` 全绿方可 claim 阶段完成
- 每 Task 结束独立 commit；TDD 顺序：失败测试 → 实现 → 通过

## 文件结构（终态，design §4 + §9.11）

```text
services/agent-runtime/app/graph/
├── atomic_intent_ir.py       # L1 IR SoT
├── route_context.py          # RouteContext 组装
├── route_features.py         # [P1] extract_route_features
├── route_precedence.py       # [P1] apply_route_precedence + RULES
├── route_decide.py           # L0 orchestrator（P1 refactor）
├── clarify_context.py        # [P0/P1] ClarifyContext + pending_clarify
├── generation_request.py     # [P2] GenerationRequest DTO
├── intent.py                 # MARKETING_HINTS（P1c 路由用途删除）
├── atomic_intent.py          # P1c 路由 bool 删除
├── atomic_clarify.py         # → clarify_context 迁移
├── clarify_reply.py
├── nodes/
│   ├── intake.py
│   ├── clarify_route.py      # P0 → P1 委托 clarify_gate
│   ├── clarify_gate.py       # [P1] 统一 clarify
│   ├── clarify_atomic_intent.py  # P1 合并进 clarify_gate
│   └── atomic_parse.py
└── builder.py                # clarify_gate 边

skills/atomic-create/
├── eval-route-set.yaml       # Harness CI
└── eval-intent-set.yaml

deploy/
├── prod-atomic-intent-ir-verify.py
└── prod-route-unification-verify.py  # [P1]
```

---

## 需求覆盖索引

| 规格 ID | Phase | Task |
|---------|-------|------|
| R-IR-01~05 | P0 | T1, T2 |
| R-L1-01~04 | P0 | T3, T4 |
| R-CL-01~05 | P0 | T5, T6, T7, T8 |
| R-ALIGN-01~03 | P0/P2 | T2, T9, T22 |
| R-PARSE-01~02 | P0 | T10 |
| R-UX-01~04 | P0/P1 | T11, T18 |
| RU-1~10 | P1 | T12–T21 |
| AC-01~AC-07 | P0/P1 | T10, T11, T17, T21 |
| Q1–Q5, E1–E10 | 全阶段 | 见上表 |

---

# Phase 0 — 止血（design §0–§8）

> **退出标准：** AC-01–AC-07 全绿；`pytest tests/ -q`；prod style3 case

---

### T1: IR — `出图` / `按风格N`（R-IR-01~04）

**Files:** `atomic_intent_ir.py`, `tests/test_atomic_intent_ir_ref_image.py`

**Produces:** `is_ref_media_generation("@T1 请按风格3出图", ["T1"]) == True`

- [ ] **Step 1:** 写失败测试（`test_has_generate_verb_chutu`, `test_ref_media_generation_t1_chutu`, `test_resolve_atomic_intent_style3`）
- [ ] **Step 2:** `pytest tests/test_atomic_intent_ir_ref_image.py -v` → FAIL
- [ ] **Step 3:** `GENERATE_VERBS` 增 `出图`/`出一张图`/`生成图`；`has_image_output` 增 `出图`/`按风格\d`；`is_ref_media_generation` 前置 T*+出图/风格N 分支
- [ ] **Step 4:** pytest PASS
- [ ] **Step 5:** `git commit -m "feat(agent-runtime): IR 出图/按风格N + T ref media gen"`

---

### T2: `derive_studio_prompt` 保留 utterance（R-IR-05, R-ALIGN-01）

**Files:** `atomic_intent_ir.py`, `tests/test_atomic_intent_ir_ref_image.py`

- [ ] **Step 1:** `test_derive_studio_prompt_keeps_style3_utterance` → FAIL
- [ ] **Step 2:** `derive_studio_prompt`：有 `mentioned_keys` 且 utterance 非仅 `@\w+` → 返回原 utterance
- [ ] **Step 3:** pytest PASS
- [ ] **Step 4:** commit

---

### T3: `出图` demote + `atomic_create_intent` 同步（R-L1-01, R-ALIGN-03, E1）

**Files:** `intent.py`, `atomic_intent.py`, `tests/test_marketing_intent_chutu.py`

- [ ] **Step 1:**

```python
def test_chutu_alone_not_marketing():
    assert not marketing_intent("@T1 请按风格3出图")

def test_chutu_is_atomic_create():
    assert atomic_create_intent("@T1 请按风格3出图")

def test_detail_page_still_marketing():
    assert marketing_intent("帮我做天猫详情页营销方案")
```

- [ ] **Step 2:** 从 `MARKETING_HINTS` 删除 `"出图"`；`atomic_create_intent` 增 `出图|出一张图|生成图` 分支（排除 CONFIRM_GEN）
- [ ] **Step 3:** `pytest tests/test_marketing_intent_chutu.py tests/test_atomic_create_intent.py -q` PASS
- [ ] **Step 4:** commit

---

### T4: L0 `_sidebar_ref_atomic_signal` fast path（R-L1-02~04, E3, E10）

**Files:** `route_decide.py`, `tests/test_route_sidebar_ref_atomic.py`

- [ ] **Step 1:**

```python
CTX = {
    "utterance": "@T1 请按风格3出图",
    "mentioned_keys": ["T1"],
    "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
    "checkpoint": {},
}

def test_style3_routes_atomic():
    d = decide_route(CTX)
    assert d["flow_mode"] == "atomic_create"
    assert d["reason"] == "sidebar_ref_atomic"
```

- [ ] **Step 2:** 实现 `_text_mentioned_keys`、`_sidebar_ref_atomic_signal`；插入 `_sidebar_img2img_signal` 之后；orch 降级块跳过 ref atomic
- [ ] **Step 3:** pytest PASS + `tests/test_route_decide.py`
- [ ] **Step 4:** commit

---

### T5: `clarify_context` 模块 + `pending_clarify`（R-CL-01 基础, E4）

**Files:** Create `clarify_context.py`；Modify `atomic_clarify.py`, `state.py`, `tests/test_pending_clarify.py`

**Produces:** `pending_clarify(state)` 接受 `kind=route_orchestration|atomic_parse|img2img_confirm`

- [ ] **Step 1:** 新建 `clarify_context.py`：

```python
ClarifyKind = Literal["route_orchestration", "atomic_parse", "img2img_confirm"]

class ClarifyContext(TypedDict, total=False):
    kind: ClarifyKind
    original_utterance: str
    clarify_question: str
    mentioned_keys: list[str]
    sidebar_attachment_ref_keys: list[str]
    clarify_kind: str

_VALID_KINDS = frozenset({"atomic_parse", "route_orchestration", "img2img_confirm"})

def pending_clarify(state: dict) -> ClarifyContext | None: ...
def pending_atomic_clarify(state: dict) -> ClarifyContext | None:
    return pending_clarify(state)
```

- [ ] **Step 2:** `atomic_clarify.py` 委托 `clarify_context.pending_clarify`
- [ ] **Step 3:** `state.py` 注释/字段 `clarify_context: dict | None`
- [ ] **Step 4:** `test_pending_route_orchestration` + `test_pending_atomic_parse_still_works` PASS
- [ ] **Step 5:** commit

---

### T6: `clarify_route` 写 checkpoint（R-CL-01, E8）

**Files:** `nodes/clarify_route.py`, `tests/test_clarify_route_checkpoint.py`

- [ ] **Step 1:** async test 期望 `clarify_context.kind==route_orchestration`, `phase==clarify`, `flow_mode!=chat`
- [ ] **Step 2:** 实现：从 `route_context`/`sidebar_*` snapshot；`route_clarify=True`
- [ ] **Step 3:** pytest PASS
- [ ] **Step 4:** commit

---

### T7: `classify_clarify_reply` 继承 original（R-CL-03, E5, E9）

**Files:** `clarify_reply.py`, `tests/test_clarify_reply.py`

- [ ] **Step 1:** `test_clarify_reply_choice_1_inherits_original_style3` → prompt == `"@T1 请按风格3出图"`
- [ ] **Step 2:** choice 1：`prompt = original_utterance.strip() or "生成一张主图"`
- [ ] **Step 3:** pytest PASS
- [ ] **Step 4:** commit

---

### T8: `intake` route clarify follow-up（R-CL-02, R-CL-05, E4, E9）

**Files:** `nodes/intake.py`, `tests/test_route_clarify_followup.py`

**Consumes:** `pending_clarify`, `classify_clarify_reply`  
**Produces:** `pre_parsed_intent: IntentParseResult | None`（可选 shortcut）

- [ ] **Step 1:**

```python
@pytest.mark.asyncio
async def test_intake_reply_1_after_route_clarify():
    out = await intake({
        "messages": [HumanMessage(content="1")],
        "clarify_context": {
            "kind": "route_orchestration",
            "original_utterance": "@T1 请按风格3出图",
            "clarify_question": "回复 1/2/3",
            "mentioned_keys": ["T1"],
        },
        "sidebar_mentioned_keys": ["T1"],
    })
    assert out["flow_mode"] == "atomic_create"
    assert out.get("clarify_question") is None
```

- [ ] **Step 2:** `decide_route` **之前**处理 `pending_clarify` + `route_orchestration` + classify≠none
- [ ] **Step 3:** choice 1 → `flow_mode=atomic_create`, `clarify_context=None`, 恢复 `sidebar_mentioned_keys`；可选 `pre_parsed_intent`
- [ ] **Step 4:** choice 2 → campaign；choice 3 → atomic_create + vision_text item
- [ ] **Step 5:** `atomic_parse.py` 开头：若 `state.get("pre_parsed_intent")` → shortcut parse_outcome
- [ ] **Step 6:** pytest PASS + `tests/test_graph_routes.py`
- [ ] **Step 7:** commit

---

### T9: Dock/侧栏 parity 文档 + atomic_create prompt 路径（R-ALIGN-01~02）

**Files:** `nodes/atomic_parse.py`, `atomic_parse_schema.py`（确认 prompt 来自 derive_studio_prompt）

- [ ] **Step 1:** 集成测试 `test_atomic_create_style3_prompt_and_refs`：mock nest，assert create 调用 prompt 含「按风格3」
- [ ] **Step 2:** 确认 `parse_outcome_to_state` / create 节点使用 IR prompt
- [ ] **Step 3:** commit

---

### T10: Eval cases + rule parse 风格 N（R-PARSE-01~02, AC-01~04）

**Files:** `eval-route-set.yaml`, `eval-intent-set.yaml`, `atomic_parse_util.py`（若需）

- [ ] **Step 1:** `eval-route-set.yaml` 增：

```yaml
- id: sidebar-t1-style3-atomic
  messages: [{ role: user, content: "@T1 请按风格3出图" }]
  sidebar: { mentioned_keys: ["T1"] }
  expect: { flow_mode: atomic_create, reason: sidebar_ref_atomic }

- id: tmall-detail-campaign-clarify
  messages: [{ role: user, content: "帮我做天猫详情页营销方案出图" }]
  expect: { flow_mode: clarify_route }
```

- [ ] **Step 2:** `eval-intent-set.yaml` 增 `sidebar-t1-style3-image`
- [ ] **Step 3:** `rule_parse_atomic` 保留 utterance 中 `按风格(\d+)`
- [ ] **Step 4:** 跑 eval harness / pytest schema tests
- [ ] **Step 5:** commit

---

### T11: UX — clarify 文案 + thinking_summary + ref 确认（R-UX-01~04, R-CL-04, E6）

**Files:** `route_decide.py`, `nodes/intake.py`, `nodes/clarify_route.py`, `nodes/atomic_parse.py`

- [ ] **Step 1:** 更新 `ROUTE_CLARIFY_ORCHESTRATION`（选项 1 含「保留 @T*」）
- [ ] **Step 2:** `needs_route_clarify` 时 `thinking_summary="待确认：单张出图还是完整编排"`
- [ ] **Step 3:** clarify 消息 append「已看到引用 T1」（有 attachment 时）
- [ ] **Step 4:** follow-up 失败路径：`intake` 返回明确错误 AIMessage，非 chat 节点
- [ ] **Step 5:** atomic 成功 `thinking_summary="将创建 image 节点，引用 T1"`
- [ ] **Step 6:** commit

---

### T12: P0 生产验证 + 全量回归

**Files:** `deploy/prod-atomic-intent-ir-verify.py`

- [ ] **Step 1:** 增 case `sidebar_t1_style3_image`
- [ ] **Step 2:** `cd services/agent-runtime && pytest tests/ -q` 全绿
- [ ] **Step 3:** 手动 AC-02：clarify → `1` → 非 chat
- [ ] **Step 4:** commit；**打 tag / Issue 链 P1**

---

# Phase 1a — Route Features + Precedence（shadow）

> **退出标准：** shadow 一致率 ≥99% on eval-route-set（design §9.12）

---

### T13: `route_features.py`（RU-3, RU-6）

**Files:** Create `route_features.py`, `tests/test_route_features.py`

**Produces:** `extract_route_features(ctx: RouteContext, intent: AtomicIntent) -> RouteFeatures`

- [ ] **Step 1:** 失败测试覆盖 §9.8.2 全部字段（style3 ctx → `has_text_ref=True`, `orchestration_phrases=False`）
- [ ] **Step 2:** 实现：从 `mentioned_keys`/`attachments`/`checkpoint`/`utterance` 提取；`orchestration_phrases` 用短语表（详情页/全链路/分镜），**不含**单字出图
- [ ] **Step 3:** pytest PASS
- [ ] **Step 4:** commit

---

### T14: `route_precedence.py` — 11 行策略表（RU-4, RU-5）

**Files:** Create `route_precedence.py`, `tests/test_route_precedence.py`

**Produces:** `apply_route_precedence(intent, features, ctx, *, pending_clarify_reply=None) -> RouteDecision`

- [ ] **Step 1:** 每行 `rule_id` 一条单测（§9.9 表 1–11）
- [ ] **Step 2:** 实现 `PRECEDENCE_RULES` 列表，首匹配返回；输出含 `precedence_rule_id`
- [ ] **Step 3:** `ref_backed_generate` 测 style3；`orch_ambiguous` 测 AC-04
- [ ] **Step 4:** commit

---

### T15: Shadow diff harness（RU-8, §9.14）

**Files:** `route_decide.py`, `tests/test_route_shadow_diff.py`, `app/settings.py`

- [ ] **Step 1:** `decide_route_legacy(ctx)` 重命名现有逻辑；新 `decide_route_unified(ctx)` 调 features+precedence
- [ ] **Step 2:** `ROUTE_SHADOW_MODE` 时双跑，log diff（flow_mode, reason）
- [ ] **Step 3:** 对 `eval-route-set.yaml` 全 case shadow；断言一致率 ≥99%
- [ ] **Step 4:** commit

---

# Phase 1b — 切换 + clarify_gate

> **退出标准：** §9.16 前 4 项；eval-route-set CI required

---

### T16: `decide_route` 切换到 unified（RU-1, RU-2）

**Files:** `route_decide.py`, `tests/test_route_decide.py`

- [ ] **Step 1:** `decide_route` 默认调 `decide_route_unified`；legacy 仅测试/fixture
- [ ] **Step 2:** 删除 P0 临时 `_sidebar_ref_atomic_signal`（逻辑已在 precedence 4）
- [ ] **Step 3:** 全量 pytest PASS
- [ ] **Step 4:** commit

---

### T17: `clarify_gate` 统一子图（RU-7, §9.6）

**Files:** Create `nodes/clarify_gate.py`, `builder.py`, `nodes/clarify_route.py`, `nodes/clarify_atomic_intent.py`

- [ ] **Step 1:** `make_clarify_gate_node()`：写 `clarify_context`、phase=clarify、honest trace、**禁止** flow_mode=chat
- [ ] **Step 2:** `builder.py`：`clarify_route` + `clarify_atomic_intent` → 均指向 `clarify_gate`（或 deprecate 旧节点为 thin wrapper）
- [ ] **Step 3:** `tests/test_clarify_gate_unified.py`：route + atomic 两路径同结构 checkpoint
- [ ] **Step 4:** commit

---

### T18: Execution trace 字段（§9.14, R-UX）

**Files:** `nodes/intake.py`, `app/runs.py` 或 trace emitter

- [ ] **Step 1:** `route_decision` 写入 `precedence_rule_id`, `route_features`, `atomic_intent` snapshot
- [ ] **Step 2:** 集成测试 assert trace delta 含字段
- [ ] **Step 3:** commit

---

### T19: eval-route-set CI 门禁（RU-8）

**Files:** `.github/workflows/*` 或现有 CI, `tests/test_eval_route_set.py`

- [ ] **Step 1:** 扩展 eval-route-set 至 ≥30 cases（img2img/video/explore/regression/clarify）
- [ ] **Step 2:** CI job `pytest tests/test_eval_route_set.py` required
- [ ] **Step 3:** commit

---

### T20: `prod-route-unification-verify.py`

**Files:** `deploy/prod-route-unification-verify.py`

- [ ] **Step 1:** 迁移 style3 + video + img2img cases
- [ ] **Step 2:** 文档 README 一行用法
- [ ] **Step 3:** commit

---

# Phase 1c — 废止 hint 路由

> **退出标准：** §9.16 全部；§9.13 废止清单完成

---

### T21: 删除路由用 bool 分类器（RU-10, §9.13）

**Files:** `intent.py`, `atomic_intent.py`, `route_decide.py`, 全测试

- [ ] **Step 1:** grep 确认 `marketing_intent` 仅 orchestration feature / 非 L0 路由
- [ ] **Step 2:** 删除 `decide_route` 内 `marketing_intent`/`atomic_create_intent`/`orchestration_complexity_intent` 调用
- [ ] **Step 3:** `decide_route_legacy` 删除或移 test/fixtures
- [ ] **Step 4:** `pytest tests/ -q` + eval-route-set
- [ ] **Step 5:** 更新 [platform-route-skill-boundary](../specs/2026-08-07-platform-route-skill-boundary-design.md) 增 R-S9
- [ ] **Step 6:** commit

---

# Phase 2 — GenerationRequest + Slots（design §9.12 P2）

> **退出标准：** AC-05 字段级 parity；IR slots `style=3`

---

### T22: `generation_request.py` DTO（RU-9, R-ALIGN-02）

**Files:** Create `generation_request.py`, `tests/test_generation_request.py`

- [ ] **Step 1:**

```python
def build_generation_request_from_atomic_state(state: dict) -> GenerationRequest:
    """侧栏 atomic 路径：prompt + refs + mentioned_keys."""
    ...

def build_generation_request_from_dock(node, upstream, refs, mentioned_keys) -> GenerationRequest:
    """文档/测试用：与 web useNodeGeneration 字段对齐."""
    ...
```

- [ ] **Step 2:** parity test：同语义 style3 侧栏 vs dock 构造 equal keys
- [ ] **Step 3:** commit

---

### T23: IR slots `style` / `ref`（§9.8.3 P2, R-PARSE-01 增强）

**Files:** `atomic_intent_ir.py`, `tests/test_atomic_intent_ir_ref_image.py`

- [ ] **Step 1:** `resolve_atomic_intent` 解析 `按风格(\d+)` → `slots={"style": "3"}`
- [ ] **Step 2:** pytest PASS
- [ ] **Step 3:** commit

---

### T24: P2 eval + 文档收尾

- [ ] **Step 1:** eval-intent-set 增 slots 期望
- [ ] **Step 2:** design spec 状态改为 Implemented
- [ ] **Step 3:** 最终 `pytest tests/ -q` + prod verify

---

## 阶段里程碑与合并策略

| 里程碑 | Tasks | PR 建议 | 合并条件 |
|--------|-------|---------|----------|
| **M0 P0** | T1–T12 | `fix/sidebar-ref-image-routing-p0` | AC-01–07 + pytest |
| **M1 P1a** | T13–T15 | `feat/route-unification-shadow` | shadow ≥99% |
| **M2 P1b** | T16–T20 | `feat/route-unification-switch` | CI eval-route-set |
| **M3 P1c** | T21 | `refactor/route-unification-cleanup` | §9.16 全绿 |
| **M4 P2** | T22–T24 | `feat/generation-request-parity` | AC-05 parity |

**依赖：** M1 依赖 M0；M2 依赖 M1；M3 依赖 M2；M4 可与 M3 并行（仅依赖 M0 prompt/refs 行为）。

---

## 计划自检（全部完成后勾选）

- [x] design §3 全部 R-* 有 Task
- [x] design §9 全部 RU-* 有 Task（T12–T21）
- [x] AC-01–AC-07 有明确验证 Task
- [x] Q1–Q5、E1–E10 覆盖索引已满足
- [x] 无 TBD / placeholder 步骤
- [x] P0 未新增 permanent hint 条目
- [x] P1c 后零 substring 路由

> **收尾（2026-08-10）：** T1–T24 代码已合并 main；本次收尾完成 §9.13 路由 bool 迁移、`GenerationRequest` runtime 接入、prod verify PASS=5、§9.16 验收勾选。

---

## 执行选项

**Plan saved to:** `docs/superpowers/plans/2026-08-09-sidebar-ref-image-routing-full.md`

**1. Subagent-Driven（推荐）** — 按 M0→M4 里程碑派生子 agent，里程碑间 review  
**2. Inline Execution** — 本会话从 T1 顺序执行，每里程碑 checkpoint

**Legacy P0-only plan（已 supersede）：** [2026-08-09-sidebar-ref-image-routing.md](./2026-08-09-sidebar-ref-image-routing.md)
