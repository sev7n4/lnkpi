# Phase C 二期：Dock model/skillId 端到端 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 侧栏 dock 的 skillId 与规划 model 经 Web → Nest → Runtime 全链路生效。

**Architecture:** Nest `ProviderResolver.resolveForGeneration(userId, model, 'text')` 解 credentials；Runtime `resolve_llm(req)` 构建 per-request `ChatOpenAI`；`intake` 读 `requested_skill_id` 优先于关键词。

**Tech Stack:** Vue 3 + NestJS + Python LangGraph + `@lnkpi/shared` contract

## Global Constraints

- MVP A：skillId + model 端到端；**不含**真实规划积分扣费 / DockCreditBadge
- 浏览器不传 apiKey；credentials 仅 Nest → Runtime service-token 内网
- Phase B/C 生产脚本回归必须 PASS
- 合并走 feature 分支 + PR + CI 全绿 + Squash merge

**Spec:** `docs/superpowers/specs/2026-08-03-agent-phase-c2-dock-model-skillid-design.md`

---

## File Map

| 文件 | 职责 |
| --- | --- |
| `services/agent-runtime/app/runs.py` | `RunRequest` 扩展、`resolve_llm()` |
| `services/agent-runtime/app/graph/nodes/intake.py` | `requested_skill_id` 门控 |
| `apps/server/src/agent/agent.controller.ts` | `ConversationDto` 扩展 |
| `apps/server/src/agent/agent.service.ts` | resolve model + 转发 |
| `apps/server/src/agent/agent-runtime.client.ts` | `RuntimeRunInput` 扩展 |
| `apps/web/src/constants/agentSkillMap.ts` | UI skillId → Runtime skill_id |
| `apps/web/src/components/agent/AgentSideRail.vue` | model 选择器 + POST body |
| `deploy/prod-phase-c2-dock-verify.py` | 可选生产验收 |

---

### Task 1: Runtime — `resolve_llm` + `RunRequest` 扩展

**Files:**
- Modify: `services/agent-runtime/app/runs.py`
- Create: `services/agent-runtime/tests/test_runs_llm.py`

**Interfaces:**
- Produces: `resolve_llm(req: RunRequest) -> ChatOpenAI`, `RunRequest.skill_id`, `RunRequest.llm_model`, `RunRequest.llm_api_key`, `RunRequest.llm_base_url`

- [ ] **Step 1: Write failing tests**

```python
# services/agent-runtime/tests/test_runs_llm.py
from app.runs import RunRequest, resolve_llm, default_llm

def test_resolve_llm_uses_default_when_no_override():
    req = RunRequest(session_id="s1", user_id="u1", message="hi")
    assert resolve_llm(req) is not None  # same config as default_llm()

def test_resolve_llm_uses_override_credentials():
    req = RunRequest(
        session_id="s1", user_id="u1", message="hi",
        llm_model="gpt-test", llm_api_key="sk-test", llm_base_url="https://api.example/v1",
    )
    llm = resolve_llm(req)
    assert llm.model_name == "gpt-test"
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd services/agent-runtime && python3 -m pytest tests/test_runs_llm.py -v
```

- [ ] **Step 3: Implement**

```python
# runs.py — extend RunRequest
class RunRequest(BaseModel):
    ...
    skill_id: str | None = None
    llm_model: str | None = None
    llm_api_key: str | None = None
    llm_base_url: str | None = None

def resolve_llm(req: RunRequest) -> Any:
    if req.llm_model and req.llm_api_key:
        return ChatOpenAI(
            api_key=req.llm_api_key,
            base_url=req.llm_base_url or settings.openai_base_url,
            model=req.llm_model,
            temperature=0.4,
        )
    if req.llm_model and not req.llm_api_key:
        return ChatOpenAI(
            api_key=settings.openai_api_key or "sk-placeholder",
            base_url=settings.openai_base_url,
            model=req.llm_model,
            temperature=0.4,
        )
    return default_llm()

# stream_run_events — replace graph_llm = ...
graph_llm = resolve_llm(req)
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-runtime): per-request LLM override via RunRequest"
```

---

### Task 2: Runtime — intake `requested_skill_id` 门控

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/intake.py`
- Modify: `services/agent-runtime/app/runs.py` (input_state + interrupt update)
- Modify: `services/agent-runtime/tests/test_intake_gate.py`

**Interfaces:**
- Consumes: `RunRequest.skill_id`
- Produces: `intake` reads `state["requested_skill_id"]`; validates against `discover_skills()`

- [ ] **Step 1: Write failing tests**

```python
@pytest.mark.asyncio
async def test_intake_explicit_skill_overrides_non_marketing_text():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="你好")],
        "requested_skill_id": "enterprise-marketing-campaign",
    })
    assert out.get("skill_id") == "enterprise-marketing-campaign"

@pytest.mark.asyncio
async def test_intake_invalid_requested_skill_falls_back_to_chat():
    node = make_intake_node(SKILLS_DIR)
    out = await node({
        "messages": [HumanMessage(content="你好")],
        "requested_skill_id": "nonexistent-skill",
    })
    assert out.get("skill_id") is None
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement intake logic**

```python
# intake.py — after entries = discover_skills(...)
requested = str(state.get("requested_skill_id") or "").strip()
by_id = {e.skill_id: e for e in entries}
skill_id: str | None = None
if requested and requested in by_id:
    skill_id = requested
elif marketing_intent(text):
    preferred = "enterprise-marketing-campaign"
    ...
```

```python
# runs.py — fresh turn input_state
input_state = {
    ...
    "requested_skill_id": req.skill_id,
}
```

- [ ] **Step 4: Run intake tests — expect PASS**

```bash
python3 -m pytest tests/test_intake_gate.py tests/test_runs_llm.py -v
```

- [ ] **Step 5: Commit**

---

### Task 3: Nest — DTO + ProviderResolver + Runtime 转发

**Files:**
- Modify: `apps/server/src/agent/agent.controller.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts`
- Create: `apps/server/src/agent/agent.service.dock.test.ts` (或扩展现有 test)

**Interfaces:**
- Consumes: `ProviderResolver.resolveForGeneration(userId, model, 'text')`
- Produces: Runtime body `{ skill_id, llm_model, llm_api_key, llm_base_url }`

- [ ] **Step 1: Extend DTO**

```typescript
class ConversationDto {
  ...
  @IsOptional() @IsString() skillId?: string
  @IsOptional() @IsString() model?: string
}
```

- [ ] **Step 2: Map UI skillId → Runtime skill_id in service**

```typescript
const SKILL_UI_TO_RUNTIME: Record<string, string | undefined> = {
  canvas: 'enterprise-marketing-campaign',
  storyboard: undefined,
  polish: undefined,
  organize: undefined,
}

function mapSkillId(uiSkillId?: string): string | undefined {
  if (!uiSkillId) return undefined
  return SKILL_UI_TO_RUNTIME[uiSkillId]
}
```

- [ ] **Step 3: Resolve model when present**

```typescript
let llmModel: string | undefined
let llmApiKey: string | undefined
let llmBaseUrl: string | undefined
if (model && userId) {
  const resolved = await this.providerResolver.resolveForGeneration(userId, model, 'text')
  llmModel = resolved.modelName
  llmApiKey = resolved.credentials.apiKey
  llmBaseUrl = resolved.credentials.baseUrl
}
```

- [ ] **Step 4: Forward in agent-runtime.client.ts**

```typescript
export interface RuntimeRunInput {
  ...
  skillId?: string
  llmModel?: string
  llmApiKey?: string
  llmBaseUrl?: string
}

body: JSON.stringify({
  ...
  skill_id: input.skillId,
  llm_model: input.llmModel,
  llm_api_key: input.llmApiKey,
  llm_base_url: input.llmBaseUrl,
})
```

- [ ] **Step 5: Wire controller → service**

- [ ] **Step 6: Unit test forward payload**

- [ ] **Step 7: Commit**

---

### Task 4: Web — skill 映射 + UniversalModelSelector + POST body

**Files:**
- Create: `apps/web/src/constants/agentSkillMap.ts`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Consumes: `useProviderBootstrap`, `UniversalModelSelector`
- Produces: POST `{ skillId: activeSkillId, model: selectedModel }`

- [ ] **Step 1: Create skill map + runtime skill id helper**

```typescript
// apps/web/src/constants/agentSkillMap.ts
export const AGENT_SKILLS = [
  { id: 'canvas', label: '画布编排', runtimeSkillId: 'enterprise-marketing-campaign', ready: true },
  { id: 'storyboard', label: '分镜脚本', runtimeSkillId: null, ready: false },
  ...
] as const
```

- [ ] **Step 2: Add planning model state + bootstrap load**

```typescript
import UniversalModelSelector from '@/components/canvas/UniversalModelSelector.vue'
import { useProviderBootstrap } from '@/composables/useProviderBootstrap'

const { load, preferences } = useProviderBootstrap()
const planningModel = ref('')

onMounted(async () => {
  await load()
  planningModel.value = preferences.value?.defaultTextModel ?? ''
})
```

- [ ] **Step 3: Replace static span with UniversalModelSelector**

- [ ] **Step 4: Remove skill prefix hack; add send guard**

```typescript
// delete skillPrefix lines
const selectable = preferences.value?.selectableTextModels ?? []
if (planningModel.value && !selectable.includes(planningModel.value)) {
  // toast + return
}
body: JSON.stringify({
  sessionId, message, threadId, userDecision,
  skillId: activeSkillId.value,
  model: planningModel.value || undefined,
})
```

- [ ] **Step 5: Mark unready skills in menu (`开发中`)**

- [ ] **Step 6: Manual smoke — pnpm build**

- [ ] **Step 7: Commit**

---

### Task 5: 回归测试 + 可选生产脚本

**Files:**
- Create: `deploy/prod-phase-c2-dock-verify.py`

- [ ] **Step 1: Run existing prod scripts**

```bash
python3 deploy/prod-phase-b-user-verify.py
python3 deploy/prod-phase-c-user-verify.py
```

- [ ] **Step 2: Add Phase C2 script (minimal)**

- P0 login + runtime health
- POST conversation with `skillId=canvas` + marketing brief → plan 流
- POST with `skillId=storyboard` + "你好" → chat 回复（无 plan 节点）

- [ ] **Step 3: Run runtime + nest tests + pnpm build**

- [ ] **Step 4: Commit + PR**

---

## Spec Coverage Check

| Spec § | Task |
| --- | --- |
| skillId 优先级 | Task 2 |
| UI 映射 | Task 3 + Task 4 |
| 去前缀 | Task 4 |
| model Nest resolve | Task 3 |
| Runtime resolve_llm | Task 1 |
| 停用 model UX | Task 4 |
| Phase B/C 回归 | Task 5 |
| 积分非目标 | — (excluded) |

## Execution Handoff

Plan saved. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks
2. **Inline Execution** — implement tasks in this session with checkpoints

Which approach?
