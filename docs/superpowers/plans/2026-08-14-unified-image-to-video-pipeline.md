# 统一图生视频管线（U-I2V）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-08-14-unified-image-to-video-pipeline-design.md`

**Goal:** 抽出 `RefBinding → CanonicalRefs → VideoGenerationOrchestrator` 显式中间层，使画布 Dock 与 Agent 原子能力共用 `Orchestrator.start()` / `wait()`，三入口图生视频语义与进度 UX 一致。

**Architecture:** 在 `@lnkpi/shared` 新增 `resolveCanonicalVideoRequest`；在 `apps/server/src/studio` 新增 `VideoGenerationOrchestrator`；Agent internal 与 Studio 公开 API 均委托 Orchestrator；Web 画布改 `startVideoGeneration` + 客户端 poll。P0 热修（start/wait split、660s）已在 `fix/agent-video-generation-polling` 分支，P1 将其升格为正式 Orchestrator。

**Tech Stack:** TypeScript, Vitest, NestJS (`StudioService`, `AgentCanvasToolsService`), Vue (`useNodeGeneration`), Python agent-runtime (`nest_client`, `run_atomic_gen`)

## Global Constraints

- 视频 poll 超时 **660_000ms**（Agnes 600s + buffer）；禁止 Agent 路径 180s 超时
- start 必须 **立即** 返回 `generationRecordId` + 写入 `generationStartedAt`
- canonical SSOT = `refs[]` via `resolveNodeRefs`；`referenceImageUrl` Phase 1 只读 legacy
- 三入口验收：同图同 prompt → `resolveCanonicalVideoRequest` 输出 refs 等价
- SSE `task_update` 在 start 后立即带 `recordId`（W11 poll 权威）
- `mergeCanvasNodesFromServer` generating 态必须合并 `generationStartedAt`
- 每 Task 单独 commit；不 amend 已 push commit
- 提交前 `pnpm build` + 相关 vitest/pytest 全绿

---

## File Map

| File | Responsibility |
|---|---|
| `packages/shared/src/videoGeneration/types.ts` | `CanonicalVideoGenerationRequest`, start/wait result types |
| `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts` | 节点+画布 → canonical request |
| `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.test.ts` | 三入口等价性单测 |
| `packages/shared/src/index.ts` | export |
| `apps/server/src/studio/video-generation.orchestrator.ts` | start/wait 编排 |
| `apps/server/src/studio/video-generation.orchestrator.test.ts` | orchestrator 单测 |
| `apps/server/src/studio/studio.module.ts` | 注册 Orchestrator provider |
| `apps/server/src/studio/studio.controller.ts` | `POST video/start` 公开 API |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | 委托 Orchestrator；删除重复 video 逻辑 |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | 保持 internal start/wait 路由 |
| `apps/web/src/services/studio-api.ts` | `startVideoGeneration` client |
| `apps/web/src/composables/useNodeGeneration.ts` | 画布改 start + poll |
| `apps/web/src/pages/canvas/canvasNodeMerge.ts` | startedAt 合并（P0 已修） |
| `services/agent-runtime/app/config.py` | `video_gen_timeout_sec=660`（P0 已修） |
| `services/agent-runtime/app/tools/nest_client.py` | start/wait video（P0 已修） |
| `services/agent-runtime/app/graph/nodes/run_atomic_gen.py` | video start/wait（P0 已修） |

---

### Task 0: 合并 P0 热修（若尚未入主分支）

**Files:**
- 已改：`apps/server/src/agent/agent-canvas-tools.service.ts`
- 已改：`apps/server/src/agent/agent-canvas-tools.controller.ts`
- 已改：`apps/web/src/pages/canvas/canvasNodeMerge.ts`
- 已改：`services/agent-runtime/app/config.py`
- 已改：`services/agent-runtime/app/tools/nest_client.py`
- 已改：`services/agent-runtime/app/runs.py`
- 已改：`services/agent-runtime/app/graph/nodes/run_atomic_gen.py`
- 已改：`services/agent-runtime/app/graph/nodes/gen_node.py`

**Interfaces:**
- Produces: `startVideoGeneration`, `waitVideoGeneration` on server + nest client

- [ ] **Step 1:** 确认分支 `fix/agent-video-generation-polling` 测试通过

Run:
```bash
cd apps/server && pnpm exec vitest run src/agent/agent-canvas-tools.service.test.ts
cd apps/web && pnpm exec vitest run src/pages/canvas/canvasNodeMerge.test.ts
cd services/agent-runtime && python3 -m pytest tests/test_gen_node.py tests/test_atomic_create_subgraph.py -q
pnpm build
```

- [ ] **Step 2:** PR 合并或 rebase 到 feature 分支后继续 Task 1

---

### Task 1: Canonical 类型与解析器

**Files:**
- Create: `packages/shared/src/videoGeneration/types.ts`
- Create: `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts`
- Create: `packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `CanonicalVideoGenerationRequest`
  - `resolveCanonicalVideoRequest({ node, canvas, accountDefaults? })`

- [ ] **Step 1: Write failing tests — 三入口 refs 等价**

```typescript
// packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.test.ts
import { describe, expect, it } from 'vitest'
import { resolveCanonicalVideoRequest } from './resolveCanonicalVideoRequest'

const IMG = 'https://cdn.example/ref.png'
const baseVideoNode = { id: 'v1', type: 'video', data: { prompt: '产品展示', videoSettings: { duration: 15 } } }

describe('resolveCanonicalVideoRequest', () => {
  it('path1: localRefs upload → single I1 image ref', () => {
    const req = resolveCanonicalVideoRequest({
      node: {
        ...baseVideoNode,
        data: {
          ...baseVideoNode.data,
          localRefs: [{ id: 'a1', mediaType: 'image', sourceKind: 'upload', label: '图', url: IMG }],
        },
      },
      canvas: { nodes: [baseVideoNode], edges: [] },
    })
    expect(req.refs).toHaveLength(1)
    expect(req.refs[0].refKey).toBe('I1')
    expect(req.refs[0].url).toBe(IMG)
    expect(req.videoMode).toBe('image_to_video')
  })

  it('path2: edge from image node → same I1', () => {
    const req = resolveCanonicalVideoRequest({
      node: baseVideoNode,
      canvas: {
        nodes: [
          baseVideoNode,
          { id: 'i1', type: 'image', data: { url: IMG } },
        ],
        edges: [{ id: 'e1', source: 'i1', target: 'v1' }],
      },
    })
    expect(req.refs[0].url).toBe(IMG)
  })

  it('path3: agent localRefs → same I1', () => {
    const req = resolveCanonicalVideoRequest({
      node: {
        ...baseVideoNode,
        data: {
          ...baseVideoNode.data,
          localRefs: [{ id: 'sidebar-att-1', mediaType: 'image', sourceKind: 'upload', label: '@I1', url: IMG }],
          mentionedKeys: ['I1'],
        },
      },
      canvas: { nodes: [baseVideoNode], edges: [] },
    })
    expect(req.refs[0].url).toBe(IMG)
    expect(req.mentionedKeys).toEqual(['I1'])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/videoGeneration/resolveCanonicalVideoRequest.test.ts`

- [ ] **Step 3: Implement resolver**

```typescript
// packages/shared/src/videoGeneration/resolveCanonicalVideoRequest.ts
import { resolveNodeRefs, type CanvasData, type CanvasNode } from '../nodeRefs' // adjust imports

export function resolveCanonicalVideoRequest(input: {
  node: CanvasNode
  canvas: CanvasData
  accountDefaults?: Partial<VideoSettings & { model?: string }>
}): CanonicalVideoGenerationRequest {
  const data = input.node.data ?? {}
  const refs = resolveNodeRefs({
    targetNodeId: input.node.id,
    targetType: String(input.node.type),
    nodes: input.canvas.nodes,
    edges: input.canvas.edges,
    localRefs: data.localRefs,
    refOrder: data.refOrder,
  }).filter((r) => !r.stale)

  const settings = { ...defaults, ...(data.videoSettings ?? {}), ...input.accountDefaults }
  const hasImage = refs.some((r) => r.mediaType === 'image')
  const videoMode = data.videoMode ?? (hasImage ? 'image_to_video' : 'text_to_video')

  return {
    prompt: String(data.prompt ?? data.content ?? '').trim(),
    refs: refs.map(/* → GenerationRefPayload */),
    mentionedKeys: data.mentionedKeys,
    videoSettings: settings,
    videoMode,
    model: data.videoModel ?? input.accountDefaults?.model,
    scope: { sessionId: '', nodeId: input.node.id }, // caller fills sessionId
  }
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/videoGeneration packages/shared/src/index.ts
git commit -m "feat(shared): add resolveCanonicalVideoRequest for unified i2v"
```

---

### Task 2: VideoGenerationOrchestrator

**Files:**
- Create: `apps/server/src/studio/video-generation.orchestrator.ts`
- Create: `apps/server/src/studio/video-generation.orchestrator.test.ts`
- Modify: `apps/server/src/studio/studio.module.ts`

**Interfaces:**
- Consumes: `CanonicalVideoGenerationRequest`, `StudioService.generateVideo`, `StudioService.getGeneration`
- Produces:
  - `VideoGenerationOrchestrator.start(userId, request, persist, legacyUrl?)`
  - `VideoGenerationOrchestrator.wait(userId, { sessionId, nodeId, generationRecordId }, persist)`

- [ ] **Step 1: Write failing orchestrator test**

```typescript
it('start persists generating + startedAt then returns recordId', async () => {
  const persist = vi.fn()
  generateVideo.mockResolvedValue({ id: 'rec-1', status: 'generating' })
  const result = await orchestrator.start('u1', canonicalRequest, persist)
  expect(result.generationRecordId).toBe('rec-1')
  expect(result.generationStartedAt).toMatch(/^\d{4}-/)
  expect(persist).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ type: 'update_node', payload: expect.objectContaining({ data: expect.objectContaining({ status: 'generating' }) }) }),
  ]))
})
```

- [ ] **Step 2: Implement orchestrator** — 从现有 `agent-canvas-tools.service.ts` 的 `startVideoGeneration` / `waitVideoGeneration` **搬移**逻辑，参数改为 `CanonicalVideoGenerationRequest`

- [ ] **Step 3: Register in StudioModule**

- [ ] **Step 4: Run tests + commit**

```bash
git commit -m "feat(server): add VideoGenerationOrchestrator start/wait"
```

---

### Task 3: Agent 委托 Orchestrator

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Interfaces:**
- Consumes: `VideoGenerationOrchestrator`, `resolveCanonicalVideoRequest`

- [ ] **Step 1: Refactor `startVideoGeneration`**

```typescript
async startVideoGeneration(input: RunGenInput) {
  const { canvas } = await this.loadOwnedSession(input.sessionId, input.userId)
  const node = canvas.nodes.find((n) => n.id === input.nodeId)
  if (!node) throw new NotFoundException('节点不存在')
  const prefs = await this.loadAccountGenPrefs(input.userId)
  const request = resolveCanonicalVideoRequest({ node, canvas, accountDefaults: mapVideoPrefs(prefs) })
  request.scope.sessionId = input.sessionId
  const legacyUrl = String(node.data?.referenceImageUrl ?? '').trim() || undefined
  return this.videoOrchestrator.start(
    input.userId,
    request,
    (actions) => this.persist(input.sessionId, actions),
    legacyUrl,
  )
}
```

- [ ] **Step 2: Same for `waitVideoGeneration` → orchestrator.wait**

- [ ] **Step 3: Delete duplicated video param extraction from service**

- [ ] **Step 4: Run agent-canvas-tools.service.test.ts — 48 tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(agent): delegate video generation to VideoGenerationOrchestrator"
```

---

### Task 4: Studio 公开 start API + Web 画布接入

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts`
- Modify: `apps/server/src/studio/studio.service.ts`（如需 session persist 回调）
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Produces: `POST /studio/video/start` → `{ generationRecordId, status, generationStartedAt }`

- [ ] **Step 1: Add controller endpoint**

```typescript
@Post('video/start')
@UseGuards(AuthGuard)
async startVideoGeneration(@Req() req, @Body() dto: StartVideoGenerationDto) {
  // load session canvas, resolve canonical, orchestrator.start with session persist
}
```

- [ ] **Step 2: Add `studioApi.startVideoGeneration` in web**

- [ ] **Step 3: Change `useNodeGeneration` video branch**

Replace:
```typescript
const { data: res } = await studioApi.generateVideo(...)
await resolveStudioRecord(node.id, res.data)
```
With:
```typescript
const { data: res } = await studioApi.startVideoGeneration(...)
deps.patchNodeData(node.id, {
  generationRecordId: res.data.id,
  generationStartedAt: res.data.generationStartedAt ?? startedAtPatch().generationStartedAt,
})
await resolveStudioRecord(node.id, res.data)
```

- [ ] **Step 4: Update tests**

- [ ] **Step 5: Manual smoke — 画布路径1 upload + 路径2 edge 各生成一次**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): canvas video generation uses unified start API"
```

---

### Task 5: 三入口等价性集成测试 + 文档

**Files:**
- Create: `apps/server/src/studio/video-generation.integration.test.ts`
- Modify: `docs/superpowers/specs/2026-08-14-unified-image-to-video-pipeline-design.md`（状态 → P1 完成）

- [ ] **Step 1: Integration test — same canonical for three node fixtures**

- [ ] **Step 2: Update spec §10 Phase 状态**

- [ ] **Step 3: `pnpm build` full monorepo**

- [ ] **Step 4: Commit + PR**

```bash
git commit -m "test(server): unified i2v three-entry canonical equivalence"
gh pr create --base main --title "feat: unified image-to-video pipeline (U-I2V P1)" ...
```

---

## Self-Review（Plan vs Spec）

| Spec § | Task |
|---|---|
| §2.1 统一语义模型 | Task 1 `resolveCanonicalVideoRequest` |
| §2.2 统一生命周期 | Task 2 Orchestrator start/wait |
| §2.3 统一进度 UX | Task 0 merge + Task 4 web start + startedAt |
| §2.4 入口适配 | Task 3 Agent + Task 4 Canvas |
| §3 中间层 | Task 1–2 |
| §8 验收 | Task 1 tests + Task 5 integration |
| §10 P0 | Task 0 |
| §10 P1 | Task 1–3 |
| §10 P2 | Task 4 |
| §10 P3 referenceImageUrl 停写 | **未在本 plan** — 单独 follow-up PR |

**Gap:** Phase 3 `referenceImageUrl` 退役需追加 Task 6（停写 + eslint 规则），建议 P2 合并后开。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-14-unified-image-to-video-pipeline.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 派发独立 subagent，Task 间 review
2. **Inline Execution** — 本会话按 Task 0→5 顺序执行，checkpoint Review

**Which approach?**

Additionally: P0 热修已在 `fix/agent-video-generation-polling` 分支，可先 PR 合并再执行 P1 Orchestrator 抽取。
