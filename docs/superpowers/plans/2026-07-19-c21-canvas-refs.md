# C2.1 Canvas T*/I* Refs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Canvas shot / shot-linked / sceneComposer batch 传递并消费 `refs` + `mentionedKeys`，Material 与 Studio 同款 T* merge + I* referenceImages。

**Architecture:** MaterialService 增量接入 `mergeRefsToPrompt` 与 adapter `referenceImages`；Web 按目标节点语义解析 refs；禁止 `canvasPrompt` 双重合并；blob 在扣费前拒绝。

**Tech Stack:** NestJS、Vitest、`@lnkpi/shared` nodeRefs、`@lnkpi/agent` mergeRefsToPrompt / generation-adapter、Vue composables

**Spec:** `docs/superpowers/specs/2026-07-19-c21-canvas-refs-design.md`

## Global Constraints

- 仅消费 **T\*** / **I\***；V\*/A\* 不消费
- Prompt = 目标节点 **local prompt**；禁止把 `mergePromptWithUpstream` 结果二次喂给 merge
- Refs = **目标节点语义**；未展开 batch 用 composer refs；已展开用媒体子节点 refs
- Batch prompt：媒体子节点优先，空则 shot prompt
- Merge **不另计费**；batch 预检仍按图 10 / 视频 30|50|70
- blob：Web 拦截 + Server **扣费前** `BadRequestException`
- 不抽共享 GenerationRefResolver；不改 StudioService 行为
- 分支 `feature/c21-canvas-refs`；提交前 `pnpm build && pnpm test` 全绿

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `packages/shared/src/nodeRefs.ts` | `GenerationRefPayload` |
| `packages/shared/src/sceneComposer.ts` | BatchItem `refs`/`mentionedKeys` |
| `apps/server/src/canvas/material.service.ts` | blob 校验、resolveMergedPrompt、adapter refs |
| `apps/server/src/canvas/material.service.test.ts` | Material refs 测试 |
| `apps/server/src/canvas/canvas.controller.ts` | DTO 嵌套 refs |
| `apps/server/src/canvas/scene-composer.service.ts` | batch blob 预检 + 透传 refs |
| `apps/server/src/canvas/scene-composer.service.test.ts` | batch refs 测试 |
| `apps/web/src/services/canvas-api.ts` | 传 refs/mentionedKeys |
| `apps/web/src/services/studio-api.ts` | 可选：`StudioRefPayload` 对齐 shared 类型（别名即可） |
| `apps/web/src/utils/sceneComposer.ts` | batch 解析 prompt/refs |
| `apps/web/src/utils/sceneComposer.test.ts` | batch refs 规则 |
| `apps/web/src/composables/useNodeGeneration.ts` | shot/shot-linked 传 refs；停用 canvasPrompt |
| `apps/web/src/composables/useNodeGeneration.test.ts` | Web payload 断言 |
| `docs/DOCK_STUDIO_E2E_TRACKING.md` | C2.1 章节 |

---

### Task 1: Shared `GenerationRefPayload` + BatchItem 字段

**Files:**
- Modify: `packages/shared/src/nodeRefs.ts`
- Modify: `packages/shared/src/sceneComposer.ts`
- Create: `packages/shared/src/nodeRefs.generation.test.ts`（可选最小导出断言）

**Interfaces:**
- Produces:
  ```ts
  export interface GenerationRefPayload {
    refKey: string
    mediaType: RefMediaType
    label?: string
    text?: string
    url?: string
  }
  ```
- SceneComposerBatchItem 增加 `refs?: GenerationRefPayload[]`、`mentionedKeys?: string[]`

- [ ] **Step 1: 写最小测试**

```ts
// packages/shared/src/nodeRefs.generation.test.ts
import { describe, expect, it } from 'vitest'
import type { GenerationRefPayload } from './nodeRefs'

describe('GenerationRefPayload', () => {
  it('accepts T* and I* shapes', () => {
    const refs: GenerationRefPayload[] = [
      { refKey: 'T1', mediaType: 'text', text: 'hello' },
      { refKey: 'I1', mediaType: 'image', url: 'https://example.com/a.png' },
    ]
    expect(refs).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 实现类型并扩展 BatchItem**

在 `nodeRefs.ts` 末尾增加 `GenerationRefPayload`。  
在 `sceneComposer.ts` 的 `SceneComposerBatchItem` 增加 `refs?`、`mentionedKeys?`（import 类型）。

- [ ] **Step 3: Build shared**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/shared build
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add GenerationRefPayload for canvas refs"
```

---

### Task 2: MaterialService — blob 校验 + resolveMergedPrompt + image/video

**Files:**
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/material.service.test.ts`

**Interfaces:**
- Extends inputs:
  ```ts
  refs?: Array<{ refKey: string; mediaType: string; label?: string; text?: string; url?: string }>
  mentionedKeys?: string[]
  ```
- Helpers（同文件私有，对齐 Studio，本轮不抽共享）:
  ```ts
  function assertNoBlobRefs(refs?: ...): void  // BadRequestException
  function extractTextSources(refs?): MergeTextSource[]
  function extractReferenceImages(refs?): string[]
  function buildPromptWithRefImage(prompt: string, refImageUrl: string): string
  private resolveMergedPrompt(local, refs, 'image'|'video', mentionedKeys?)
  ```

- [ ] **Step 1: 写失败测试（mock mergeRefsToPrompt）**

```ts
vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    mergeRefsToPrompt: vi.fn(async (input: { localPrompt?: string }) => ({
      mergedText: input.localPrompt ?? 'merged',
      skippedMerge: true,
    })),
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
    createVideoProvider: vi.fn(() => ({ generate: videoGenerate })),
  }
})

it('rejects blob refs before charging', async () => {
  await expect(
    svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'x',
      refs: [{ refKey: 'I1', mediaType: 'image', url: 'blob:http://localhost/x' }],
    }),
  ).rejects.toBeInstanceOf(BadRequestException)
  expect(consume).not.toHaveBeenCalled()
  expect(materialCreate).not.toHaveBeenCalled()
})

it('passes I* into image adapter and merges T*', async () => {
  await svc.generateImage({
    userId: 'u1',
    shotId: 'shot-1',
    prompt: 'local',
    model: 'seedream-5.0-pro',
    refs: [
      { refKey: 'T1', mediaType: 'text', text: 'style soft' },
      { refKey: 'I1', mediaType: 'image', url: 'https://example.com/a.png' },
    ],
    mentionedKeys: ['T1'],
  })
  await vi.waitFor(() => expect(imageGenerate).toHaveBeenCalled())
  expect(mergeRefsToPrompt).toHaveBeenCalled()
  const [prompt, opts] = imageGenerate.mock.calls[0]
  expect(String(prompt)).toContain('[ref-image:https://example.com/a.png]')
  expect(opts).toMatchObject({ n: 1, modelId: 'seedream-5.0-pro' })
})

it('passes I1 as video options.image', async () => {
  await svc.generateVideo({
    userId: 'u1',
    shotId: 'shot-1',
    prompt: 'walk',
    model: 'seedance-2.0-min',
    duration: 5,
    refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://example.com/ref.png' }],
  })
  await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
  const [, opts] = videoGenerate.mock.calls[0]
  expect(opts).toMatchObject({ image: 'https://example.com/ref.png' })
})
```

- [ ] **Step 2: Run FAIL**

```bash
pnpm --filter @lnkpi/server test -- src/canvas/material.service.test.ts
```

- [ ] **Step 3: 实现**

顺序（同步路径）：

1. ownership  
2. `assertNoBlobRefs(refs)` — 任一 `url?.trim().startsWith('blob:')` → `BadRequestException('参考图尚未上传')`  
3. charge（除非 skipCharge）  
4. create Material with **raw local prompt** 先写入亦可；异步更新为 effective（推荐异步完成后 `update` prompt 为 effectivePrompt，或 create 时先用 local，完成时覆盖）

异步 `runImageGeneration` / `runVideoGeneration` 增加 `refs`、`mentionedKeys` 参数：

```ts
const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(...)
this.logger.log(JSON.stringify({ event: 'canvas_material_merge', skippedMerge, refsCount: refs?.length ?? 0, referenceImages: referenceImages.length }))
const built = buildImageProviderOptions({ modelKey, size, n: 1, referenceImages })
const primary = built.referenceImages[0]
const base = primary ? buildPromptWithRefImage(mergedText, primary) : mergedText
const effectivePrompt = [base, built.effectivePromptSuffix].filter(Boolean).join('\n')
// generate + update material { url, prompt: effectivePrompt, status }
```

Video 同理：`buildVideoProviderOptions({ referenceImages })`，`image: built.image`。

V*/A* refs 留在数组中但不进入 extract*（filter 仅 text/image）。

- [ ] **Step 4: Run PASS + Commit**

```bash
pnpm --filter @lnkpi/server test -- src/canvas/material.service.test.ts
git add apps/server/src/canvas/material.service.ts apps/server/src/canvas/material.service.test.ts
git commit -m "feat(server): merge canvas material refs like Studio"
```

---

### Task 3: Controller DTO — 嵌套 refs

**Files:**
- Modify: `apps/server/src/canvas/canvas.controller.ts`

**Interfaces:**
- Produces nested DTO:

```ts
class CanvasRefDto {
  @IsString() refKey!: string
  @IsString() mediaType!: string
  @IsOptional() @IsString() label?: string
  @IsOptional() @IsString() text?: string
  @IsOptional() @IsString() url?: string
}
```

挂到 `GenerateImageDto`、`GenerateVideoDto`、`SceneComposerBatchItemDto`：

```ts
@IsOptional()
@IsArray()
@ValidateNested({ each: true })
@Type(() => CanvasRefDto)
refs?: CanvasRefDto[]

@IsOptional()
@IsArray()
@IsString({ each: true })
mentionedKeys?: string[]
```

Controller 调用 material 时透传 `refs`、`mentionedKeys`。

- [ ] **Step 1: 改 DTO + 透传**

- [ ] **Step 2: Build**

```bash
pnpm --filter @lnkpi/server build
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/canvas/canvas.controller.ts
git commit -m "feat(api): accept refs and mentionedKeys on canvas material DTOs"
```

---

### Task 4: SceneComposer — batch blob 预检 + 透传 refs

**Files:**
- Modify: `apps/server/src/canvas/scene-composer.service.ts`
- Modify: `apps/server/src/canvas/scene-composer.service.test.ts`

**Interfaces:**
- `generateItem` 把 `item.refs` / `item.mentionedKeys` 传给 Material
- 新增：

```ts
private assertNoBlobRefsInBatch(items: SceneComposerBatchItem[]) {
  for (const item of items) {
    for (const ref of item.refs ?? []) {
      if (ref.url?.trim().startsWith('blob:')) {
        throw new BadRequestException('参考图尚未上传')
      }
    }
  }
}
```

在 `points.consume` **之前**、所有权校验之后调用。

- [ ] **Step 1: 测试**

```ts
it('rejects batch when any item has blob ref before charging', async () => {
  // owned session
  // items[0].refs = [{ refKey:'I1', mediaType:'image', url:'blob:x' }]
  await expect(svc.batchGenerate('u1', dto)).rejects.toBeInstanceOf(BadRequestException)
  expect(consume).not.toHaveBeenCalled()
  expect(materialGenerateImage).not.toHaveBeenCalled()
})

it('passes refs to material with skipCharge', async () => {
  // item with https I1
  await svc.batchGenerate('u1', dto)
  expect(materialGenerateImage).toHaveBeenCalledWith(
    expect.objectContaining({
      skipCharge: true,
      refs: expect.arrayContaining([expect.objectContaining({ refKey: 'I1' })]),
    }),
  )
})
```

- [ ] **Step 2: 实现 + Run + Commit**

```bash
pnpm --filter @lnkpi/server test
git add apps/server/src/canvas/scene-composer.service.ts apps/server/src/canvas/scene-composer.service.test.ts
git commit -m "feat(server): validate and forward refs in sceneComposer batch"
```

---

### Task 5: Web — canvas-api + 目标节点 refs 解析

**Files:**
- Modify: `apps/web/src/services/canvas-api.ts`
- Modify: `apps/web/src/utils/sceneComposer.ts`
- Modify: `apps/web/src/utils/sceneComposer.test.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- canvas-api:

```ts
generateImage(shotId, prompt, opts?: {
  model?, aspectRatio?, resolution?, count?,
  refs?: GenerationRefPayload[],
  mentionedKeys?: string[],
})
generateVideo(shotId, prompt, settings?: Partial<VideoSettings> & {
  model?, refs?, mentionedKeys?,
})
```

- `BuildBatchGenerateItemsOptions`:

```ts
{
  nodes: EditableFlowNode[]
  edges: CanvasEdgeLike[]
  composerNodeId: string
}
```

- Helper（可放 sceneComposer.ts 或 useNodeGeneration 旁）:

```ts
function toGenerationRefs(node, nodes, edges): GenerationRefPayload[]
// wrap resolveNodeRefs → filter !stale → map {refKey,mediaType,label,text,url}
```

- [ ] **Step 1: sceneComposer 测试**

```ts
it('uses media child prompt and refs when expanded', () => {
  // child has prompt 'child' and edge from text node
  // expect item.prompt === 'child'
  // expect item.refs some T1
})

it('falls back to shot prompt and composer refs when child missing', () => {
  // no imageNodeId
  // composer has localRefs/edges → refs from composer
  // prompt === shot.prompt
})
```

- [ ] **Step 2: useNodeGeneration 测试**

```ts
it('shot-linked image sends media local prompt and refs, not canvasPrompt', async () => {
  // image linked to shot; image.prompt='local'; upstream text exists
  // expect canvasApi.generateImage called with 'local' and refs including T*
  // expect call prompt NOT to equal mergePromptWithUpstream result if different
})

it('blocks canvas image when blob ref present', async () => {
  // same as studio blob guard but path is canvasApi
  expect(canvasApi.generateImage).not.toHaveBeenCalled()
})

it('generateShot uses shot local prompt with shot refs', async () => { ... })
```

- [ ] **Step 3: 实现**

1. 扩展 canvas-api body 字段。  
2. `buildBatchGenerateItems`：按规格 §3.2 选 prompt 目标与 refs 目标；`mentionedKeys = parseRefMentions(finalPrompt)`。  
3. `generateImageOrVideo` shot-linked：传 `local` + `refs` + `mentionedKeys`（函数已有参数），**不要**传 `canvasPrompt`。  
4. `generateShot(node, localPrompt, data)`：签名改为 local；内部 `resolveStudioRefs(node,...)` + `parseRefMentions(local)`；调用 canvasApi 带 refs。  
5. `batchGenerateSceneComposer`：传入 `{ nodes, edges, composerNodeId: node.id }`。  
6. blob：shot / shot-linked / batch 组装前检查 `hasBlobReference`。

注意：`generateForNode` 里对 shot 调用改为 `generateShot(node, local, data)`，不再传 `canvasPrompt`。`canvasPrompt` 变量若仅 shot 使用可删除该路径的计算；其他路径若仍引用 upstream 展示可保留 `resolveUpstreamContext` 仅作非生成用途（YAGNI：生成路径不用即可）。

- [ ] **Step 4: Run + Commit**

```bash
pnpm --filter @lnkpi/web test
git add apps/web
git commit -m "feat(web): pass target-node refs on canvas generation paths"
```

---

### Task 6: 全仓验收 + 文档 + PR

**Files:**
- Modify: `docs/DOCK_STUDIO_E2E_TRACKING.md`
- Modify: `docs/superpowers/specs/2026-07-19-c21-canvas-refs-design.md`（状态 → 已实现 / 待合入）

- [ ] **Step 1: 全量**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm test
```

- [ ] **Step 2: 文档**

在跟踪文档新增 C2.1 小节：范围、目标节点语义、手工清单（规格 §8.3 六条）、后续 C3/C4。

- [ ] **Step 3: Push + PR**

```bash
git add docs
git commit -m "docs: mark C2.1 canvas refs ready for review"
git push -u origin HEAD
gh pr create --title "feat(canvas): C2.1 旁路接入 T*/I* refs 与 prompt merge" --body "$(cat <<'EOF'
## Summary
- Material/shot/sceneComposer 消费 T*/I* refs + mentionedKeys（对齐 Studio merge）
- 目标节点语义；禁止 canvasPrompt 双重合并
- Web + Server blob 拦截；merge 不另计费
- V*/A* 明确留给 C3/C4

## Spec
docs/superpowers/specs/2026-07-19-c21-canvas-refs-design.md

## Test plan
- [ ] pnpm build && pnpm test
- [ ] text→shot 合并文案
- [ ] image→shot-linked video I*
- [ ] sceneComposer 已展开/未展开 batch refs
- [ ] blob Web + API 拒绝
- [ ] 积分不足 batch 零启动
EOF
)"
```

---

## Spec coverage

| 规格要求 | Task |
|----------|------|
| GenerationRefPayload + BatchItem 字段 | T1 |
| Material merge + I* adapter + blob 扣费前拒绝 | T2 |
| Controller DTO | T3 |
| Batch blob 预检 + 透传 | T4 |
| Web 目标节点解析 + 停用 canvasPrompt | T5 |
| 验收 + 文档 + PR | T6 |
| 无 V*/A* / 无共享 resolver / 无另计费 | Global |

## Self-review

- 无 TBD；blob 文案统一 `参考图尚未上传`
- Material helpers 刻意重复 Studio（规格禁止本轮抽取）
- Task 5 明确 `generateShot(node, local, data)` 签名变更

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-c21-canvas-refs.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新 subagent，任务间 review  
2. **Inline Execution** — 本会话连续执行，设检查点  

**Which approach?**
