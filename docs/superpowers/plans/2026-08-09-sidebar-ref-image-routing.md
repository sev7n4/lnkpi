# Agent 侧栏引用生图路由与澄清续接 — 实现计划（P0 only）

> **Superseded by:** [2026-08-09-sidebar-ref-image-routing-full.md](./2026-08-09-sidebar-ref-image-routing-full.md)（含 P0+P1+P2 全量 24 Tasks）  
> 本文档保留作 P0 Task 1–10 详细代码参考；新执行请用 full plan。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `@T1 请按风格3出图` 的 L1 路由误判与 route 澄清回复断裂，使侧栏「引用 + 指令」与 Dock 语义对齐，并覆盖诊断清单 Q1–Q5 及 E1–E10 全部项。

**Architecture:** 在 Intent IR 上增量扩展词表与 `is_ref_media_generation`；`decide_route` 新增 `_sidebar_ref_atomic_signal` 优先于 `marketing_intent`；统一 `clarify_context` checkpoint 使 route/atomic 澄清 follow-up 经 `classify_clarify_reply` 恢复 original + refs；eval + 生产脚本回归 AC-01–AC-07。

**Tech Stack:** Python 3.11+, LangGraph agent-runtime, pytest, YAML eval sets, `deploy/prod-atomic-intent-ir-verify.py`

**Spec:** [2026-08-09-sidebar-ref-image-routing-design.md](../specs/2026-08-09-sidebar-ref-image-routing-design.md)

## Global Constraints

- 规格需求 R-L1-01–R-UX-04、验收 AC-01–AC-07 均须满足；不得回退 PR #197 video IR 行为
- `出图` 不得单独触发 `marketing_intent`（R-L1-01）
- route 澄清 follow-up 禁止落入 default chat（R-CL-05）
- atomic image：`prompt` + `localRefs` 分离，与 Dock 一致（R-ALIGN-01）
- 每个 Task 独立可测；Task 内 TDD；每 Task 结束 commit
- 测试命令根目录：`services/agent-runtime/`；`pytest tests/ -q` 全绿方可 claim 完成

---

## 问题覆盖索引（实施时勾选）

| ID | Task | 覆盖 |
|----|------|------|
| Q1, E1, E2, E10 | Task 1–3 | IR + marketing hint |
| Q1, E3, E10 | Task 4 | L1 ref atomic signal |
| Q2, E3 | Task 5, 9 | Dock 对齐 eval |
| Q3, E4, E8, E9 | Task 6–8 | clarify checkpoint |
| Q4 全项 | Task 1–10 | 分散见各 Task |
| Q5, E5, E6 | Task 8, 10 | UX copy + trace |
| E7 | Task 2, 5 | 风格 N + prompt 保留 |
| AC-01–AC-07 | Task 9–10 | eval + prod verify |

---

### Task 1: IR — `出图` / `按风格N` 词表扩展

**覆盖:** Q1, E2, R-IR-01, R-IR-02, R-IR-03

**Files:**
- Create: `services/agent-runtime/tests/test_atomic_intent_ir_ref_image.py`
- Modify: `services/agent-runtime/app/graph/atomic_intent_ir.py`

**Interfaces:**
- Produces: `has_generate_verb("请按风格3出图") -> True`; `is_ref_media_generation(u, ["T1"]) -> True`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_atomic_intent_ir_ref_image.py
from app.graph.atomic_intent_ir import (
    has_generate_verb,
    has_image_output,
    is_ref_media_generation,
    resolve_atomic_intent,
)

STYLE3 = "@T1 请按风格3出图"


def test_has_generate_verb_chutu():
    assert has_generate_verb("按风格3出图")
    assert has_generate_verb("请出图")


def test_has_image_output_style_n():
    assert has_image_output("按风格3出图")


def test_ref_media_generation_t1_chutu():
    assert is_ref_media_generation(STYLE3, ["T1"])


def test_resolve_atomic_intent_style3():
    ir = resolve_atomic_intent(STYLE3, mentioned_keys=["T1"])
    assert ir.action == "generate"
    assert ir.output_modality == "image"
    assert ir.mentioned_keys == ("T1",)
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd services/agent-runtime && pytest tests/test_atomic_intent_ir_ref_image.py -v`  
Expected: FAIL on `has_generate_verb` / `is_ref_media_generation`

- [ ] **Step 3: Implement minimal IR changes**

在 `atomic_intent_ir.py`:

1. `GENERATE_VERBS` 元组追加：`"出图"`, `"出一张图"`, `"生成图"`
2. `has_generate_verb` 内 regex 追加：`r"(?:出图|出一张图|生成图)"`
3. `has_image_output`：`"出图" in t` 或 `re.search(r"按风格\s*\d+", t)` 或 `re.search(r"风格\s*\d+", t)`
4. `is_ref_media_generation` 在现有逻辑前追加：

```python
_STYLE_N_RE = re.compile(r"(?:按)?风格\s*(\d+)", re.IGNORECASE)

def is_ref_media_generation(text: str, mentioned_keys: list[str] | None = None) -> bool:
    t = (text or "").strip()
    keys = mentioned_keys or []
    text_keys = [k for k in keys if k.upper().startswith("T")]
    if text_keys and (_STYLE_N_RE.search(t) or "出图" in t or "生成图" in t):
        return True
    # ... existing logic unchanged ...
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd services/agent-runtime && pytest tests/test_atomic_intent_ir_ref_image.py -v`

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/atomic_intent_ir.py \
  services/agent-runtime/tests/test_atomic_intent_ir_ref_image.py
git commit -m "feat(agent-runtime): IR recognizes 出图 and 按风格N with T refs"
```

---

### Task 2: IR — `derive_studio_prompt` 保留用户 utterance

**覆盖:** Q2, E7, R-IR-05, R-ALIGN-01, R-PARSE-01

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_intent_ir.py`
- Modify: `services/agent-runtime/tests/test_atomic_intent_ir_ref_image.py`

- [ ] **Step 1: Add failing test**

```python
from app.graph.atomic_intent_ir import derive_studio_prompt, resolve_atomic_intent

def test_derive_studio_prompt_keeps_style3_utterance():
    ir = resolve_atomic_intent("@T1 请按风格3出图", mentioned_keys=["T1"])
    assert derive_studio_prompt(ir) == "@T1 请按风格3出图"
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pytest tests/test_atomic_intent_ir_ref_image.py::test_derive_studio_prompt_keeps_style3_utterance -v`

- [ ] **Step 3: Update `derive_studio_prompt`**

```python
def derive_studio_prompt(intent: AtomicIntent) -> str:
    t = intent.utterance.strip()
    if intent.mentioned_keys and t and not re.fullmatch(r"@\w+\s*", t):
        return t
    if intent.output_modality == "video" and (...):
        return "基于引用内容生成视频"
    if intent.output_modality == "image" and (...):
        return "基于引用内容生成图片"
    return t
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(agent-runtime): keep user utterance in derive_studio_prompt when refs present"
```

---

### Task 3: 移除 `出图` 的 blanket marketing 信号

**覆盖:** Q1, E1, R-L1-01, R-ALIGN-03

**Files:**
- Modify: `services/agent-runtime/app/graph/intent.py`
- Modify: `services/agent-runtime/app/graph/atomic_intent.py`（`atomic_create_intent` 同步 IR）
- Create: `services/agent-runtime/tests/test_marketing_intent_chutu.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_marketing_intent_chutu.py
from app.graph.intent import marketing_intent
from app.graph.atomic_intent import atomic_create_intent

def test_chutu_alone_not_marketing():
    assert not marketing_intent("@T1 请按风格3出图")

def test_chutu_is_atomic_create():
    assert atomic_create_intent("@T1 请按风格3出图")

def test_detail_page_campaign_still_marketing():
    assert marketing_intent("帮我做天猫详情页营销方案")
```

- [ ] **Step 2: Run — expect FAIL**（当前 marketing True）

- [ ] **Step 3: Remove `"出图"` from `MARKETING_HINTS`**

在 `intent.py` 的 `MARKETING_HINTS` 删除 `"出图"` 行。

在 `atomic_intent.py` 的 `atomic_create_intent` 中，于 early return 之后追加：

```python
if re.search(r"(?:出图|出一张图|生成图)", text or ""):
    if not any(h in text for h in CONFIRM_GEN_HINTS):
        return True
```

- [ ] **Step 4: Run tests — PASS**

Run: `pytest tests/test_marketing_intent_chutu.py tests/test_atomic_create_intent.py -q`

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(agent-runtime): 出图 triggers atomic not marketing"
```

---

### Task 4: L1 — `_sidebar_ref_atomic_signal` fast path

**覆盖:** Q1, Q2, E3, E10, R-L1-02, R-L1-03, R-L1-04

**Files:**
- Modify: `services/agent-runtime/app/graph/route_decide.py`
- Create: `services/agent-runtime/tests/test_route_sidebar_ref_atomic.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_route_sidebar_ref_atomic.py
from app.graph.route_decide import decide_route

CTX = {
    "utterance": "@T1 请按风格3出图",
    "mentioned_keys": ["T1"],
    "sidebar_attachments": [{"refKey": "T1", "mediaType": "text"}],
    "checkpoint": {},
}

def test_style3_routes_atomic_create():
    d = decide_route(CTX)
    assert d["flow_mode"] == "atomic_create"
    assert d["reason"] == "sidebar_ref_atomic"

def test_style3_not_clarify_route():
    d = decide_route(CTX)
    assert d["flow_mode"] != "clarify_route"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement in `route_decide.py`**

```python
def _text_mentioned_keys(keys: list[str]) -> list[str]:
    return [k for k in keys if k.upper().startswith("T")]

def _sidebar_ref_atomic_signal(ctx: RouteContext) -> bool:
    utterance = str(ctx.get("utterance") or "").strip()
    if not utterance:
        return False
    keys = _text_mentioned_keys(ctx.get("mentioned_keys") or [])
    attachments = ctx.get("sidebar_attachments") or []
    has_ref = bool(keys) or any(
        str(a.get("mediaType") or "").lower() == "text" for a in attachments
    )
    if not has_ref:
        return False
    from app.graph.atomic_intent_ir import (
        is_ref_media_generation,
        resolve_output_modality,
        has_generate_verb,
    )
    mk = keys or None
    if is_ref_media_generation(utterance, mk):
        return True
    if resolve_output_modality(utterance, mentioned_keys=mk) in ("image", "video"):
        if has_generate_verb(utterance) or "出图" in utterance:
            return True
    return False
```

在 `decide_route` 中，`_sidebar_img2img_signal` 块之后、 `resolve_intake_route` 之前插入：

```python
if _sidebar_ref_atomic_signal(ctx):
    return {
        "flow_mode": "atomic_create",
        "l0_action": l0,
        "confidence": 0.92,
        "reason": "sidebar_ref_atomic",
        ...
    }
```

修改 orch 降级块（约 L170–177）：若 `_sidebar_ref_atomic_signal(ctx)` 为真，跳过 `is_atomic = False` 降级。

- [ ] **Step 4: Run — PASS**

Run: `pytest tests/test_route_sidebar_ref_atomic.py tests/test_route_decide.py -q`

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(agent-runtime): sidebar T-ref + 出图 fast path to atomic_create"
```

---

### Task 5: 统一 `clarify_context` 结构与 `pending_clarify`

**覆盖:** Q3, E4, E8, R-CL-01

**Files:**
- Modify: `services/agent-runtime/app/graph/atomic_clarify.py`
- Modify: `services/agent-runtime/app/graph/state.py`（文档注释或 TypedDict 字段）
- Create: `services/agent-runtime/tests/test_pending_clarify.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_pending_clarify.py
from app.graph.atomic_clarify import pending_clarify

def test_pending_route_orchestration():
    state = {
        "clarify_context": {
            "kind": "route_orchestration",
            "original_utterance": "@T1 请按风格3出图",
            "clarify_question": "回复 1/2/3",
            "mentioned_keys": ["T1"],
        }
    }
    assert pending_clarify(state) is not None

def test_pending_atomic_parse_still_works():
    state = {
        "clarify_context": {
            "kind": "atomic_parse",
            "original_utterance": "帮我生成",
            "clarify_question": "q",
        }
    }
    assert pending_clarify(state) is not None
```

- [ ] **Step 2: Run — expect FAIL**（仅 atomic_parse 有 original 时返回）

- [ ] **Step 3: Implement `pending_clarify`**

```python
_CLARIFY_KINDS = frozenset({"atomic_parse", "route_orchestration", "img2img_confirm"})

def pending_clarify(state: dict[str, Any]) -> dict[str, Any] | None:
    ctx = state.get("clarify_context")
    if not isinstance(ctx, dict):
        return None
    if not str(ctx.get("original_utterance") or "").strip():
        return None
    kind = str(ctx.get("kind") or "atomic_parse")
    if kind not in _CLARIFY_KINDS:
        return None
    return ctx

def pending_atomic_clarify(state: dict[str, Any]) -> dict[str, Any] | None:
    return pending_clarify(state)
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(agent-runtime): unified pending_clarify for route and atomic"
```

---

### Task 6: `clarify_route` 写入 checkpoint

**覆盖:** Q3, E8, R-CL-01

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/clarify_route.py`
- Modify: `services/agent-runtime/app/graph/route_context.py`（如需 snapshot helper）
- Create: `services/agent-runtime/tests/test_clarify_route_checkpoint.py`

- [ ] **Step 1: Write failing test**

```python
import pytest
from app.graph.nodes.clarify_route import make_clarify_route_node

@pytest.mark.asyncio
async def test_clarify_route_writes_context():
    node = make_clarify_route_node()
    out = await node({
        "clarify_question": "回复 1/2/3",
        "route_context": {
            "utterance": "@T1 请按风格3出图",
            "mentioned_keys": ["T1"],
        },
        "sidebar_attachments": [{"refKey": "T1"}],
        "sidebar_mentioned_keys": ["T1"],
    })
    ctx = out.get("clarify_context")
    assert ctx["kind"] == "route_orchestration"
    assert ctx["original_utterance"] == "@T1 请按风格3出图"
    assert ctx["mentioned_keys"] == ["T1"]
    assert out["phase"] == "clarify"
    assert out.get("flow_mode") != "chat"
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `clarify_route.py`**

```python
async def clarify_route(state: dict) -> dict:
    question = str(state.get("clarify_question") or "").strip() or (...)
    route_ctx = state.get("route_context") or {}
    original = str(route_ctx.get("utterance") or "").strip()
    mentioned = list(state.get("sidebar_mentioned_keys") or route_ctx.get("mentioned_keys") or [])
    attachments = list(state.get("sidebar_attachments") or [])
    return {
        "phase": "clarify",
        "flow_mode": "clarify_route",
        "route_clarify": True,
        "clarify_question": question,
        "clarify_context": {
            "kind": "route_orchestration",
            "original_utterance": original,
            "clarify_question": question,
            "mentioned_keys": mentioned,
            "sidebar_attachment_ref_keys": [
                str(a.get("refKey") or "") for a in attachments if a.get("refKey")
            ],
        },
        "messages": [AIMessage(content=question)],
    }
```

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(agent-runtime): clarify_route persists clarify_context checkpoint"
```

---

### Task 7: `classify_clarify_reply` 继承 original utterance

**覆盖:** Q3, E5, E9, R-CL-03

**Files:**
- Modify: `services/agent-runtime/app/graph/clarify_reply.py`
- Modify: `services/agent-runtime/tests/test_clarify_reply.py`

- [ ] **Step 1: Add failing test**

```python
def test_clarify_reply_choice_1_inherits_original_style3():
    original = "@T1 请按风格3出图"
    result = classify_clarify_reply(original, "q", "1")
    assert result["items"][0]["prompt"] == original
    assert result["items"][0]["target_type"] == "image"
```

- [ ] **Step 2: Run — expect FAIL**（硬编码蓝牙耳机）

- [ ] **Step 3: Update choice 1 branch**

```python
if lowered in _CHOICE_ONE or any(k in raw for k in ("单张主图", "直接出图", "只要主图")):
    prompt = original_utterance.strip()
    if not prompt:
        prompt = "生成一张主图"
    elif "主图" in original_utterance and "蓝牙耳机" in original_utterance:
        prompt = "生成一张蓝牙耳机主图"
    return {
        ...
        "items": [{"target_type": "image", "title": prompt[:24], "prompt": prompt, ...}],
        ...
    }
```

- [ ] **Step 4: Run — PASS**

Run: `pytest tests/test_clarify_reply.py -v`

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(agent-runtime): clarify choice 1 inherits original utterance"
```

---

### Task 8: `intake` route clarify follow-up 路由

**覆盖:** Q3, E4, E9, R-CL-02, R-CL-05, R-UX-03

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/app/graph/builder.py`（若需新 route 边）
- Create: `services/agent-runtime/tests/test_route_clarify_followup.py`

- [ ] **Step 1: Write failing integration test**

```python
# tests/test_route_clarify_followup.py
import pytest
from langchain_core.messages import HumanMessage
from app.graph.nodes.intake import make_intake_node
from pathlib import Path

SKILLS = Path(__file__).resolve().parents[1] / "skills"

@pytest.mark.asyncio
async def test_intake_reply_1_after_route_clarify():
    intake = make_intake_node(SKILLS)
    state = {
        "messages": [HumanMessage(content="1")],
        "clarify_context": {
            "kind": "route_orchestration",
            "original_utterance": "@T1 请按风格3出图",
            "clarify_question": "回复 1/2/3",
            "mentioned_keys": ["T1"],
        },
        "sidebar_mentioned_keys": ["T1"],
    }
    out = await intake(state)
    assert out["flow_mode"] == "atomic_create"
    assert out.get("clarify_question") is None
    assert out.get("route_clarify") is False
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Update `intake.py`**

在 `text = ...` 之后、`decide_route` 之前插入 clarify follow-up 处理：

```python
from app.graph.atomic_clarify import pending_clarify
from app.graph.clarify_reply import classify_clarify_reply

pending = pending_clarify(state)
if pending and str(pending.get("kind") or "") == "route_orchestration":
    original = str(pending.get("original_utterance") or "")
    question = str(pending.get("clarify_question") or state.get("clarify_question") or "")
    classified = classify_clarify_reply(original, question, text)
    if classified != "none":
        route = classified.get("route")
        if route == "atomic_create":
            return {
                "phase": "intake",
                "flow_mode": "atomic_create",
                "skill_id": None,
                "mode": "create",
                "clarify_question": None,
                "clarify_context": None,
                "route_clarify": False,
                "sidebar_mentioned_keys": pending.get("mentioned_keys") or state.get("sidebar_mentioned_keys"),
                # 可选：写入 pre_parsed_atomic 供 atomic_parse 短路
                "pre_parsed_intent": classified,
                ...
            }
        if route == "campaign":
            ...
```

若采用 `pre_parsed_intent`，在 `atomic_parse.py` 开头检测并短路（可选子步骤）。

将现有 `pending_clarify and is_affirmative_clarify_reply` 块改为使用 `pending_clarify` 而非仅 `pending_atomic_clarify`。

- [ ] **Step 4: Run — PASS**

Run: `pytest tests/test_route_clarify_followup.py -v`

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(agent-runtime): route clarify 1/2/3 follow-up routes to atomic/campaign"
```

---

### Task 9: Eval cases + route 文案 + thinking_summary

**覆盖:** Q5, E5, E6, R-CL-04, R-UX-01, R-UX-02, R-PARSE-02, AC-01–AC-07

**Files:**
- Modify: `services/agent-runtime/skills/atomic-create/eval-intent-set.yaml`
- Modify: `services/agent-runtime/skills/atomic-create/eval-route-set.yaml`
- Modify: `services/agent-runtime/app/graph/route_decide.py`（`ROUTE_CLARIFY_ORCHESTRATION` 文案）
- Modify: `services/agent-runtime/app/graph/nodes/intake.py` 或 `atomic_parse.py`（clarify thinking_summary）

- [ ] **Step 1: Add eval YAML entries**

`eval-route-set.yaml`:

```yaml
- id: sidebar-t1-style3-atomic
  messages:
    - role: user
      content: "@T1 请按风格3出图"
  sidebar:
    mentioned_keys: ["T1"]
  expect:
    flow_mode: atomic_create
    reason: sidebar_ref_atomic
```

`eval-intent-set.yaml`:

```yaml
- id: sidebar-t1-style3-image
  utterance: "@T1 请按风格3出图"
  mentioned_keys: ["T1"]
  expect:
    target_type: image
    action: generate
```

- [ ] **Step 2: Update clarify copy**

```python
ROUTE_CLARIFY_ORCHESTRATION = (
    "听起来像多节点编排或营销方案需求。请确认：\n"
    "1）按引用内容单张出图（保留 @T* / @I*）；\n"
    "2）完整编排（请在侧栏选用已安装的 Skill）；\n"
    "3）其他说明。\n"
    "回复 1 / 2 / 3。"
)
```

- [ ] **Step 3: Clarify thinking_summary**

intake 在 `needs_route_clarify` 时设置：

```python
out["thinking_summary"] = "待确认：单张出图还是完整编排"
```

- [ ] **Step 4: Run eval harness**

Run: `cd services/agent-runtime && pytest tests/test_intent_parse_schema.py tests/test_route_decide.py -q`

- [ ] **Step 5: Commit**

```bash
git commit -am "test(agent-runtime): eval cases for @T1 style3 + clarify UX copy"
```

---

### Task 10: 生产验证脚本 + 全量回归

**覆盖:** AC-01, AC-02, AC-05, R-ALIGN-02

**Files:**
- Modify: `deploy/prod-atomic-intent-ir-verify.py`

- [ ] **Step 1: Add prod case**

```python
CASES.append({
    "name": "sidebar_t1_style3_image",
    "utterance": "@T1 请按风格3出图",
    "mentioned_keys": ["T1"],
    "expect_node_type": "image",
})
```

- [ ] **Step 2: Run full agent-runtime tests**

Run: `cd services/agent-runtime && pytest tests/ -q`  
Expected: all pass

- [ ] **Step 3: Document Dock parity note**

在 spec 或 plan 末尾确认：Dock 路径 `prompt=按风格3出图` + edge T1 refs 与 agent atomic 一致（人工 AC-05 checklist）。

- [ ] **Step 4: Commit**

```bash
git add deploy/prod-atomic-intent-ir-verify.py
git commit -m "chore(deploy): prod verify case for @T1 style3 image routing"
```

---

## 计划自检（实施完成后勾选）

- [ ] Q1–Q5：每条均有 Task 覆盖（见索引表）
- [ ] E1–E10：每条均有 Task 覆盖
- [ ] R-L1-01–R-UX-04：均可指向 Task 1–10
- [ ] AC-01–AC-07：Task 9–10 + 集成测试
- [ ] 无 TBD / placeholder 步骤
- [ ] PR #197 video cases 回归通过

---

## 执行选项

**Plan saved to:** `docs/superpowers/plans/2026-08-09-sidebar-ref-image-routing.md`

**1. Subagent-Driven（推荐）** — 每 Task 派生子 agent，Task 间 review  
**2. Inline Execution** — 本会话按 Task 1→10 顺序执行，checkpoint Review

请选择执行方式；规格评审通过后开始 Task 1。
