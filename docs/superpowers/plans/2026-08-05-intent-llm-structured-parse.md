# Intent LLM Structured Parse Implementation Plan (Phase C)

> **For agentic workers:** 本计划 **依赖 Phase B 完成并过 Gate** 后方可执行。  
> REQUIRED SUB-SKILL: superpowers:executing-plans 或 subagent-driven-development

**Goal:** 将 atomic/campaign 意图识别主路径从 keyword+rule 升级为 LLM 结构化 parse（Action×Scope×Modality×Extract），保留 B 的 planning_guard 作为 guardrail。

**Architecture:** LLM 输出 `IntentParseResult` JSON → planning_guard.validate → validate_parse_result → create|clarify；feature flag 灰度；rule parse 作 fallback。

**Tech Stack:** Python 3.11, LangGraph, OpenAI/DeepSeek JSON mode, pytest, YAML eval

**Prerequisite Gate (must all pass before Task C0):**
- [ ] Phase B merged to main
- [ ] `eval-planning-guard-set.yaml` 25/25 PASS
- [ ] prod planning smoke 2 weeks green
- [ ] See [2026-08-05-intent-llm-structured-parse-design.md §8.4](../specs/2026-08-05-intent-llm-structured-parse-design.md)

## Global Constraints

- `INTENT_LLM_PARSE` default **false** until C4
- planning_guard **never removed** — only role changes to validator
- `CLARIFY_THRESHOLD = 0.70` unchanged
- LLM timeout 8s → fallback `rule_parse_atomic`
- Zero regression on B eval sets + existing eval-intent-set

---

## File Map (Phase C)

| File | Action |
|------|--------|
| `app/graph/intent_parse_schema.py` | Create |
| `app/graph/intent_parse_llm.py` | Create |
| `app/graph/clarify_reply.py` | Create |
| `app/graph/planning_guard.py` | Extend `validate_llm_parse` |
| `app/graph/nodes/atomic_parse.py` | LLM-first + shadow |
| `app/config.py` | Add flags |
| `packages/agent/src/prompt-modes/taxonomy.yaml` | Create (shared w/ runtime) |
| `skills/atomic-create/eval-intent-llm-set.yaml` | Create (80 cases) |
| `tests/test_intent_llm_parse.py` | Create |
| `tests/test_intent_llm_parse_eval.py` | Create |
| `tests/test_clarify_reply.py` | Create |
| `deploy/prod-atomic-intent-shadow-verify.py` | Create |

---

## Milestone C0: Schema + LLM Parse Core

### Task C0-1: IntentParseResult schema

**Files:**
- Create: `services/agent-runtime/app/graph/intent_parse_schema.py`
- Create: `services/agent-runtime/tests/test_intent_parse_schema.py`

- [ ] Define `IntentParseResult`, `IntentParseItem` TypedDicts (per design §3.1)
- [ ] Implement `parse_llm_json(raw: str) -> IntentParseResult | None`
- [ ] Implement `intent_result_to_parse_outcome(result, utterance) -> ParseOutcome`
- [ ] Tests: valid JSON, missing fields, invalid target_type, confidence clamp

### Task C0-2: LLM parse module

**Files:**
- Create: `services/agent-runtime/app/graph/intent_parse_llm.py`
- Modify: `skills/atomic-create/few-shots.yaml` — add `parse_intent_structured` section

- [ ] `_STRUCTURED_PARSE_SYSTEM` with action/scope/route rules (design §3.2)
- [ ] `async def llm_parse_intent(utterance, *, canvas_summary, dialogue, checkpoint) -> IntentParseResult`
- [ ] JSON mode + 1 retry on parse error
- [ ] Unit test with mocked LLM response (planning utterance → route=campaign)

### Task C0-3: Config flags

**Files:**
- Modify: `services/agent-runtime/app/config.py`

```python
intent_llm_parse: bool = False
intent_llm_parse_shadow: bool = False
```

---

## Milestone C1: Shadow Mode + Eval 80 Cases

### Task C1-1: eval-intent-llm-set.yaml

**Files:**
- Create: `services/agent-runtime/skills/atomic-create/eval-intent-llm-set.yaml`

Categories (80 total):
- `llm-plan-campaign` (15)
- `llm-generate-image` (15)
- `llm-write-text` (10)
- `llm-expand-prompt` (10)
- `llm-multi-image` (10)
- `llm-adversarial` (10)
- `llm-clarify-expected` (10)

Include user original case as `llm-001`.

### Task C1-2: Eval runner + shadow diff

**Files:**
- Create: `services/agent-runtime/tests/test_intent_llm_parse_eval.py`
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`

- [ ] Shadow: run both `llm_parse_intent` and `rule_parse_atomic`, log diff if disagree
- [ ] Eval asserts LLM outcome matches gold when `INTENT_LLM_PARSE=1`
- [ ] Agreement report script for CI artifact

**Gate:** agreement ≥ 90% on eval-intent-llm-set before C2.

---

## Milestone C2: Guardrail + Clarify 续聊

### Task C2-1: validate_llm_parse in planning_guard

**Files:**
- Modify: `services/agent-runtime/app/graph/planning_guard.py`

```python
def validate_llm_parse(result: IntentParseResult, utterance: str) -> ParseOutcome | None:
    """Return clarify outcome if guard conflicts; None if OK to proceed."""
```

- [ ] action=generate + has_planning_image_conflict → clarify
- [ ] items with image when action=plan → clarify
- [ ] Tests in `test_planning_guard.py`

### Task C2-2: Clarify reply classifier

**Files:**
- Create: `services/agent-runtime/app/graph/clarify_reply.py`
- Create: `services/agent-runtime/tests/test_clarify_reply.py`
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`

- [ ] `classify_clarify_reply(original, question, reply, checkpoint)`
- [ ] Map `1/2/3` and natural language variants
- [ ] Graph: if `phase=clarify` and new user msg → try classify_clarify_reply first

---

## Milestone C3: prompt_mode L3 统一

### Task C3-1: Shared taxonomy

**Files:**
- Create: `packages/agent/src/prompt-modes/taxonomy.yaml`
- Create: `services/agent-runtime/app/tools/prompt_mode_taxonomy.py` (loader)

- [ ] Mirror `classify.ts` heuristics as yaml patterns
- [ ] Runtime `resolve_prompt_mode(utterance) -> str | None`
- [ ] LLM parse prompt references same taxonomy ids

### Task C3-2: Wire prompt_mode into items

- [ ] `IntentParseItem.prompt_mode` → `atomic_spec.promptMode` in create
- [ ] Tests: commercial_storyboard utterance → prompt/text + correct mode

---

## Milestone C4: LLM Primary + Fast Path 收缩

### Task C4-1: atomic_parse LLM-first

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`

```python
if settings.intent_llm_parse:
    result = await llm_parse_intent(...)
    guard = validate_llm_parse(result, utterance)
    if guard: return guard
    return intent_result_to_parse_outcome(result, utterance)
# fallback
return rule_path(...)
```

- [ ] Timeout → rule fallback
- [ ] Remove blanket `_STRONG_SIGNAL_KEYWORDS` fast path when flag ON

### Task C4-2: Prod smoke + flag rollout

**Files:**
- Create: `deploy/prod-atomic-intent-shadow-verify.py`
- Modify: `deploy/prod-p4-full-regression.py` (optional include)

- [ ] Shadow verify on prod weekly
- [ ] Document rollout: shadow 1 week → 10% → 100%

**Gate:** C4 requires C1 agreement ≥ 90%, C2 clarify tests PASS, zero B regression.

---

## Milestone C5: Observability

### Task C5-1: Logging + metrics

- [ ] Log fields: `intent_parse_source=llm|rule`, `action`, `route`, `confidence`, `guard_triggered`
- [ ] Optional: nest endpoint for badcase collection

---

## B → C Handoff Checklist

| # | Item | Owner |
|---|------|-------|
| 1 | B PR merged | — |
| 2 | B eval 25/25 | — |
| 3 | B prod smoke 2 weeks | — |
| 4 | C0 schema + LLM module | — |
| 5 | C1 shadow agreement ≥ 90% | — |
| 6 | C2 clarify 续聊 | — |
| 7 | C3 prompt_mode unified | — |
| 8 | C4 flag default ON | — |

---

## Self-Review

| Design § | Plan Task |
|----------|-----------|
| §3 Schema | C0-1 |
| §6 LLM spec | C0-2 |
| §4 Fast path | C4-1 |
| §5 Clarify 续聊 | C2-2 |
| §7 Guardrail | C2-1 |
| §8 Eval | C1-1, C1-2 |
| §9 Files | File Map |
| §11 Acceptance | Gates throughout |

---

**Status:** Draft — execute only after Phase B plan complete.

**Related:**
- Phase B spec: [2026-08-05-intent-planning-guard-design.md](../specs/2026-08-05-intent-planning-guard-design.md)
- Phase B plan: [2026-08-05-intent-planning-guard.md](./2026-08-05-intent-planning-guard.md)
