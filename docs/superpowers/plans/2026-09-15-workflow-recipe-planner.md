# 工作流配方规划器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent 能从平台/用户模板认亲、用结构化 delta（含一次嫁接）衍生配方、确认后编译为带身份的 `lnkpi.workflow` 并走现有 `import_workflow` 落画布；用户可将导出 JSON 确认后晋升为模板。

**Architecture:** Recipe IR、`applyDelta`、`lintRecipe`、`compileRecipeToWorkflow` 的 SSOT 在 `@lnkpi/shared`。Nest 暴露 match / preview / instantiate / promote；agent-runtime **不**重写 lint，只调 Nest。落画布只经现有 import。出图 `build_chain_ref_order` 改为任意 `chain`，并从节点 `data.recipeKey` 补齐 `gen_by_key`。

**Tech Stack:** Zod/`@lnkpi/shared`、Vitest、NestJS、Prisma（SQLite String JSON）、agent-runtime Python tools、现有 `import_workflow` 与 explore 窄绑定。

**Spec:** [docs/superpowers/specs/2026-09-15-workflow-recipe-planner-design.md](../specs/2026-09-15-workflow-recipe-planner-design.md)

## Global Constraints

- 用户文案禁止出现 parentId、delta、种子链、嫁接、lint；用 模板 / 核心步骤 / 改版 / 接到另一套模板。
- apply/lint/compile 只在 `@lnkpi/shared` + Nest；runtime 禁止复制 Zod。
- 规划器 add 仅 `prompt|image|video|text`；`add` 净增 ≤ 8（不含 graft 种子节点）；add 下游 `autoGenerate: false`。
- 一次衍生最多 1 次 graft；禁止模型自造 seed/turnaround。
- 结构确认前不写画布；规划确认默认不写入用户目录。
- 不劫持 `marketing_intent` / campaign `split`；规划器走 explore 新工具。
- 导入/导出不自动晋升。运行时禁止模型写代码 exec 产 JSON。
- 提交信息用 feat/test/docs；每任务独立可测。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/canvas/workflowRecipe.ts` | IR Zod、applyDelta、lintRecipe、compile、infer、diffLines、key slug |
| `packages/shared/src/canvas/workflowRecipe.test.ts` | 冻结链、graft、剥离非法、compile 身份字段 |
| `packages/shared/src/canvas/recipes/*.json` | 平台配方：产品链 + 模特种子链 |
| `packages/shared/src/canvas/recipeCatalog.ts` | 加载平台配方、摘要、按 id+version 取 |
| `packages/shared/src/index.ts` | Re-export |
| `apps/server/prisma/schema.prisma` | `UserWorkflowRecipe` |
| `apps/server/src/agent/workflow-recipe.service.ts` | Nest：match/preview/instantiate/promote，用户目录 |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | 新 POST 路由 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | instantiate → 现有 `importWorkflow` |
| `services/agent-runtime/app/graph/chain_refs.py` | 任意 chain；canvas hydrate |
| `services/agent-runtime/app/tools/definitions.py` | explore 工具 |
| `services/agent-runtime/app/tools/tool_registry.py` | WORKFLOW_IO placement |
| `services/agent-runtime/app/graph/explore_dispatch.py` | 规划/晋升窄绑定，避免被 import 抢走 |
| `docs/workflow/README.md` | 内部交叉引用，不教外部 Agent 写 delta |

---

### Task 1: Recipe IR + applyDelta + lintRecipe

**Files:**
- Create: `packages/shared/src/canvas/workflowRecipe.ts`
- Create: `packages/shared/src/canvas/workflowRecipe.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `RecipeDocument`, `RecipeDelta`, `LintIssue`, `validateRecipe`, `applyDelta`, `lintRecipe`, `diffRecipeLines`, `slugRecipeKey`, `RECIPE_DATA_KEYS`

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/canvas/workflowRecipe.test.ts
import { describe, expect, it } from 'vitest'
import {
  applyDelta,
  lintRecipe,
  validateRecipe,
  slugRecipeKey,
} from './workflowRecipe'

const productParent = {
  id: 'ecommerce-product-visual',
  version: '1.0.0',
  title: '电商套图',
  invariants: { seedChains: [{ id: 'product', keys: ['white_bg', 'product_turnaround'] }] },
  nodes: [
    { key: 'white_bg', title: '白底', type: 'image', chain: 'product', role: 'seed', dependsOn: [], genMode: 't2i', autoGenerate: true },
    { key: 'product_turnaround', title: '四视图', type: 'image', chain: 'product', role: 'turnaround', dependsOn: ['white_bg'], genMode: 'i2i', autoGenerate: true },
    { key: 'banner', title: 'Banner', type: 'image', chain: 'product', role: 'downstream', dependsOn: ['product_turnaround'], genMode: 'i2i', autoGenerate: true },
  ],
}

const modelRecipe = {
  id: 'model-turnaround',
  version: '1.0.0',
  title: '角色三视图',
  invariants: { seedChains: [{ id: 'model', keys: ['model_portrait', 'model_turnaround'] }] },
  nodes: [
    { key: 'model_portrait', title: '定妆', type: 'image', chain: 'model', role: 'seed', dependsOn: [], genMode: 't2i', autoGenerate: true },
    { key: 'model_turnaround', title: '模特四视图', type: 'image', chain: 'model', role: 'turnaround', dependsOn: ['model_portrait'], genMode: 'i2i', autoGenerate: true },
    { key: 'model_lifestyle', title: '人景', type: 'image', chain: 'model', role: 'downstream', dependsOn: ['model_turnaround'], genMode: 'i2i', autoGenerate: true },
  ],
}

describe('workflowRecipe', () => {
  it('rejects removing seed chain keys', () => {
    const { recipe, stripped } = applyDelta(productParent, { remove: ['white_bg'] })
    expect(stripped.some((s) => s.code === 'seed_frozen')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'white_bg')).toBe(true)
  })

  it('strips rewire that unhooks downstream from turnaround', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      rewire: [{ key: 'banner', dependsOn: [] }],
    })
    expect(stripped.some((s) => s.code === 'downstream_unhooked')).toBe(true)
    expect(recipe.nodes.find((n) => n.key === 'banner')?.dependsOn).toContain('product_turnaround')
  })

  it('grafts only seed chain and merges invariants', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
    }, { graftSource: modelRecipe })
    expect(stripped).toEqual([])
    expect(recipe.nodes.map((n) => n.key)).toEqual(
      expect.arrayContaining(['white_bg', 'product_turnaround', 'model_portrait', 'model_turnaround']),
    )
    expect(recipe.nodes.some((n) => n.key === 'model_lifestyle')).toBe(false)
    expect(recipe.invariants.seedChains.map((c) => c.id).sort()).toEqual(['model', 'product'])
  })

  it('does not count graft nodes toward add cap of 8', () => {
    const adds = Array.from({ length: 8 }, (_, i) => ({
      key: `extra_${i}`,
      title: `Extra ${i}`,
      type: 'image' as const,
      chain: 'product' as const,
      role: 'downstream' as const,
      dependsOn: ['product_turnaround'],
      genMode: 'i2i' as const,
      autoGenerate: false,
    }))
    const { stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
      add: adds,
    }, { graftSource: modelRecipe })
    expect(stripped.some((s) => s.code === 'add_cap')).toBe(false)
  })

  it('rejects second graft in one delta', () => {
    const { stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
    }, { graftSource: modelRecipe, alreadyGrafted: 1 })
    expect(stripped.some((s) => s.code === 'graft_once')).toBe(true)
  })

  it('slugRecipeKey is stable ascii', () => {
    expect(slugRecipeKey('Pack Detail!')).toBe('pack_detail')
    expect(slugRecipeKey('白底主图')).toBe('node')
  })
})
```

中文无拉丁字母时退回 `node`，冲突由调用方加后缀 `-2`。不要引入拼音库。

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowRecipe.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement `workflowRecipe.ts`**

字段用 camelCase（与 TS 代码库一致；YAML/JSON 平台文件同样用 camelCase）：

```ts
export const RECIPE_DATA_KEYS = [
  'recipeId',
  'recipeVersion',
  'recipeKey',
  'chain',
  'role',
  'genMode',
  'parentRecipeId',
] as const

export type RecipeRole = 'seed' | 'turnaround' | 'downstream'
export type RecipeGenMode = 't2i' | 'i2i' | 'v_ref'
export type PlannerNodeType = 'prompt' | 'image' | 'video' | 'text'

export type RecipeNode = {
  key: string
  title: string
  type: PlannerNodeType | 'group' | 'shot' | 'sceneComposer'
  chain?: string
  role?: RecipeRole
  dependsOn: string[]
  genMode?: RecipeGenMode
  promptHintTemplate?: string
  autoGenerate: boolean
}

export type RecipeDocument = {
  id: string
  version: string
  title: string
  parentId?: string
  parentVersion?: string
  graftedRecipeIds: string[]
  invariants: { seedChains: Array<{ id: string; keys: string[] }> }
  topologyViews?: { trimmedKeys?: string[] }
  nodes: RecipeNode[]
}

export type RecipeDelta = {
  graft?: { recipeId: string; version: string }
  add?: RecipeNode[]
  remove?: string[]
  rewire?: Array<{ key: string; dependsOn: string[] }>
}

export type LintIssue = { code: string; message: string; key?: string }

export function applyDelta(
  parent: RecipeDocument,
  delta: RecipeDelta,
  opts?: { graftSource?: RecipeDocument; alreadyGrafted?: number },
): { recipe: RecipeDocument; stripped: LintIssue[] }
```

算法顺序（必须按此，测试才稳）：

1. 深拷贝 parent → `recipe`；`stripped = []`。  
2. 若 `delta.graft`：`alreadyGrafted >= 1` 或无 `graftSource` 或 id/version 不符或 key/chain 冲突 → 整段不应用，push `graft_conflict` / `graft_once`，**不要**半拷。成功则只拷 `graftSource` 中 `role` 为 seed/turnaround 的节点，并入 `invariants.seedChains`，`graftedRecipeIds` 追加。  
3. `remove`：key 落在任一 `seedChains.keys` → strip `seed_frozen`，不删；否则删节点并清理他人 `dependsOn` 中的悬挂引用。  
4. `add`：`role` 为 seed/turnaround 或 type 非 planner 四类 → strip；成功写入时 **强制 `autoGenerate: false`**；`add.length`（仅成功写入的）> 8 → 超出部分 strip `add_cap`。  
5. `rewire`：目标为种子链节点 → strip；否则写入 `dependsOn` 后立刻 `lintRecipe`，若 `downstream_unhooked` 则回滚该 rewire 并 strip。  
6. 设 `parentId/parentVersion`；返回前再跑一遍 `lintRecipe`，把仍失败的 add 剥掉。

`lintRecipe(recipe)` 检查 spec §3.3：DAG、依赖存在、种子链完整且链内 dependsOn 与链序一致（keys[i] 依赖 keys[i-1] 或 [] 若 i=0）、标了 chain 的 downstream 含该链 turnaround（无则 seed）、省略 chain 但 dependsOn 命中多条 turnaround 的节点必须包含所命中每条链的 turnaround、text/prompt 不得出现在 image/video 的 dependsOn、image 只依赖 image、video 只依赖 image。

`diffRecipeLines(parent, recipe): string[]` 用户可见，例如 `接上「角色三视图」的核心步骤`、`增加「Banner」`、`去掉 Banner`。禁止输出 graft/delta 等内部词。

`validateRecipe` = zod parse。`slugRecipeKey(title: string): string` 按 Step 1 修订。

- [ ] **Step 4: Re-run tests**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowRecipe.test.ts
```

Expected: PASS。从 `packages/shared/src/index.ts` export 新模块。

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/workflowRecipe.ts packages/shared/src/canvas/workflowRecipe.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat(shared): recipe IR applyDelta and lint

EOF
)"
```

---

### Task 2: 两份平台配方 + catalog

**Files:**
- Create: `packages/shared/src/canvas/recipes/ecommerce-product-visual.json`
- Create: `packages/shared/src/canvas/recipes/model-turnaround.json`
- Create: `packages/shared/src/canvas/recipeCatalog.ts`
- Create: `packages/shared/src/canvas/recipeCatalog.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `validateRecipe` from Task 1
- Produces: `PLATFORM_RECIPES`, `getPlatformRecipe(id, version)`, `listPlatformRecipeSummaries()`

- [ ] **Step 1: Failing test** — `getPlatformRecipe('model-turnaround', '1.0.0')` 的 nodes keys 为 `['model_portrait','model_turnaround']`（无 `model_lifestyle`）；产品配方含 `white_bg`、`product_turnaround`、至少 1 个可删 downstream（`banner` 或 `hero_main`）。两份都能 `validateRecipe`。

- [ ] **Step 2: Run** `pnpm --filter @lnkpi/shared exec vitest run src/canvas/recipeCatalog.test.ts` — Expected FAIL

- [ ] **Step 3: JSON 内容**  
  - 产品：从 `services/agent-runtime/skills/enterprise-marketing-campaign/assets/canvas-manifest.yaml` 拷产品链节点（white_bg … brand，**不要**模特/视频），`target_type`→`type`，`depends_on`→`dependsOn`，补 `invariants.seedChains: [{ id: 'product', keys: ['white_bg','product_turnaround'] }]`，`id: ecommerce-product-visual`，`version: 1.0.0`，`title: 电商套图`。  
  - 模特：仅 portrait+turnaround，`id: model-turnaround`，`title: 角色三视图`，`seedChains: [{ id: 'model', keys: ['model_portrait','model_turnaround'] }]`。  
  `recipeCatalog.ts` 用 `import ecommerce from './recipes/ecommerce-product-visual.json'`（tsconfig 已允许 resolveJsonModule 则用；否则 `readFileSync` + `import.meta.url`，与 `workflowExchange.test.ts` 黄金样例相同）。

- [ ] **Step 4: Re-run catalog + recipe tests** — Expected PASS

- [ ] **Step 5: Commit** `feat(shared): platform recipes for product and model seed chains`

---

### Task 3: compile → lnkpi.workflow + Nest instantiate

**Files:**
- Modify: `packages/shared/src/canvas/workflowRecipe.ts`（加 `compileRecipeToWorkflow`）
- Modify: `packages/shared/src/canvas/workflowRecipe.test.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Interfaces:**
- Produces: `compileRecipeToWorkflow(recipe, slots?: Record<string, string>): WorkflowDocument`
- Nest: `POST /agent/internal/instantiate-recipe` body `{ sessionId, userId, recipe, slots? }` → 内部 `compileRecipeToWorkflow` + 现有 `importWorkflow`

- [ ] **Step 1: Shared failing test**

```ts
it('compileRecipeToWorkflow writes identity data and layered positions', () => {
  const doc = compileRecipeToWorkflow(productParent, { white_bg: 'a white mug' })
  expect(doc.format).toBe('lnkpi.workflow')
  const bg = doc.graph.nodes.find((n) => n.data.recipeKey === 'white_bg')
  expect(bg?.data.recipeId).toBe('ecommerce-product-visual')
  expect(bg?.data.role).toBe('seed')
  expect(bg?.data.prompt).toBe('a white mug')
  const ta = doc.graph.nodes.find((n) => n.data.recipeKey === 'product_turnaround')
  expect(ta!.position.x).toBeGreaterThan(bg!.position.x)
  expect(doc.graph.edges.some((e) => e.source === bg!.id && e.target === ta!.id)).toBe(true)
})
```

节点 `id` 用 `${type}-${key}`（key 已是 slug）。同链 i2i：`localRefs` 指向 dependsOn 对应节点 id（`sourceKind: 'edge'` 的结构若现有画布需要完整 LocalRef 对象，则只写 `mentionedKeys` + edges，与 `docs/workflow/README.md` 一致；优先 edges + `data.mentionedKeys` 为依赖 key 列表）。`autoGenerate === false` 的节点 `data.status` 不设为 queued。

分层坐标：拓扑层 `x = 80 + layer * 360`，同层 `y = 120 + index * 220`。

- [ ] **Step 2: Run shared test** — FAIL then implement compile using `buildWorkflowDocument`（`packages/shared/src/canvas/workflowExchange.ts`）。`mediaRole: 'none'`，`mediaIndex: []`，`mode: 'subgraph'`，`exportMode: 'lightweight'`。

- [ ] **Step 3: Nest**  
  DTO：`sessionId`, `userId`, `recipe: unknown`, `slots?: Record<string, string>`。  
  `instantiateRecipe`: `validateRecipe(recipe)` → compile → `this.importWorkflow({ sessionId, userId, workflow: doc })`。非法 recipe → 400。  
  测试：mock `importWorkflow` 被调用且 `workflow.graph.nodes[0].data.recipeKey` 存在。

- [ ] **Step 4:**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowRecipe.test.ts
pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts
```

Expected: PASS（只跑与 instantiate 相关的 describe，若文件太大可在该文件加 `describe('instantiateRecipe')`）

- [ ] **Step 5: Commit** `feat(server): instantiate recipe via compile and import-workflow`

---

### Task 4: 出图读节点配方身份

**Files:**
- Modify: `services/agent-runtime/app/graph/chain_refs.py`
- Modify: `services/agent-runtime/tests/test_chain_refs.py`
- Create: `services/agent-runtime/app/graph/canvas_recipe_hydrate.py`
- Create: `services/agent-runtime/tests/test_canvas_recipe_hydrate.py`
- Modify: `services/agent-runtime/app/graph/nodes/gen_node.py`（`by_key` 缺 item 时从 canvas 补）

**Interfaces:**
- Produces: `hydrate_gen_by_key_from_canvas(nodes: list[dict]) -> dict[str, dict]`
- `build_chain_ref_order`：`chain` 为任意非空字符串即走 seed/turnaround 逻辑（删除 `chain in ("product", "model")` 限制）

- [ ] **Step 1: Tests**

```python
def test_custom_chain_not_just_product_model():
    by_key = {
        "seed": {"key": "seed", "role": "seed", "chain": "outfit", "node_id": "n1"},
        "ta": {"key": "ta", "role": "turnaround", "chain": "outfit", "node_id": "n2"},
        "down": {"key": "down", "role": "downstream", "chain": "outfit", "node_id": "n3", "depends_on": ["ta"]},
    }
    order = build_chain_ref_order(item=by_key["down"], by_key=by_key, plan_node_id=None)
    assert order == ["n1", "n2"]

def test_hydrate_from_node_data():
    nodes = [{
        "id": "image-1",
        "data": {"recipeKey": "hero_main", "chain": "product", "role": "downstream", "title": "主图"},
    }]
    by_key = hydrate_gen_by_key_from_canvas(nodes)
    assert by_key["hero_main"]["node_id"] == "image-1"
    assert by_key["hero_main"]["chain"] == "product"
```

`hydrate` 的 item 同时保留 `depends_on`：若 `data.mentionedKeys` 为 key 列表则用之。

- [ ] **Step 2: pytest fail**

```bash
cd services/agent-runtime && python -m pytest tests/test_chain_refs.py tests/test_canvas_recipe_hydrate.py -q
```

- [ ] **Step 3: Implement.** 在 `gen_node` 开头：若 `by_key.get(key)` 无 `node_id`，且 `state` 有 `canvas_nodes` 或 `nodes`，则 `by_key = {**hydrate(...), **by_key}`（state 里已有的 key 优先）。不要把 campaign split 路径弄丢：hydrate 只补缺。

若 gen_node 的 state 当前没有 canvas 节点列表，从 `nest.get_canvas_summary` **不要**在热路径乱调。改为：hydrate 函数供 split **之后** 以及 instantiate 后的单节点出图使用；`gen_node` 若 item 已有 node_id 则行为与现在完全一致。另在 `split.py` 写 node 时把 `recipeKey/chain/role/genMode` 写入 canvas node data（若 split 已写 title/prompt，补身份字段即可）。若 split 改动面过大，本任务 **最低要求**：`build_chain_ref_order` 放开 chain + hydrate 单测绿；`gen_node` 在 `item` 已含 chain/role 时用放开后的 ref 函数（campaign 已满足）。instantiate 导入的节点带 data 身份，后续 atomic/single_node 出图若走 `attach_refs` 前能读 canvas，再在 **同一任务** 给 `gen_node` 增加：`canvas = state.get("canvas")` 可选。

检查 `gen_node` 的 state 是否已有节点快照；没有则只改 `chain_refs` + 导出 `hydrate_gen_by_key_from_canvas`，并在 Nest `importWorkflow` 后的节点 data 已含身份（Task 3 compile 已写）。单节点 explore 出图若走 graph_node `run_image_generation`，由 Nest 生成服务读 `data.chain/role` 刷 ref——若 `apps/server` 出图路径不读这些字段，在 `apps/server/src/agent` 里搜 `refOrder` 装配点，优先 `data.recipeKey` 同画布找 seed/turnaround 节点再 `attachRefs`。**本任务验收：** pytest chain_refs 自定义 chain 绿；至少一处出图路径单测证明导入节点能按 `data.role` 刷到 turnaround。

- [ ] **Step 4: pytest PASS**（含既有 `test_chain_refs.py` 全文件，防止回归 `test_video_lifestyle_appends_cross_chain_deps`）

- [ ] **Step 5: Commit** `feat(agent-runtime): chain refs honor recipe identity on nodes`

---

### Task 5: Nest preview + explore 规划工具

**Files:**
- Create: `apps/server/src/agent/workflow-recipe.service.ts`
- Create: `apps/server/src/agent/workflow-recipe.service.test.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts`
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/app/tools/definitions.py`
- Modify: `services/agent-runtime/app/tools/tool_registry.py`
- Modify: `services/agent-runtime/app/graph/explore_dispatch.py`
- Modify: `services/agent-runtime/app/graph/explore_route.py`
- Modify: `services/agent-runtime/tests/test_explore_narrow_bind.py`
- Modify: `services/agent-runtime/tests/test_nest_client.py`

**Interfaces:**
- `POST /agent/internal/match-recipes` `{ userId, utterance }` → `{ items: Array<{ id, version, title, score }> }` 最多 3 条（平台 + 该用户目录；用户目录 Task 6 才有，本任务平台即可，用户空数组）
- `POST /agent/internal/preview-recipe-delta` `{ userId, parentId, parentVersion, delta }` → `{ recipe, stripped, diffLines, userMessages }`  
  `graft` 时服务端按 `delta.graft.recipeId` 加载 `graftSource`，**不要**让模型传整份被嫁接配方。  
  `userMessages`：按 spec §8 把 stripped codes 映射成人话（`seed_frozen` → 「主图仍需跟着四视图，那一步没改。」一类；`graft_conflict` → 「没法把「角色三视图」整段接上来，和当前模板的步骤冲突。」）
- Tools（explore，`ToolTier.WORKFLOW_IO`）：  
  - `match_workflow_templates(utterance: str)`  
  - `preview_workflow_template(parent_id, parent_version, delta: dict)`  
  - `instantiate_workflow_template(recipe: dict, slots?: dict)` → Nest instantiate-recipe  
- **preview / match 禁止写画布。** instantiate 才写。

匹配规则（无 embedding）：标题或 id 子串、话术含「套图/详情/主图/电商」→ ecommerce；含「三视图/定妆/模特/角色」→ model-turnaround；两者都有 → parent=ecommerce，并在返回里 `graftHint: { recipeId: 'model-turnaround', version: '1.0.0' }`。低分（谁都不命中）→ items 仍返回 2 条平台摘要，`needsClarify: true`。

- [ ] **Step 1: Nest unit tests** for match（套图+三视图带 graftHint）、preview 删 banner 的 diffLines 含「去掉」、preview 删 white_bg 的 stripped+userMessages、preview graft 成功无 lifestyle 节点。

- [ ] **Step 2: Runtime tests**  
  `select_narrow_write_tools("帮我规划一个电商套图工作流，接到角色三视图")` 包含 `preview_workflow_template` 与 `instantiate_workflow_template`，**不**等于仅 `import_workflow`。  
  `"请用 import_workflow 导入"` 仍只绑 import（回归 Task 既有用例）。  
  规划关键词：`规划工作流`、`接到`、`改版`、`新模板`、`存成一套`。`导入工作流` 仍走 import。

- [ ] **Step 3: Implement routes + tools.** `TOOL_PLACEMENTS` 设 EXPLORE。`select_narrow_write_tools` 在规划话术分支 `return frozenset({"preview_workflow_template", "instantiate_workflow_template", "match_workflow_templates"})`（3 个 ≤ 5）。可加 `get_canvas_summary` 则去掉 match 或 preview 之一以守 ≤5：优先 **match + preview + instantiate**。

- [ ] **Step 4:**

```bash
pnpm --filter @lnkpi/server exec vitest run src/agent/workflow-recipe.service.test.ts
cd services/agent-runtime && python -m pytest tests/test_explore_narrow_bind.py tests/test_nest_client.py tests/test_explore_tools_subset.py -q
```

Expected: PASS。更新 `test_explore_tools_subset`：explore 白名单含三新工具名。

- [ ] **Step 5: Commit** `feat(agent): preview and instantiate workflow templates in explore`

---

### Task 6: 用户目录 + 导出 JSON 晋升

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create migration via `pnpm --filter @lnkpi/server exec prisma migrate dev --name user_workflow_recipe`（实现时按仓库既有 migrate 习惯；若用 `db push` 则跟随现有脚本，不要混用）
- Modify: `apps/server/src/agent/workflow-recipe.service.ts` + tests
- Modify: `services/agent-runtime` tools：`promote_workflow_template`
- Modify: explore 窄绑定：晋升话术

**Prisma**（SQLite 无 Json 类型，body 用 String）：

```prisma
model UserWorkflowRecipe {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  recipeId        String
  version         String
  title           String
  parentId        String?
  parentVersion   String?
  body            String
  sourceSessionId String?
  sourceHash      String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([userId, recipeId])
  @@index([userId, createdAt])
}
```

`User` 增加 `workflowRecipes UserWorkflowRecipe[]`。

**Interfaces:**
- `inferRecipeDraftFromWorkflow(doc)` in shared：边→dependsOn；`data.recipeKey` 优先否则 `slugRecipeKey(title)`；`data.role/chain` 作默认标注；剥 url/mediaIndex/position；prompt→promptHintTemplate。节点 > 24 → throw code `too_many_nodes`。
- `POST /agent/internal/promote-recipe`  
  `{ sessionId, userId, workflow, mode: 'variant' | 'new_template', confirmedSeedKeys?: string[], title?: string, parentId?: string, parentVersion?: string }`  
  - `new_template`：无 `confirmedSeedKeys` 或没有任何节点 role/seed 落入该列表 → 400，message 用 spec：「还没确认核心步骤，没法存成一套新模板。」（用户文案可写在 `userMessage` 字段）至少 1 个 seed。写入用户目录，`parentId` 空，`version: 1.0.0`，`recipeId` = `slugRecipeKey(title)+'-'+cuid 后 6 位` 保证 unique。  
  - `variant`：必须能 `getPlatformRecipe` 或用户目录加载 parent；`applyDelta` 由 draft 相对 parent 算出 remove/add/rewire（**不要 graft 除非 draft 含另一条种子链且 key 来自平台模特配方**）。保存 `parentId+parentVersion+body` 为合并后的完整配方。  
- Tool `promote_workflow_template`：`mode` + `workflow` 或从当前 session 导出由 Nest 读 canvas 编译成 workflow（更稳：Nest 内 `loadSession` → `buildWorkflowDocument` 再 infer）。第一期 tool 入参允许 `workflow` 对象与 `mode`。  
- **两步确认在对话里完成：** tool description 写明：先问「保存为当前模板的改版 / 存成一套新模板」（认不到父模板则只问新模板）；用户选出后再调用，且 `new_template` 必须带 `confirmed_seed_keys`。禁止一条 tool 静默入库。  
- match-recipes 改为平台 ∪ `UserWorkflowRecipe` where userId。

- [ ] **Step 1: Shared test** infer 从 golden `docs/workflow/examples/minimal-workflow.json` 得到 2 节点；>24 节点 throw。  
- [ ] **Step 2: Nest tests** new_template 无 seed keys → 400；有 seed 写入并可 `getUserRecipe`；variant 相对产品父删 banner 后 body 不含 banner。importWorkflow **不**创建 UserWorkflowRecipe 行（回归）。  
- [ ] **Step 3: Implement infer in workflowRecipe.ts**；promote service；tool + 窄绑定「存成一套新模板」「保存为当前模板的改版」。  
- [ ] **Step 4:**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/workflowRecipe.test.ts
pnpm --filter @lnkpi/server exec vitest run src/agent/workflow-recipe.service.test.ts
cd services/agent-runtime && python -m pytest tests/test_explore_narrow_bind.py -q
```

- [ ] **Step 5: Commit** `feat(server): promote exported workflow to user recipe catalog`

---

### Task 7: 黄金评测集 + 文档

**Files:**
- Create: `packages/shared/src/canvas/recipePlanner.eval.ts` **或** `docs/workflow/examples/recipe-planner-eval.json` + `packages/shared/src/canvas/recipePlannerEval.test.ts` 读该 JSON
- Modify: `docs/workflow/README.md`（节末交叉引用规格，**不**把 delta schema 写成外部 Agent 教程）
- Modify: spec 状态已批准可保持

评测 JSON 每条：`{ id, utterance?, parentId, delta?, expect: { parentId?, strippedCodes?, graftKeysPresent?, graftLifestyleAbsent?, seedUnchanged? } }`

至少覆盖 spec §10.6：

1. 认亲：`蓝牙耳机详情页套图` → `ecommerce-product-visual`  
2. 认亲+嫁接提示：`套图并且要模特三视图` → parent ecommerce + graftHint model-turnaround  
3. 非法 remove seed → `seed_frozen`  
4. 合法 remove banner → 无 seed_frozen，节点无 banner  
5. graft 成功无 lifestyle  
6. graft 两次 → `graft_once`  
7. infer 缺 seed 晋升拒绝（调 promote 或 `lintRecipe` 无 seedChains）  
8. 二次衍生：对已 graft 的 recipe 再 remove `model_portrait` → `seed_frozen`

- [ ] **Step 1: Write eval test that iterates fixtures**  
- [ ] **Step 2: FAIL if fixtures missing**  
- [ ] **Step 3: Add fixtures；README 增加「内部规划器见 2026-09-15 spec，外部 Agent 仍只生成 lnkpi.workflow 实例」**  
- [ ] **Step 4:**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/recipePlannerEval.test.ts src/canvas/workflowRecipe.test.ts src/canvas/recipeCatalog.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit** `test(shared): recipe planner gold eval set`

---

## Spec coverage

| Spec | Task |
| --- | --- |
| Recipe IR / apply / lint / add cap / graft 并入 invariants | 1 |
| 平台两份配方 | 2 |
| 编译器 + import 单路径 | 3 |
| 节点身份出图 | 4 |
| 认亲、preview HITL、explore 不绑 batch gen | 5 |
| JSON 晋升两步、用户目录、导入不入库 | 6 |
| 黄金集、不向外部教 delta | 7 |
| 不劫持 campaign split | 5（路由）+ 4（split 可保留） |
| 用户话术 | 1 `diffRecipeLines` + 5 `userMessages` + 6 tool description |

## 计划自检

- 无 TBD。`slugRecipeKey` 中文策略已写死为 ASCII/`node`。  
- Prisma 用 String body。  
- `alreadyGrafted` 让 Task 1 能测二次 graft，而不把「两次 graft 字段」放进 Delta 类型（Delta 只允许一个 `graft` 对象）。服务端若 `recipe.graftedRecipeIds.length >= 1` 再来 graft 同样拒绝。
