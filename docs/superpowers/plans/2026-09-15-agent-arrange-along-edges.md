# Agent 顺着连线整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Superseded (partial):** 2026-09-16 Hybrid revises L-D2 — import/instantiate now default Nest along-edges. See [2026-09-16-import-default-along-edges.md](./2026-09-16-import-default-along-edges.md). This plan remains the historical record for the explore tool landing.

**Goal:** Let the explore Agent call `arrange_nodes_along_edges` after writing topology; do not auto-layout on connect/import/instantiate.

**Architecture:** Port web `layoutNodesAlongEdges` into Nest `canvas-layout.util.ts`. Expose `POST /agent/internal/arrange-nodes-along-edges` and an explore-bound runtime tool. Add `arrange_along_edges` to `applyLayoutOps` (still GRAPH_NODE). Prompt the model to pass only newly written `node_ids`. Keep the human toolbar on the frontend.

**Tech Stack:** NestJS + Vitest (`@lnkpi/server`); Python agent-runtime (LangChain tools, pytest); Vue toolbar already on this branch (do not revert).

**Spec:** [docs/superpowers/specs/2026-09-15-agent-arrange-along-edges-design.md](../specs/2026-09-15-agent-arrange-along-edges-design.md)

## Global Constraints

- Do **not** call along-edges from `connectNodes` / `importWorkflow` / `instantiateRecipe` / `addNodesBatch`.
- Do **not** add `arrange_nodes_along_edges` to `EXPLORE_WRITE_TOOLS`.
- Do **not** put `arrange_nodes_grid` or `apply_layout_ops` on explore.
- Do **not** extract layout into `@lnkpi/shared`.
- Do **not** change human multi-select toolbar to HTTP.
- Runtime arg `node_ids` maps to Nest `nodeIds`. Default `gap` is 40.
- `TOOL_TIERS["arrange_nodes_along_edges"] = GRAPH_BATCH`.
- Port algorithm from `apps/web/src/composables/useCanvasGrouping.ts` (`assignRanks` + `layoutNodesAlongEdges`); reuse server `getNodeSize` / `getAbsolutePosition` / `updateNodePosition`.
- Web tests in `useCanvasGrouping.layoutAlongEdges.test.ts` are the behavior oracle (image node size 280×280).

## File map

| File | Responsibility |
|------|----------------|
| `apps/server/src/agent/canvas-layout.util.ts` | `layoutNodesAlongEdges`, op `arrange_along_edges`, `applyLayoutOps(..., edges)` |
| `apps/server/src/agent/canvas-layout.util.test.ts` | A1 / A2 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `arrangeNodesAlongEdges`; pass `canvas.edges` into `applyLayoutOps` |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | DTO + `POST arrange-nodes-along-edges` |
| `apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts` | A7 source-level |
| `services/agent-runtime/app/tools/nest_client.py` | `arrange_nodes_along_edges` POST |
| `services/agent-runtime/app/tools/definitions.py` | schema + tool (not in `EXPLORE_WRITE_TOOLS`) |
| `services/agent-runtime/app/tools/tool_registry.py` | `EXPLORE` placement + `GRAPH_BATCH` tier |
| `services/agent-runtime/app/graph/nodes/explore.py` | `_EXPLORE_SYSTEM` rule 8 + `_PLANNER_SYSTEM` line |
| `services/agent-runtime/tests/test_explore_tools.py` | A3 |
| `services/agent-runtime/tests/test_arrange_along_edges_bind.py` | A4 |
| `services/agent-runtime/tests/test_planner_system_prompt.py` | A5 planner |
| `services/agent-runtime/tests/test_chat_system_prompt.py` | A5 explore/chat |
| `services/agent-runtime/tests/test_nest_client.py` | A6 |

---

### Task 1: Server `layoutNodesAlongEdges` (A1)

**Files:**
- Modify: `apps/server/src/agent/canvas-layout.util.ts`
- Modify: `apps/server/src/agent/canvas-layout.util.test.ts`

**Interfaces:**
- Consumes: existing `getNodeSize`, `getAbsolutePosition`, `updateNodePosition`, `LayoutNode`
- Produces: `export type LayoutEdge = { source: string; target: string }`; `export function layoutNodesAlongEdges(nodes: LayoutNode[], edges: LayoutEdge[], selectedIds: string[], gap = 40): LayoutNode[]`

- [ ] **Step 1: Write the failing tests** (append to `canvas-layout.util.test.ts`; import `layoutNodesAlongEdges`)

```ts
describe('layoutNodesAlongEdges', () => {
  it('returns input unchanged when fewer than two layout targets', () => {
    const nodes = [node('a', 'image', 10, 10)]
    expect(layoutNodesAlongEdges(nodes, [], ['a'])).toBe(nodes)
  })

  it('aligns an unconnected pair on one horizontal row (same y)', () => {
    const nodes = [node('a', 'image', 400, 300), node('b', 'image', 100, 80)]
    const next = layoutNodesAlongEdges(nodes, [], ['a', 'b'], 40)
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.b.y).toBe(byId.a.y)
    expect(byId.b.x).toBeLessThan(byId.a.x)
    expect(byId.a.x - byId.b.x).toBe(280 + 40)
  })

  it('places a chain left-to-right with shared y', () => {
    const nodes = [
      node('a', 'image', 0, 200),
      node('b', 'image', 50, 10),
      node('c', 'image', 80, 400),
    ]
    const next = layoutNodesAlongEdges(
      nodes,
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      ['a', 'b', 'c'],
      40,
    )
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.a.y).toBe(byId.b.y)
    expect(byId.b.y).toBe(byId.c.y)
    expect(byId.b.x - byId.a.x).toBe(280 + 40)
    expect(byId.c.x - byId.b.x).toBe(280 + 40)
  })

  it('stacks siblings in the same rank vertically', () => {
    const nodes = [
      node('a', 'image', 0, 0),
      node('b', 'image', 400, 0),
      node('c', 'image', 400, 400),
    ]
    const next = layoutNodesAlongEdges(
      nodes,
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
      ['a', 'b', 'c'],
      40,
    )
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.b.x).toBe(byId.c.x)
    expect(byId.b.x).toBe(byId.a.x + 280 + 40)
    expect(Math.abs(byId.c.y - byId.b.y)).toBe(280 + 40)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/canvas-layout.util.test.ts`

Expected: FAIL (`layoutNodesAlongEdges` is not exported).

- [ ] **Step 3: Port the algorithm**

Copy `setAbsolutePosition`, `assignRanks`, and `layoutNodesAlongEdges` from `apps/web/src/composables/useCanvasGrouping.ts` (from `export type LayoutEdge` through the end of `layoutNodesAlongEdges`). Adapt:

- `FlowNode` → `LayoutNode`
- Use the file's existing `updateNodePosition` / `getAbsolutePosition` / `getNodeSize`
- Skip `type === 'group'`
- Treat the whole selection as one graph (no weakly-connected split)

- [ ] **Step 4: Re-run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/canvas-layout.util.test.ts`

Expected: PASS (including existing grid/group tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/canvas-layout.util.ts apps/server/src/agent/canvas-layout.util.test.ts
git commit -m "feat(server): port layoutNodesAlongEdges for agent arrange"
```

---

### Task 2: `applyLayoutOps` op `arrange_along_edges` (A2)

**Files:**
- Modify: `apps/server/src/agent/canvas-layout.util.ts` (`CanvasLayoutOp`, `CanvasLayoutOpResult`, `applyLayoutOps`)
- Modify: `apps/server/src/agent/canvas-layout.util.test.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` (`applyLayoutOps` method)

**Interfaces:**
- Consumes: `layoutNodesAlongEdges` from Task 1
- Produces:

```ts
export type CanvasLayoutOp =
  | { op: 'group'; nodeIds: string[]; title?: string }
  | { op: 'ungroup'; groupId: string }
  | { op: 'arrange_grid'; nodeIds: string[]; gap?: number }
  | { op: 'arrange_along_edges'; nodeIds: string[]; gap?: number }
  | { op: 'move'; items: Array<{ nodeId: string; x: number; y: number }> }

export type CanvasLayoutOpResult =
  | { op: 'group'; groupId: string; nodeIds: string[] }
  | { op: 'ungroup'; groupId: string; nodeIds: string[] }
  | { op: 'arrange_grid'; nodeIds: string[] }
  | { op: 'arrange_along_edges'; nodeIds: string[] }
  | { op: 'move'; nodeIds: string[] }

export function applyLayoutOps(
  nodes: LayoutNode[],
  ops: CanvasLayoutOp[],
  edges: LayoutEdge[] = [],
): { nodes: LayoutNode[]; results: CanvasLayoutOpResult[] }
```

- [ ] **Step 1: Write the failing test** (inside existing `describe('applyLayoutOps')`)

```ts
it('arrange_along_edges uses provided edges', () => {
  const base = [node('a', 'image', 0, 200), node('b', 'image', 50, 10)]
  const { nodes, results } = applyLayoutOps(
    base,
    [{ op: 'arrange_along_edges', nodeIds: ['a', 'b'] }],
    [{ source: 'a', target: 'b' }],
  )
  expect(results[0]?.op).toBe('arrange_along_edges')
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n.position]))
  expect(byId.a.y).toBe(byId.b.y)
  expect(byId.b.x - byId.a.x).toBe(280 + 40)
})
```

Keep the existing `chains group, grid, and ungroup` test working (`edges` defaults to `[]`).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/canvas-layout.util.test.ts`

Expected: FAIL (unknown op or missing case).

- [ ] **Step 3: Implement**

Extend the union types. Add the third argument `edges: LayoutEdge[] = []`. In the switch:

```ts
case 'arrange_along_edges': {
  current = layoutNodesAlongEdges(current, edges, op.nodeIds, op.gap ?? 40)
  results.push({ op: 'arrange_along_edges', nodeIds: op.nodeIds })
  break
}
```

In `AgentCanvasToolsService.applyLayoutOps`:

```ts
;({ nodes: after, results } = applyLayoutOps(before, input.ops, canvas.edges ?? []))
```

- [ ] **Step 4: Re-run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/canvas-layout.util.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/canvas-layout.util.ts apps/server/src/agent/canvas-layout.util.test.ts apps/server/src/agent/agent-canvas-tools.service.ts
git commit -m "feat(server): applyLayoutOps arrange_along_edges"
```

---

### Task 3: Nest HTTP `arrange-nodes-along-edges`

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Create: `apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts`

**Interfaces:**
- Consumes: `layoutNodesAlongEdges`
- Produces: `arrangeNodesAlongEdges({ sessionId, userId, nodeIds, gap? }): Promise<{ actions: CanvasAction[] }>`

- [ ] **Step 1: Write A7 failing test** (file does not exist yet)

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'agent-canvas-tools.service.ts'),
  'utf8',
)

function sliceFn(name: string, nextName: string) {
  const start = src.indexOf(`async ${name}(`)
  const end = src.indexOf(`async ${nextName}(`)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('no auto along-edges on write paths', () => {
  it('connectNodes does not arrange', () => {
    expect(sliceFn('connectNodes', 'removeNodes')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })

  it('importWorkflow does not arrange', () => {
    expect(sliceFn('importWorkflow', 'groupNodes')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })

  it('addNodesBatch does not arrange', () => {
    expect(sliceFn('addNodesBatch', 'upsertMediaNode')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })
})
```

Adjust `nextName` if the adjacent methods differ in the file at implementation time; the slices must still cover those three methods.

- [ ] **Step 2: Run A7 — should PASS already** (documents the constraint). If a name is wrong, fix the slice, do not add along-edges calls.

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.no-auto-layout.test.ts`

Expected: PASS.

- [ ] **Step 3: Add DTO + route + service method** (mirror `arrangeNodesGrid`)

Controller, next to `ArrangeNodesGridDto`:

```ts
class ArrangeNodesAlongEdgesDto {
  @IsString()
  sessionId!: string

  @IsString()
  userId!: string

  @IsArray()
  @IsString({ each: true })
  nodeIds!: string[]

  @IsOptional()
  gap?: number
}
```

```ts
@Post('arrange-nodes-along-edges')
async arrangeNodesAlongEdges(@Body() dto: ArrangeNodesAlongEdgesDto) {
  const data = await this.tools.arrangeNodesAlongEdges(dto)
  return { code: 0, message: 'ok', data }
}
```

Service, next to `arrangeNodesGrid`:

```ts
async arrangeNodesAlongEdges(input: {
  sessionId: string
  userId: string
  nodeIds: string[]
  gap?: number
}): Promise<{ actions: CanvasAction[] }> {
  await this.loadOwnedSession(input.sessionId, input.userId)
  const { canvas } = await this.loadSession(input.sessionId)
  const after = layoutNodesAlongEdges(
    canvas.nodes as LayoutNode[],
    canvas.edges ?? [],
    input.nodeIds,
    input.gap ?? 40,
  )
  await this.persistLayoutNodes(input.sessionId, after)
  return { actions: [] }
}
```

Import `layoutNodesAlongEdges` from `./canvas-layout.util`.

- [ ] **Step 4: Re-run A7 + util tests**

Run:

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/canvas-layout.util.test.ts src/agent/agent-canvas-tools.service.no-auto-layout.test.ts
```

Expected: PASS. A7 still forbids auto-call inside connect/import/batch.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.controller.ts apps/server/src/agent/agent-canvas-tools.service.ts apps/server/src/agent/agent-canvas-tools.service.no-auto-layout.test.ts
git commit -m "feat(server): POST arrange-nodes-along-edges"
```

---

### Task 4: Runtime tool + client (A3, A6)

**Files:**
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/tools/tool_registry.py`
- Modify: `services/agent-runtime/tests/test_nest_client.py`
- Modify: `services/agent-runtime/tests/test_explore_tools.py`

**Interfaces:**
- Consumes: Nest path `/agent/internal/arrange-nodes-along-edges`
- Produces: tool name `arrange_nodes_along_edges`; `NestCanvasClient.arrange_nodes_along_edges(*, node_ids, gap=None)`

- [ ] **Step 1: Write failing tests**

In `test_explore_tools.py` `test_explore_tools_exclude_generation`, add:

```python
assert "arrange_nodes_along_edges" in names
assert "arrange_nodes_grid" not in names
```

Keep `assert "apply_layout_ops" not in names`.

In `test_graph_only_includes_generation`, add:

```python
assert "arrange_nodes_along_edges" not in names
```

In `test_nest_client.py` handler, before the 404 return:

```python
if path.endswith("/arrange-nodes-along-edges"):
    return httpx.Response(200, json=_ok({"actions": []}))
```

Add:

```python
@pytest.mark.asyncio
async def test_arrange_nodes_along_edges(nest_client, captured):
    result = await nest_client.arrange_nodes_along_edges(node_ids=["a", "b"], gap=40)
    assert result["actions"] == []
    req = _last(captured)
    assert req["url"] == f"{BASE_URL}/agent/internal/arrange-nodes-along-edges"
    assert req["json"] == {
        "sessionId": SESSION_ID,
        "userId": USER_ID,
        "nodeIds": ["a", "b"],
        "gap": 40,
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd services/agent-runtime && python -m pytest tests/test_explore_tools.py tests/test_nest_client.py::test_arrange_nodes_along_edges -q
```

Expected: FAIL (`arrange_nodes_along_edges` missing).

- [ ] **Step 3: Implement**

`tool_registry.py` — after `"connect_nodes": ToolPlacement.EXPLORE,`:

```python
"arrange_nodes_along_edges": ToolPlacement.EXPLORE,
```

Leave `"arrange_nodes_grid": ToolPlacement.GRAPH_NODE`. In `TOOL_TIERS` next to `arrange_nodes_grid`:

```python
"arrange_nodes_along_edges": ToolTier.GRAPH_BATCH,
```

Do **not** add the name to `EXPLORE_WRITE_TOOLS` or `DEFERRED_GRAPH_NODE_TOOLS`.

`nest_client.py` next to `arrange_nodes_grid`:

```python
async def arrange_nodes_along_edges(
    self, *, node_ids: list[str], gap: int | None = None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "sessionId": self._session_id,
        "userId": self._user_id,
        "nodeIds": node_ids,
    }
    if gap is not None:
        body["gap"] = gap
    return await self._post("/agent/internal/arrange-nodes-along-edges", body)
```

`definitions.py` — next to `ArrangeNodesGridInput`:

```python
class ArrangeNodesAlongEdgesInput(BaseModel):
    node_ids: list[str] = Field(
        description=(
            "Node ids to layout (use addedNodeIds or this-turn connect source/target; "
            "do not pass every canvas id)"
        )
    )
    gap: int | None = Field(default=None, description="Gap in pixels, default 40")
```

Coroutine + spec next to `arrange_nodes_grid` (include in `_all_tool_specs` so `build_explore_tools` picks it up via `EXPLORE_TOOL_NAMES`):

```python
async def arrange_nodes_along_edges(
    node_ids: list[str], gap: int | None = None
) -> dict:
    return await client.arrange_nodes_along_edges(node_ids=node_ids, gap=gap)
```

```python
(
    "arrange_nodes_along_edges",
    StructuredTool.from_function(
        coroutine=arrange_nodes_along_edges,
        name="arrange_nodes_along_edges",
        description=(
            "Arrange selected canvas nodes along directed edges, left to right. "
            "Same rank stacks vertically; columns share a vertical center. "
            "Pass only newly written node_ids. Do not use arrange_nodes_grid."
        ),
        args_schema=ArrangeNodesAlongEdgesInput,
    ),
),
```

Update `ApplyLayoutOpsInput` description to include `arrange_along_edges`.

- [ ] **Step 4: Re-run**

Run:

```bash
cd services/agent-runtime && python -m pytest tests/test_explore_tools.py tests/test_nest_client.py::test_arrange_nodes_along_edges tests/test_explore_tools_subset.py -q
```

Expected: PASS. `EXPLORE_WRITE_TOOLS` subset tests unchanged (name not in that frozenset).

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/tools/nest_client.py services/agent-runtime/app/tools/definitions.py services/agent-runtime/app/tools/tool_registry.py services/agent-runtime/tests/test_nest_client.py services/agent-runtime/tests/test_explore_tools.py
git commit -m "feat(agent-runtime): explore tool arrange_nodes_along_edges"
```

---

### Task 5: Prompt + always-bound (A4, A5)

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py`
- Modify: `services/agent-runtime/tests/test_planner_system_prompt.py`
- Create: `services/agent-runtime/tests/test_arrange_along_edges_bind.py`

**Interfaces:**
- Consumes: Task 4 placement (CORE, not in `EXPLORE_WRITE_TOOLS`)
- Produces: prompt copy locked below

- [ ] **Step 1: Write failing tests**

`test_chat_system_prompt.py` (imports `_SYSTEM` from chat = explore):

```python
def test_chat_system_requires_arrange_along_edges_on_new_nodes():
    assert "arrange_nodes_along_edges" in _SYSTEM
    assert "addedNodeIds" in _SYSTEM or "当轮新节点" in _SYSTEM
    assert "整张画布" in _SYSTEM
```

`test_planner_system_prompt.py`:

```python
def test_planner_system_arranges_after_instantiate():
    assert "instantiate_workflow_template" in _PLANNER_SYSTEM
    assert "arrange_nodes_along_edges" in _PLANNER_SYSTEM
    assert "addedNodeIds" in _PLANNER_SYSTEM
```

`test_arrange_along_edges_bind.py`:

```python
from unittest.mock import MagicMock

from app.graph.nodes.explore import _bind_plan_tools
from app.tools.definitions import EXPLORE_WRITE_TOOLS
from app.tools.tool_plan import build_tool_plan


def _bound_names(utterance: str) -> set[str]:
    captured: list[list[str]] = []

    class FakeLlm:
        def bind_tools(self, tools):
            captured.append([getattr(t, "name", "") for t in tools])
            return self

    names = set(EXPLORE_WRITE_TOOLS) | {"arrange_nodes_along_edges", "get_canvas_layout"}
    tools_by_name = {name: MagicMock(name=name) for name in names}
    for name, tool in tools_by_name.items():
        tool.name = name
    _bind_plan_tools(FakeLlm(), tools_by_name, [], utterance)
    return set(captured[0])


def test_plan_includes_arrange_along_edges():
    assert "arrange_nodes_along_edges" in build_tool_plan(loaded=[]).visible_names
    assert "arrange_nodes_along_edges" not in EXPLORE_WRITE_TOOLS


def test_bind_keeps_arrange_on_import_planner_and_default():
    assert "arrange_nodes_along_edges" in _bound_names("请导入工作流到画布")
    assert "arrange_nodes_along_edges" in _bound_names("帮我规划一个角色三视图工作流")
    assert "arrange_nodes_along_edges" in _bound_names("把 prompt-1 的提示词改成猫")
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd services/agent-runtime && python -m pytest tests/test_chat_system_prompt.py::test_chat_system_requires_arrange_along_edges_on_new_nodes tests/test_planner_system_prompt.py::test_planner_system_arranges_after_instantiate tests/test_arrange_along_edges_bind.py -q
```

Expected: FAIL (strings / bind missing).

- [ ] **Step 3: Implement prompt copy**

Append to `_EXPLORE_SYSTEM` after rule 7 (keep `{summary}`):

```
8. 写完拓扑（connect_nodes / import_workflow / instantiate_workflow_template 成功）后，必须对当轮新节点调用 arrange_nodes_along_edges；node_ids 只用这些工具返回的 addedNodeIds 或当轮连线的 source/target，禁止传入整张画布的全部 id。
```

Append to `_PLANNER_SYSTEM`:

```
instantiate_workflow_template 成功后，对返回的 addedNodeIds 调用 arrange_nodes_along_edges。
```

- [ ] **Step 4: Re-run**

Run:

```bash
cd services/agent-runtime && python -m pytest tests/test_chat_system_prompt.py tests/test_planner_system_prompt.py tests/test_arrange_along_edges_bind.py tests/test_explore_narrow_bind.py tests/test_explore_tools.py -q
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/explore.py services/agent-runtime/tests/test_chat_system_prompt.py services/agent-runtime/tests/test_planner_system_prompt.py services/agent-runtime/tests/test_arrange_along_edges_bind.py
git commit -m "feat(agent-runtime): prompt arrange_nodes_along_edges after topology writes"
```

---

## Done when

- [ ] A1–A7 green locally
- [ ] A8: do not revert `apps/web` multi-select along-edges (already on this branch)
- [ ] No auto-layout on connect/import/instantiate

## Execution Handoff

After this plan is saved, pick:

1. **Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks
2. **Inline Execution** — execute in this session with checkpoints
