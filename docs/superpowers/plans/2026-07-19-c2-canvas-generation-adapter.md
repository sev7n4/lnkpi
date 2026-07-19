# C2 Canvas 旁路接入 Studio Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** shot / shot 子媒体 / sceneComposer batch 走 C1 catalog + adapter，并与 Studio 同价扣费、校验资源归属。

**Architecture:** 抽出共享 `PointsService`（原子条件扣减）；`MaterialService` 增量调用 `buildImageProviderOptions` / `buildVideoProviderOptions`；Controller 注入 `userId`；Web 从媒体子节点解析配置，缺失时用 catalog 默认；旁路固定 `count = 1`。

**Tech Stack:** NestJS、Prisma、Vitest、`@lnkpi/shared` catalog、`@lnkpi/agent` generation-adapter、Vue composables

**Spec:** `docs/superpowers/specs/2026-07-19-c2-canvas-generation-adapter-design.md`

## Global Constraints

- 范围仅 **C2 最小**：模型/参数/计费/所有权；**无** refs、mentionedKeys、LLM merge、多图 Material、V\*、A\*、Playwright
- image Canvas 路径强制 `n = 1`；客户端 `count > 1` 忽略并打结构化日志
- 计费：图 10；视频 5→30 / 10→50 / 15→70；batch 整批预检一次扣费；失败不退款
- 非本人 / 不存在资源 → `NotFoundException`（HTTP 404）
- Material 保持现有异步 + shot polling；不写 `GenerationRecord`
- 独立分支 `feature/c2-canvas-generation-adapter`；提交前 `pnpm build && pnpm test` 全绿
- C2.1 / C3 / C4 **不在本 PR**

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/server/src/points/points.service.ts` | 原子扣费 + PointTransaction |
| `apps/server/src/points/points.module.ts` | 导出 PointsService |
| `apps/server/src/points/points.service.test.ts` | 扣费单测 |
| `apps/server/src/studio/studio.service.ts` | 改用 PointsService |
| `apps/server/src/studio/studio.module.ts` | import PointsModule |
| `apps/server/src/studio/studio.test-utils.ts` | mock 补 PointsService |
| `apps/server/src/studio/studio.smoke.test.ts` | harness 补 PointsService |
| `apps/server/src/canvas/material.service.ts` | adapter + 扣费 + 所有权 |
| `apps/server/src/canvas/material.service.test.ts` | Material 集成测 |
| `apps/server/src/canvas/scene-composer.service.ts` | batch 预检扣费 + 所有权 |
| `apps/server/src/canvas/scene-composer.service.test.ts` | batch 集成测 |
| `apps/server/src/canvas/canvas.controller.ts` | DTO 扩展 + 传 userId |
| `apps/server/src/canvas/canvas.module.ts` | import PointsModule |
| `packages/shared/src/sceneComposer.ts` | BatchItem 扩展字段 |
| `apps/web/src/services/canvas-api.ts` | 传 model/params |
| `apps/web/src/utils/sceneComposer.ts` | batch 从子节点读配置 |
| `apps/web/src/composables/useNodeGeneration.ts` | shot/canvas 路径传配置 |
| `apps/web/src/composables/useNodeGeneration.test.ts` | Web payload 断言 |
| `apps/web/src/utils/sceneComposer.test.ts` | batch 解析单测 |
| `docs/DOCK_STUDIO_E2E_TRACKING.md` | C2 状态 + 手测项 |
| `docs/superpowers/specs/2026-07-19-test-infrastructure-design.md` | §6 T1 标已合入（顺带） |

---

### Task 1: PointsService + Studio 迁移

**Files:**
- Create: `apps/server/src/points/points.service.ts`
- Create: `apps/server/src/points/points.module.ts`
- Create: `apps/server/src/points/points.service.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.module.ts`
- Modify: `apps/server/src/studio/studio.test-utils.ts`
- Modify: `apps/server/src/studio/studio.smoke.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class PointsService {
    constructor(prisma: PrismaService)
    consume(userId: string, cost: number, reason: string): Promise<void>
  }
  ```
- Consumes: `PrismaService`

- [ ] **Step 1: 写失败测试**

```ts
// apps/server/src/points/points.service.test.ts
import 'reflect-metadata'
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { PointsService } from './points.service'
import { PrismaService } from '../prisma/prisma.service'

describe('PointsService', () => {
  it('decrements points and writes negative transaction when balance is enough', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }))
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: 'pt1', ...args.data }))
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { updateMany },
        pointTransaction: { create },
      }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()
    const svc = moduleRef.get(PointsService)

    await svc.consume('u1', 10, '图像生成')

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', points: { gte: 10 } },
      data: { points: { decrement: 10 } },
    })
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'u1', amount: -10, reason: '图像生成' },
    })
  })

  it('throws 积分不足 when conditional update matches zero rows', async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }))
    const create = vi.fn()
    const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        user: { updateMany },
        pointTransaction: { create },
      }),
    )
    const moduleRef = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: PrismaService, useValue: { $transaction } },
      ],
    }).compile()

    await expect(moduleRef.get(PointsService).consume('u1', 10, '图像生成')).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run 确认失败**

```bash
pnpm --filter @lnkpi/server test -- src/points/points.service.test.ts
```

Expected: FAIL（文件/类不存在）

- [ ] **Step 3: 实现 PointsService + Module**

```ts
// points.service.ts
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PointsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async consume(userId: string, cost: number, reason: string): Promise<void> {
    if (cost <= 0) return
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: { id: userId, points: { gte: cost } },
        data: { points: { decrement: cost } },
      })
      if (updated.count === 0) {
        throw new BadRequestException('积分不足')
      }
      await tx.pointTransaction.create({
        data: { userId, amount: -cost, reason },
      })
    })
  }
}
```

```ts
// points.module.ts
import { Module } from '@nestjs/common'
import { PointsService } from './points.service'

@Module({
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
```

- [ ] **Step 4: Studio 迁移**

在 `StudioService`：
- 注入 `PointsService`
- 删除私有 `consumePoints`
- 所有 `this.consumePoints(...)` → `this.points.consume(...)`

`studio.module.ts`：`imports: [PointsModule]`

更新 `studio.test-utils.ts` / `studio.smoke.test.ts`：providers 增加真实 `PointsService`（仍 mock Prisma），或提供 `{ provide: PointsService, useValue: { consume: vi.fn() } }`。推荐 **真实 PointsService + 扩展 Prisma mock** 的 `$transaction` 支持 callback 形式：

```ts
$transaction: async (arg: unknown) => {
  if (typeof arg === 'function') {
    return (arg as (tx: unknown) => Promise<unknown>)({
      user: {
        updateMany: async () => ({ count: 1 }),
      },
      pointTransaction: {
        create: async (a: { data: Record<string, unknown> }) => ({ id: 'pt1', ...a.data }),
      },
    })
  }
  return Promise.all(arg as Promise<unknown>[])
},
```

- [ ] **Step 5: Run 确认通过**

```bash
pnpm --filter @lnkpi/server test
```

Expected: PASS（含原 studio 测试）

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/points apps/server/src/studio
git commit -m "feat(server): extract PointsService with atomic consume"
```

---

### Task 2: MaterialService image — adapter + 扣费 + 所有权

**Files:**
- Modify: `apps/server/src/canvas/material.service.ts`
- Create: `apps/server/src/canvas/material.service.test.ts`
- Modify: `apps/server/src/canvas/canvas.module.ts`

**Interfaces:**
- Consumes: `PointsService.consume`, `buildImageProviderOptions`, `createImageProvider`, `resolveImageSize`
- Produces:
  ```ts
  type CanvasImageGenerateInput = {
    userId: string
    shotId: string
    prompt: string
    model?: string
    aspectRatio?: string
    resolution?: string
    count?: number
  }
  generateImage(input: CanvasImageGenerateInput): Promise<Material>
  ```

- [ ] **Step 1: 写失败测试（mock provider）**

```ts
import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import { resolveImageSize } from '@lnkpi/shared'
import { createImageProvider } from '@lnkpi/agent'
import { MaterialService } from './material.service'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

const imageGenerate = vi.fn(async () => ({ url: 'https://example.com/a.png' }))
vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createImageProvider: vi.fn(() => ({ generate: imageGenerate })),
  }
})

describe('MaterialService image', () => {
  let svc: MaterialService
  const consume = vi.fn(async () => {})
  const materialCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'm1',
    ...args.data,
  }))
  const materialUpdate = vi.fn(async () => ({}))
  const shotFindUnique = vi.fn(async () => ({
    id: 'shot-1',
    sessionId: 'sess-1',
    session: { id: 'sess-1', userId: 'u1' },
  }))

  beforeEach(async () => {
    vi.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        MaterialService,
        { provide: PointsService, useValue: { consume } },
        {
          provide: PrismaService,
          useValue: {
            shot: { findUnique: shotFindUnique },
            material: { create: materialCreate, update: materialUpdate },
          },
        },
      ],
    }).compile()
    svc = moduleRef.get(MaterialService)
  })

  it('passes adapter modelId/size/n=1 and charges 10', async () => {
    await svc.generateImage({
      userId: 'u1',
      shotId: 'shot-1',
      prompt: 'a cat',
      model: 'seedream-5.0-pro',
      aspectRatio: '16:9',
      resolution: '1K',
      count: 3,
    })
    await vi.waitFor(() => expect(imageGenerate).toHaveBeenCalled())
    expect(consume).toHaveBeenCalledWith('u1', 10, '图像生成')
    expect(imageGenerate).toHaveBeenCalledWith('a cat', {
      modelId: 'seedream-5.0-pro',
      size: resolveImageSize('16:9', '1K'),
      n: 1,
    })
  })

  it('rejects foreign shot without charging', async () => {
    shotFindUnique.mockResolvedValueOnce({
      id: 'shot-1',
      sessionId: 'sess-1',
      session: { id: 'sess-1', userId: 'other' },
    })
    await expect(
      svc.generateImage({ userId: 'u1', shotId: 'shot-1', prompt: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(consume).not.toHaveBeenCalled()
    expect(materialCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run 确认失败**

```bash
pnpm --filter @lnkpi/server test -- src/canvas/material.service.test.ts
```

- [ ] **Step 3: 实现 generateImage**

要点：
1. `shot.findUnique({ where: { id }, include: { session: true } })`
2. 不存在或 `session.userId !== userId` → `NotFoundException('分镜不存在')`
3. `count > 1` → `console.info`/`Logger` JSON：`{ event: 'canvas_image_count_clamped', requested: count, effective: 1 }`
4. `await points.consume(userId, 10, '图像生成')`
5. create Material `generating`
6. async：`buildImageProviderOptions({ modelKey: model, size: resolveImageSize(...), n: 1, referenceImages: [] })` → `createImageProvider().generate(prompt, { modelId, size, n })`
7. `canvas.module.ts` import `PointsModule`

签名改为对象参数；旧位置参数调用方在 Task 4 一并改。

- [ ] **Step 4: Run PASS + Commit**

```bash
pnpm --filter @lnkpi/server test -- src/canvas/material.service.test.ts
git add apps/server/src/canvas apps/server/src/canvas/canvas.module.ts
git commit -m "feat(server): wire Material image path to adapter and billing"
```

---

### Task 3: MaterialService video — adapter + 扣费

**Files:**
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/material.service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type CanvasVideoGenerateInput = {
    userId: string
    shotId: string
    prompt: string
    model?: string
    duration?: number
    aspectRatio?: string
    resolution?: string
    crop?: string
  }
  generateVideo(input: CanvasVideoGenerateInput): Promise<Material>
  ```
- Cost helper（同文件私有函数）:
  ```ts
  function videoCredits(duration: number): number {
    if (duration >= 15) return 70
    if (duration >= 10) return 50
    return 30
  }
  ```

- [ ] **Step 1: 追加失败测试**

```ts
it('passes video adapter options and charges by duration', async () => {
  const videoGenerate = vi.fn(async () => ({ url: 'https://example.com/v.mp4' }))
  vi.mocked(createVideoProvider).mockReturnValue({ generate: videoGenerate } as never)

  await svc.generateVideo({
    userId: 'u1',
    shotId: 'shot-1',
    prompt: 'walk',
    model: 'seedance-2.0-min',
    duration: 10,
    aspectRatio: '16:9',
    resolution: '720p',
    crop: 'none',
  })
  await vi.waitFor(() => expect(videoGenerate).toHaveBeenCalled())
  expect(consume).toHaveBeenCalledWith('u1', 50, '视频生成')
  const [prompt, opts] = videoGenerate.mock.calls[0]
  expect(prompt).toBe('walk')
  expect(opts).toMatchObject({
    model: 'seedance-2.0-min',
    duration: 10,
    aspectRatio: '16:9',
    resolution: '720p',
  })
  // crop metadataOnly → 不应以 native 值强制出现；undefined OK
})
```

在文件顶部 `vi.mock` 增加 `createVideoProvider`。

- [ ] **Step 2: 实现**

- 所有权同 image
- `duration` 默认 5，`aspectRatio` 默认 `16:9`，`resolution` 默认 `720p`，`crop` 默认 `none`
- `points.consume(userId, videoCredits(duration), '视频生成')`
- `buildVideoProviderOptions({ modelKey, duration, aspectRatio, resolution, crop, referenceImages: [] })`
- `createVideoProvider().generate(prompt, { model, duration, aspectRatio, resolution, crop: built.crop, image: built.image })`
- **删除**手工 `[aspect:..., crop:...]` 拼 prompt

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @lnkpi/server test -- src/canvas/material.service.test.ts
git add apps/server/src/canvas/material.service.ts apps/server/src/canvas/material.service.test.ts
git commit -m "feat(server): wire Material video path to adapter and billing"
```

---

### Task 4: CanvasController DTO + 传 userId

**Files:**
- Modify: `apps/server/src/canvas/canvas.controller.ts`
- Modify: `packages/shared/src/sceneComposer.ts`（BatchItem 类型，供 Task 5）

**Interfaces:**
- Produces DTO 字段与规格 §4 一致

- [ ] **Step 1: 扩展 shared BatchItem**

```ts
export interface SceneComposerBatchItem {
  shotNodeId: string
  title?: string
  prompt: string
  mediaType: Exclude<SceneComposerShotMediaType, 'none'>
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: 5 | 10 | 15
  crop?: string
  count?: number
}
```

- [ ] **Step 2: 扩展 Controller DTO + 调用**

`GenerateImageDto` 增加 optional：`model`, `aspectRatio`, `resolution`, `count`  
`GenerateVideoDto` 增加 optional：`model`, `resolution`（已有 duration/aspect/crop）  
`SceneComposerBatchItemDto` 同步增加上述字段  

```ts
@Post('material/generate-image')
@UseGuards(AuthGuard)
async generateImage(@Req() req: { user: { sub: string } }, @Body() dto: GenerateImageDto) {
  const data = await this.materialService.generateImage({
    userId: req.user.sub,
    shotId: dto.shotId,
    prompt: dto.prompt,
    model: dto.model,
    aspectRatio: dto.aspectRatio,
    resolution: dto.resolution,
    count: dto.count,
  })
  return { code: 0, message: 'ok', data }
}
```

Video / `saveSceneComposer` / `batchGenerateSceneComposer` 同样传 `req.user.sub`。

- [ ] **Step 3: shared + server build**

```bash
pnpm --filter @lnkpi/shared build
pnpm --filter @lnkpi/server build
```

Expected: PASS（SceneComposerService 签名若尚未改，先只改 controller 对 material；batch 签名在 Task 5 改时一起编过）

若 Task 5 未做导致类型错，本 Task 可先只改 material 两个 endpoint + DTO，batch/save 的 userId 放 Task 5。

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/sceneComposer.ts apps/server/src/canvas/canvas.controller.ts
git commit -m "feat(api): extend canvas material DTOs with model params and userId"
```

---

### Task 5: SceneComposerService — 所有权 + 整批预检扣费

**Files:**
- Modify: `apps/server/src/canvas/scene-composer.service.ts`
- Create: `apps/server/src/canvas/scene-composer.service.test.ts`
- Modify: `apps/server/src/canvas/canvas.controller.ts`（若 Task 4 未传 batch userId）

**Interfaces:**
- Produces:
  ```ts
  save(userId: string, dto: SceneComposerSaveRequest): Promise<...>
  batchGenerate(userId: string, dto: SceneComposerBatchGenerateRequest): Promise<...>
  ```

- [ ] **Step 1: 写失败测试**

```ts
it('precomputes total cost and consumes once before starting materials', async () => {
  // mock session owned by u1
  // items: 1 image + 1 video(10s) → cost 10+50=60
  // points.consume called once with 60
  // material.generateImage/Video called with userId + model fields
})

it('rejects foreign session with zero side effects', async () => {
  // session.userId = other → NotFoundException
  // consume not called
})
```

- [ ] **Step 2: 实现**

```ts
private async assertOwnedSession(sessionId: string, userId: string) {
  const session = await this.prisma.session.findFirst({ where: { id: sessionId, userId } })
  if (!session) throw new NotFoundException('画布不存在')
  return session
}

private itemCredits(item: SceneComposerBatchItem): number {
  if (item.mediaType === 'video') {
    const d = item.duration ?? 5
    return d >= 15 ? 70 : d >= 10 ? 50 : 30
  }
  return 10
}
```

`batchGenerate` 流程：
1. `assertOwnedSession`
2. 校验每个已存在 shot：`shot.sessionId === dto.sessionId`，否则 404
3. `total = sum(itemCredits)`
4. `await points.consume(userId, total, \`导演台批量生成 ×${items.length}\`)`
5. 逐项：upsert shot → `materialService.generateImage/Video`，但 **Material 内不再二次扣费**

> **重要设计点：** batch 已一次扣费时，Material 不能再扣。两种实现选一（本计划固定 **A**）：
>
> **A（推荐）：** `generateImage/Video` 增加可选 `skipCharge?: boolean`；batch 传 `skipCharge: true`。  
> **B：** 抽出 `startImageGeneration` 内部方法，charge 只在公开 API。

实现 A：

```ts
generateImage(input: CanvasImageGenerateInput & { skipCharge?: boolean })
```

单测追加：`skipCharge: true` 时 `consume` 不被调用。

- [ ] **Step 3: Controller 传 userId 给 save/batch**

- [ ] **Step 4: Run + Commit**

```bash
pnpm --filter @lnkpi/server test
git add apps/server/src/canvas
git commit -m "feat(server): prepaid sceneComposer batch billing and ownership checks"
```

---

### Task 6: Web canvas-api + 配置解析

**Files:**
- Modify: `apps/web/src/services/canvas-api.ts`
- Modify: `apps/web/src/utils/sceneComposer.ts`
- Create: `apps/web/src/utils/sceneComposer.test.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Produces helpers（可放在 `sceneComposer.ts` 或 `useNodeGeneration.ts` 旁）:
  ```ts
  function resolveCanvasImageParams(data: Record<string, unknown>): {
    model: string
    aspectRatio: string
    resolution: string
    count: 1
  }
  function resolveCanvasVideoParams(data: Record<string, unknown>): {
    model: string
    duration: 5 | 10 | 15
    aspectRatio: string
    resolution: string
    crop: string
  }
  ```

- [ ] **Step 1: 扩展 canvas-api**

```ts
generateImage: (
  shotId: string,
  prompt: string,
  opts?: { model?: string; aspectRatio?: string; resolution?: string; count?: number },
) =>
  api.post('/agent/canvas/material/generate-image', {
    shotId,
    prompt,
    model: opts?.model,
    aspectRatio: opts?.aspectRatio,
    resolution: opts?.resolution,
    count: 1,
  }),

generateVideo: (
  shotId: string,
  prompt: string,
  settings?: Partial<VideoSettings> & { model?: string },
) =>
  api.post('/agent/canvas/material/generate-video', {
    shotId,
    prompt,
    model: settings?.model,
    duration: settings?.duration,
    aspectRatio: settings?.aspectRatio,
    crop: settings?.crop,
    resolution: settings?.resolution,
  }),
```

- [ ] **Step 2: sceneComposer batch 解析测试**

```ts
it('reads media child node model settings when expanded', () => {
  const items = buildBatchGenerateItems(payload, {
    nodes: [
      { id: 'img-1', type: 'image', data: { imageModel: 'navo-pro', imageAspect: '9:16', imageResolution: '2K' } },
    ],
  })
  expect(items[0]).toMatchObject({
    mediaType: 'image',
    model: 'navo-pro',
    aspectRatio: '9:16',
    resolution: '2K',
    count: 1,
  })
})

it('falls back to catalog defaults when child missing', () => {
  const items = buildBatchGenerateItems(payload, { nodes: [] })
  expect(items[0].model).toBe(defaultModelKey('image'))
})
```

- [ ] **Step 3: 实现 buildBatchGenerateItems 扩展 + useNodeGeneration**

- shot-linked image/video：传子节点解析结果
- `generateShot`：找到出边 image/video 子节点读配置；否则 catalog 默认；video 用子节点 `videoSettings` + `videoModel`
- `batchGenerateSceneComposer`：把 `deps.nodes.value` 传入 `buildBatchGenerateItems`

- [ ] **Step 4: 扩展 useNodeGeneration.test.ts**

覆盖规格 §8.2 至少 4 条：shot-linked image、shot-linked video、缺失默认、独立 studio 不回归。

- [ ] **Step 5: Run + Commit**

```bash
pnpm --filter @lnkpi/web test
git add apps/web packages/shared
git commit -m "feat(web): pass canvas model params from media child nodes"
```

---

### Task 7: 全仓验收 + 文档 + PR

**Files:**
- Modify: `docs/DOCK_STUDIO_E2E_TRACKING.md`
- Modify: `docs/superpowers/specs/2026-07-19-c2-canvas-generation-adapter-design.md`（状态 → 实现中/已实现）
- Modify（可选）: `docs/superpowers/specs/2026-07-19-test-infrastructure-design.md` §6 T1 行改为已合入

- [ ] **Step 1: 全量**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm test
```

Expected: all green

- [ ] **Step 2: 更新跟踪文档**

在 `DOCK_STUDIO_E2E_TRACKING.md` 增加 C2 小节：状态、旁路已接 adapter、手测清单（规格 §8.3 六条）。

规格头状态改为 **已实现**（合并前可先写「实现完成 / 待合入」）。

- [ ] **Step 3: Commit + Push + PR**

```bash
git add docs
git commit -m "docs: mark C2 canvas adapter ready for review"
git push -u origin HEAD
gh pr create --title "feat(canvas): C2 旁路接入 Studio adapter 与统一计费" --body "$(cat <<'EOF'
## Summary
- Material/shot/sceneComposer 路径接入 C1 catalog + generation adapter
- 共享 PointsService 原子扣费；batch 整批预检一次扣除
- Canvas 生成入口校验 session/shot 归属（404）
- Web 从媒体子节点解析模型参数；旁路固定 count=1
- refs / V* / A* 明确留给 C2.1 / C3 / C4

## Spec
docs/superpowers/specs/2026-07-19-c2-canvas-generation-adapter-design.md

## Test plan
- [ ] pnpm build && pnpm test
- [ ] shot + image 子节点非默认模型生成
- [ ] shot + video 子节点参数生成
- [ ] sceneComposer 未展开 / 已展开 batch
- [ ] 积分不足 batch 零启动
- [ ] 非本人 session/shot 404
EOF
)"
```

---

## Spec coverage

| 规格要求 | Task |
|----------|------|
| PointsService 原子扣费 | T1 |
| Studio 迁移 PointsService | T1 |
| Material image adapter + n=1 + 扣费 + 所有权 | T2 |
| Material video adapter + 按时长扣费 | T3 |
| Controller DTO + userId | T4 |
| shared BatchItem 扩展 | T4 |
| sceneComposer 所有权 + 整批预检 + skipCharge | T5 |
| Web 配置解析 + canvas-api | T6 |
| 全量验收 + 文档 + PR | T7 |
| 无 refs / 无多图 Material / 无 V\*A\* | Global |

## Self-review

- 无 TBD；`skipCharge` 在 Task 5 固定方案 A
- 权限统一 `NotFoundException`
- Task 接口名与规格 §3–§4 一致
- Studio 回归由 T1 更新 harness + 现有 integration tests 覆盖

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-c2-canvas-generation-adapter.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新 subagent，任务间 review，迭代快  
2. **Inline Execution** — 本会话按 executing-plans 批量执行，设检查点

**Which approach?**
