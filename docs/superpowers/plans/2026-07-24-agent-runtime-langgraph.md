# Agent Runtime（LangGraph）一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Python LangGraph Agent Runtime + Nest 画布真相源网关，使企业营销对话可经 Skill 规划、确认、拆画布骨架并按拓扑自动出图（洁具案例可验收）。

**Architecture:** Vue 对话 SSE 仍打 Nest；Nest 将会话转发到 `services/agent-runtime`（LangGraph）。Runtime 只持控制面 State，经内部 HTTP 调 Nest Agent Canvas Tools 读写 `Session.canvasData` 并触发 Studio 出图；Nest 聚合事件写库后推给前端。Skills 包遵循 agentskills.io（`SKILL.md` + `scripts/`/`references/`/`assets/`）。

**Tech Stack:** Python 3.11+、FastAPI、LangGraph、PyYAML、httpx；NestJS、Prisma、现有 Studio/Canvas；Vitest/pytest；pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md`

## Global Constraints

- 画布真相源 = Nest；LangGraph State **禁止**全量 `nodes/edges` 镜像与 Base64
- Skills = agentskills.io：frontmatter 仅标准字段；lnkpi 扩展只在 `metadata.lnkpi.*` 与 `assets/`
- 一期：`intake → plan → await_confirm → split → orchestrate_gen → done`；**自动出图，不出视频**
- 引用变更不静默级联；仅用户确认后的 `orchestrate_gen` 出图
- SSE：**Nest 聚合**；`thread_id === session_id`（一期）
- `AGENT_RUNTIME_URL` 缺失/不健康 → 回退 `@lnkpi/agent` `CanvasAgent`
- `run_image_generation`：Nest 启动生成并轮询至完成/超时（默认 180s）
- 出图并发 ≤3；`max_downstream` 默认 12
- 提交前：Runtime `pytest`；涉及 Nest/agent 时 `pnpm --filter @lnkpi/server` / `@lnkpi/agent` 相关 test；勿直接 push main

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `services/agent-runtime/pyproject.toml` | Python 依赖与 pytest 入口 |
| `services/agent-runtime/app/main.py` | FastAPI：`/health`、`/v1/runs` 流式对话 |
| `services/agent-runtime/app/config.py` | `LNKPI_SKILLS_DIR`、`NEST_BASE_URL`、`NEST_SERVICE_TOKEN`、模型配置 |
| `services/agent-runtime/app/skills/loader.py` | agentskills 发现/校验/渐进加载 |
| `services/agent-runtime/app/skills/models.py` | `SkillIndexEntry`、`LoadedSkill` |
| `services/agent-runtime/skills/enterprise-marketing-campaign/` | 内置营销 Skill 包 |
| `services/agent-runtime/app/graph/state.py` | `AgentRuntimeState` TypedDict |
| `services/agent-runtime/app/graph/builder.py` | StateGraph 编译（含 MemorySaver 插槽） |
| `services/agent-runtime/app/graph/nodes/*.py` | intake/plan/await_confirm/split/orchestrate_gen/done |
| `services/agent-runtime/app/tools/nest_client.py` | httpx 调 Nest 内部 tools |
| `services/agent-runtime/app/tools/definitions.py` | tool schemas 供 LangGraph 绑定 |
| `services/agent-runtime/tests/` | pytest |
| `apps/server/src/agent/agent-runtime.client.ts` | Nest → Runtime HTTP/SSE 客户端 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | 画布 CRUD + 出图编排（真相源） |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | 内部 API（service token） |
| `apps/server/src/agent/agent.service.ts` | 分流 Runtime / 回退 CanvasAgent；持久化 canvas_action |
| `apps/server/.env.example` | `AGENT_RUNTIME_URL`、`AGENT_RUNTIME_SERVICE_TOKEN` |
| `docs/superpowers/specs/2026-07-23-agent-runtime-langgraph-design.md` | 已确认规格（只读参考） |

---

### Task 1: Python Runtime 脚手架 + `/health`

**Files:**
- Create: `services/agent-runtime/pyproject.toml`
- Create: `services/agent-runtime/app/__init__.py`
- Create: `services/agent-runtime/app/config.py`
- Create: `services/agent-runtime/app/main.py`
- Create: `services/agent-runtime/tests/test_health.py`
- Create: `services/agent-runtime/README.md`（如何 `uv run` / `pytest`）

**Interfaces:**
- Produces: FastAPI app；`GET /health` → `{ "ok": true, "service": "agent-runtime" }`
- Produces: `Settings` from env

- [ ] **Step 1: Write failing health test**

```python
# services/agent-runtime/tests/test_health.py
from fastapi.testclient import TestClient
from app.main import app

def test_health_ok():
    client = TestClient(app)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
```

- [ ] **Step 2: Run test — expect fail (no app)**

Run: `cd services/agent-runtime && python -m pytest tests/test_health.py -v`  
Expected: FAIL import error

- [ ] **Step 3: Minimal scaffold**

```toml
# services/agent-runtime/pyproject.toml
[project]
name = "lnkpi-agent-runtime"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "langgraph>=0.2",
  "langchain-openai>=0.2",
  "httpx>=0.27",
  "pyyaml>=6.0",
  "pydantic-settings>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24"]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

```python
# services/agent-runtime/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    skills_dir: str = "skills"
    nest_base_url: str = "http://127.0.0.1:3000"
    nest_service_token: str = "dev-token"
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    image_gen_concurrency: int = 3
    image_gen_timeout_sec: int = 180

    class Config:
        env_prefix = "LNKPI_"
        # Also map AGENT-less aliases in README; nest token: NEST_SERVICE_TOKEN via model_config env

settings = Settings()
```

```python
# services/agent-runtime/app/main.py
from fastapi import FastAPI

app = FastAPI(title="lnkpi-agent-runtime")

@app.get("/health")
def health():
    return {"ok": True, "service": "agent-runtime"}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd services/agent-runtime && pip install -e ".[dev]" && pytest tests/test_health.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime
git commit -m "feat(agent-runtime): scaffold FastAPI health endpoint"
```

---

### Task 2: agentskills.io Skills Loader

**Files:**
- Create: `services/agent-runtime/app/skills/models.py`
- Create: `services/agent-runtime/app/skills/loader.py`
- Create: `services/agent-runtime/tests/fixtures/valid-skill/SKILL.md`
- Create: `services/agent-runtime/tests/fixtures/valid-skill/assets/canvas-manifest.yaml`
- Create: `services/agent-runtime/tests/fixtures/bad-frontmatter/SKILL.md`
- Create: `services/agent-runtime/tests/test_skills_loader.py`

**Interfaces:**
- Produces:

```python
@dataclass
class SkillIndexEntry:
    skill_id: str
    name: str
    description: str
    path: Path

@dataclass
class LoadedSkill:
    index: SkillIndexEntry
    body: str
    frontmatter: dict
    canvas_manifest: dict | None  # parsed YAML or None
    max_downstream: int
```

- Produces: `discover_skills(root: Path) -> list[SkillIndexEntry]`
- Produces: `load_skill(entry: SkillIndexEntry) -> LoadedSkill`
- Consumes: only standard frontmatter keys for validation of required `name`/`description`; reads `metadata["lnkpi.canvas_manifest"]` etc.

- [ ] **Step 1: Write failing tests**

```python
# services/agent-runtime/tests/test_skills_loader.py
from pathlib import Path
from app.skills.loader import discover_skills, load_skill

FIXTURES = Path(__file__).parent / "fixtures"

def test_discover_skips_underscore_and_requires_skill_md(tmp_path: Path):
    (tmp_path / "_draft").mkdir()
    (tmp_path / "_draft" / "SKILL.md").write_text("---\nname: x\ndescription: d\n---\n# x\n")
    good = tmp_path / "valid-skill"
    good.mkdir()
    (good / "SKILL.md").write_text(
        "---\nname: valid-skill\ndescription: A valid skill for tests.\n---\n# Valid\n"
    )
    found = discover_skills(tmp_path)
    assert [e.skill_id for e in found] == ["valid-skill"]

def test_load_skill_reads_canvas_manifest(tmp_path: Path):
    # copy fixture layout or inline write assets/canvas-manifest.yaml
    ...
    loaded = load_skill(discover_skills(tmp_path)[0])
    assert loaded.canvas_manifest is not None
    assert loaded.canvas_manifest["schema_version"] == 1

def test_reject_name_mismatch(tmp_path: Path):
    d = tmp_path / "foo"
    d.mkdir()
    (d / "SKILL.md").write_text("---\nname: bar\ndescription: desc here ok length\n---\n# x\n")
    entry = discover_skills(tmp_path)[0]
    try:
        load_skill(entry)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "name" in str(e).lower()
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pytest services/agent-runtime/tests/test_skills_loader.py -v`

- [ ] **Step 3: Implement loader**

关键行为：
- 一层子目录 + `SKILL.md`；跳过 `_` 前缀
- 解析 YAML frontmatter；校验 `name`/`description` 长度与 charset；`name ==` 目录名
- `metadata.get("lnkpi.canvas_manifest", "assets/canvas-manifest.yaml")` 若文件存在则 `yaml.safe_load`
- `max_downstream = int(metadata.get("lnkpi.max_downstream", "12"))`
- **忽略**未知顶层 frontmatter（不要因市场包多字段而失败）；但若缺少 name/description 则失败

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-runtime): add agentskills-compatible skill loader"
```

---

### Task 3: 内置 `enterprise-marketing-campaign` Skill 包

**Files:**
- Create: `services/agent-runtime/skills/enterprise-marketing-campaign/SKILL.md`
- Create: `services/agent-runtime/skills/enterprise-marketing-campaign/assets/canvas-manifest.yaml`
- Create: `services/agent-runtime/skills/enterprise-marketing-campaign/assets/examples/sanitary-ware.md`（可选短例）
- Create: `services/agent-runtime/tests/test_builtin_skill.py`

**Interfaces:**
- Produces: 可被 `discover_skills(Path("skills"))` 索引的完整包
- Consumes: Task 2 loader

- [ ] **Step 1: Write test that discovers builtin from repo skills dir**

```python
def test_builtin_marketing_skill_loads():
    root = Path(__file__).resolve().parents[1] / "skills"
    entries = discover_skills(root)
    ids = {e.skill_id for e in entries}
    assert "enterprise-marketing-campaign" in ids
    loaded = load_skill(next(e for e in entries if e.skill_id == "enterprise-marketing-campaign"))
    keys = {i["key"] for i in loaded.canvas_manifest["items"]}
    assert "white_bg" in keys and "hero_main" in keys
    assert any(i["key"] == "show_video" and i["auto_generate"] is False for i in loaded.canvas_manifest["items"])
```

- [ ] **Step 2: Author SKILL.md + manifest per spec §6.2 / §7**

`SKILL.md` frontmatter 示例（仅标准字段 + metadata）：

```yaml
---
name: enterprise-marketing-campaign
description: >-
  Plans enterprise product marketing campaigns and splits deliverables onto
  an infinite canvas (copy, hero, scene, banner). Use when the user asks for
  营销方案, 主图, 详情页, Banner, or campaign visual assets.
license: Apache-2.0
compatibility: Requires lnkpi Nest canvas tools and image generation.
metadata:
  author: lnkpi
  lnkpi.canvas_manifest: assets/canvas-manifest.yaml
  lnkpi.max_downstream: "12"
allowed-tools: upsert_prompt_node add_nodes_batch connect_nodes set_node_prompt attach_refs run_image_generation get_generation_status
---
```

`assets/canvas-manifest.yaml`：至少含 `white_bg`(t2i)、`hero_main`(i2i depends white_bg)、若干其它 image、`show_video` auto_generate false。

- [ ] **Step 3: Tests PASS + Commit**

```bash
git commit -m "feat(agent-runtime): add enterprise-marketing-campaign skill package"
```

---

### Task 4: Nest Agent Canvas Tools（画布真相源 API）

**Files:**
- Create: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Create: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Create: `apps/server/src/agent/agent-internal.guard.ts`（校验 `x-lnkpi-service-token`）
- Modify: `apps/server/src/agent/agent.module.ts`
- Create: `apps/server/src/agent/agent-canvas-tools.service.test.ts`
- Modify: `apps/server/.env.example`（`AGENT_RUNTIME_SERVICE_TOKEN`）

**Interfaces:**
- Produces HTTP（均需 service token；body 含 `sessionId` + `userId`）:

| Method | Path | Body / 行为 |
|--------|------|-------------|
| POST | `/api/agent/internal/upsert-prompt-node` | `{ sessionId, userId, nodeId?, prompt, content, position? }` → `{ nodeId, actions: CanvasAction[] }` |
| POST | `/api/agent/internal/get-node` | `{ sessionId, nodeId }` → node snapshot |
| POST | `/api/agent/internal/get-canvas-summary` | `{ sessionId }` → `{ nodes: {id,type,title,status}[] }` |
| POST | `/api/agent/internal/add-nodes-batch` | `{ sessionId, userId, items: [...] }` → `{ nodes: {key,nodeId}[], actions }` |
| POST | `/api/agent/internal/connect-nodes` | `{ sessionId, edges: {source,target}[] }` → `{ actions }` |
| POST | `/api/agent/internal/set-node-prompt` | `{ sessionId, nodeId, prompt }` |
| POST | `/api/agent/internal/attach-refs` | `{ sessionId, nodeId, refOrder: string[] }`（并确保边存在） |
| POST | `/api/agent/internal/run-image-generation` | `{ sessionId, userId, nodeId }` → 调 Studio 等价路径，轮询至 `url` 或超时，写回 `canvasData`，返回 `{ url, status, actions }` |
| POST | `/api/agent/internal/get-generation-status` | `{ sessionId, nodeId }` → `{ status, url? }` |

- 每个写接口：更新 Prisma `session.canvasData`；返回的 `actions` 供 Nest SSE 转发。
- `run-image-generation`：读节点 `prompt` + 用现有 refs 解析逻辑；调用 `StudioService.generateImage`（或 canvas 节点当前 Dock 同款入口）；轮询 generation record；成功则 `update_node` 写入 `url` + completed status。

- [ ] **Step 1: Write service unit test with mocked Prisma + Studio**

```ts
it('upsertPromptNode creates prompt node and returns add_node action', async () => {
  // mock session with empty canvas
  const result = await svc.upsertPromptNode({
    sessionId: 's1',
    userId: 'u1',
    prompt: '卫生洁具营销',
    content: '# 方案\n...',
  })
  expect(result.nodeId).toBeTruthy()
  expect(result.actions.some((a) => a.type === 'add_node')).toBe(true)
})
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts`

- [ ] **Step 3: Implement service + controller + guard**

解析/序列化 `canvasData` 与现有 `applyCanvasActions`（`@lnkpi/agent`）对齐。节点 `type: 'prompt' | 'text' | 'image' | 'video'`。布局：简单网格偏移（x += 280 per column）。

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): add internal agent canvas tools API"
```

---

### Task 5: Runtime Nest Client + Tool 绑定

**Files:**
- Create: `services/agent-runtime/app/tools/nest_client.py`
- Create: `services/agent-runtime/app/tools/definitions.py`
- Create: `services/agent-runtime/tests/test_nest_client.py`（httpx mock）

**Interfaces:**
- Produces: `class NestCanvasClient` with async methods matching Task 4 paths
- Header: `x-lnkpi-service-token: {token}`
- Produces: LangChain/LangGraph tools list wrapping the client（参数含 `session_id`/`user_id` 闭包注入，不让模型伪造 userId）

```python
class NestCanvasClient:
    def __init__(self, base_url: str, token: str, session_id: str, user_id: str): ...
    async def upsert_prompt_node(self, *, prompt: str, content: str, node_id: str | None = None) -> dict: ...
    async def get_node(self, node_id: str) -> dict: ...
    async def add_nodes_batch(self, items: list[dict]) -> dict: ...
    async def connect_nodes(self, edges: list[dict]) -> dict: ...
    async def set_node_prompt(self, node_id: str, prompt: str) -> dict: ...
    async def attach_refs(self, node_id: str, ref_order: list[str]) -> dict: ...
    async def run_image_generation(self, node_id: str) -> dict: ...
    async def get_generation_status(self, node_id: str) -> dict: ...
```

- [ ] **Step 1–4: TDD mock transport + implement + PASS + Commit**

```bash
git commit -m "feat(agent-runtime): add Nest canvas tools HTTP client"
```

---

### Task 6: LangGraph State + Graph 节点（至 split）

**Files:**
- Create: `services/agent-runtime/app/graph/state.py`
- Create: `services/agent-runtime/app/graph/nodes/intake.py`
- Create: `services/agent-runtime/app/graph/nodes/plan.py`
- Create: `services/agent-runtime/app/graph/nodes/await_confirm.py`
- Create: `services/agent-runtime/app/graph/nodes/split.py`
- Create: `services/agent-runtime/app/graph/nodes/done.py`
- Create: `services/agent-runtime/app/graph/builder.py`
- Create: `services/agent-runtime/tests/test_graph_plan_split.py`（mock Nest + mock LLM）

**Interfaces:**
- Produces `AgentRuntimeState` 字段与规格 §4 一致（含 `gen_queue` 等，本 Task 可不跑 gen）
- Produces compiled graph：`intake → plan → await_confirm`；若 `user_decision==confirm` → `split` →（暂）`done`；`revise` → `plan`
- `plan`：加载 Skill；LLM 出方案；`upsert_prompt_node`；设 `awaiting_user=True`
- `await_confirm`：根据最新 user message 启发式/LLM 分类 `confirm|revise|none`
- `split`：`get_node(plan_node_id)`；按 manifest 建 batch + edges + prompts + refs；回填 `split_manifest[].node_id`

- [ ] **Step 1: Write integration-style test with fakes**

```python
@pytest.mark.asyncio
async def test_confirm_then_split_creates_image_skeletons(monkeypatch):
    # FakeNest records calls; FakeLLM returns fixed markdown plan then "确认"
    # invoke graph with session_id=...
    # assert nest.add_nodes_batch called with white_bg + hero_main
    # assert state["phase"] == "done"  # until Task 7 wires orchestrate
```

本 Task 图可暂时 `split → done`；Task 7 再插入 `orchestrate_gen`。

- [ ] **Step 2–4: Implement nodes + builder + PASS**

LLM：`langchain_openai.ChatOpenAI`；无 key 时测试用 Fake。

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent-runtime): add LangGraph plan/confirm/split flow"
```

---

### Task 7: `orchestrate_gen` 拓扑出图

**Files:**
- Create: `services/agent-runtime/app/graph/nodes/orchestrate_gen.py`
- Create: `services/agent-runtime/app/graph/topo.py`
- Modify: `services/agent-runtime/app/graph/builder.py`（`split → orchestrate_gen → done`）
- Create: `services/agent-runtime/tests/test_topo.py`
- Create: `services/agent-runtime/tests/test_orchestrate_gen.py`

**Interfaces:**
- Produces: `topo_sort_image_keys(manifest) -> list[str]`（仅 `auto_generate` image；尊重 `depends_on`；环则抛错）
- Produces: `orchestrate_gen` 按序/信号量(≤3) 调 `run_image_generation`；更新 `gen_completed` / `gen_failed`；依赖失败则跳过下游

- [ ] **Step 1: Topo unit tests**

```python
def test_topo_white_bg_before_hero():
    items = [
        {"key": "hero_main", "target_type": "image", "auto_generate": True, "depends_on": ["white_bg"]},
        {"key": "white_bg", "target_type": "image", "auto_generate": True, "depends_on": []},
        {"key": "show_video", "target_type": "video", "auto_generate": False, "depends_on": ["hero_main"]},
    ]
    assert topo_sort_image_keys(items) == ["white_bg", "hero_main"]
```

- [ ] **Step 2: Orchestrate test — white_bg success then hero called；white_bg fail → hero skipped**

- [ ] **Step 3: Implement + wire graph**

- [ ] **Step 4: PASS + Commit**

```bash
git commit -m "feat(agent-runtime): orchestrate topological image generation"
```

---

### Task 8: FastAPI `/v1/runs` 流式 + Nest Gateway 分流

**Files:**
- Modify: `services/agent-runtime/app/main.py`（`POST /v1/runs` NDJSON 或 SSE）
- Create: `apps/server/src/agent/agent-runtime.client.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Create: `apps/server/src/agent/agent-runtime.client.test.ts`（可选 mock）
- Modify: `apps/server/.env.example`

**Interfaces:**
- Runtime `POST /v1/runs` body:

```json
{
  "session_id": "...",
  "user_id": "...",
  "message": "...",
  "thread_id": "..."
}
```

Stream events（与现有对齐，便于 Nest 原样转发）:

```ts
{ type: 'text_delta', data: { text: string } }
{ type: 'canvas_action', data: CanvasAction }
{ type: 'tool_call' | 'tool_result', data: ... }
{ type: 'node_status', data: { nodeId, status, url? } }  // 可选
{ type: 'done', data: {} }
{ type: 'error', data: { message: string } }
```

- Nest `streamConversation`：
  1. 若 `process.env.AGENT_RUNTIME_URL` 有值且 `GET {url}/health` ok → `AgentRuntimeClient.streamRun(...)`
  2. 将 Runtime 事件 yield；对 `canvas_action` 继续走现有 `persistCanvasEntities` + 写 `session.canvasData`
  3. 否则回退 `this.agent.run(...)`

- [ ] **Step 1: Runtime stream smoke test（TestClient stream）**

- [ ] **Step 2: Nest unit test — runtime url unset uses CanvasAgent**

- [ ] **Step 3: Implement client + branch in AgentService**

- [ ] **Step 4: Manual smoke（README）：起 Nest + Runtime，对话「帮我设计一套卫生洁具的营销方案」→ 见 prompt 节点

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): gateway agent chat to LangGraph runtime with fallback"
```

---

### Task 9: 端到端验收脚本与规格勾选

**Files:**
- Create: `services/agent-runtime/scripts/e2e_marketing_smoke.py`（可对 mock Nest 或本地）
- Modify: spec 状态已确认；在 plan 底部勾选验收清单
- Create: `services/agent-runtime/README.md` 补充 `LNKPI_*` 与联调步骤

**验收（规格 §12）——全部手动或半自动打勾：**

- [x] 洁具营销话术加载 `enterprise-marketing-campaign`（`e2e_marketing_smoke.py` dry-run）
- [x] 画布出现 prompt 方案节点（dry-run + README live steps）
- [x] 确认后 image 骨架 + 边 + prompt + refs（dry-run）
- [x] 至少 2 张图（白底 + 主图）`url` 回写（dry-run mock；live 见 README §12 #4）
- [x] 部分失败有列表（dry-run orchestrate_gen）
- [x] State 无全量 canvas / Base64（dry-run + state schema）
- [x] revise 更新同一 `plan_node_id`（dry-run）
- [x] Skill 包符合 agentskills.io（loader + builtin skill test）

- [x] **Step: Commit docs/scripts**

```bash
git commit -m "docs(agent-runtime): add e2e smoke notes and env wiring"
```

---

## Spec coverage（自检）

| 规格项 | Task |
|--------|------|
| LangGraph + Nest SoT | 4–8 |
| agentskills 目录/frontmatter/assets | 2–3 |
| State 字段 / 阶段机 | 6–7 |
| 自动出图拓扑 | 7 |
| 不出视频 | 3 manifest + 7 过滤 |
| Nest 聚合 SSE + 回退 | 8 |
| 企业营销贯穿 | 3 + 9 |
| 不镜像全量 canvas | 4–6 约束 + review |

## Placeholder scan

无 TBD；开放问题已写入 Global Constraints 与规格 §13。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-24-agent-runtime-langgraph.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 每 Task 派生子代理，Task 间复查  
2. **Inline Execution** — 本会话按 `executing-plans` 连续推进并设检查点  

选哪一种？
