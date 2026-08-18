# 画布图像精修（Cx-image-edit P1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在画布图片节点上提供显式进入的精修工作台：手画 mask + 指令 → Image2 inpaint → 服务端合成保真 → 同节点版本链写回。

**Architecture:** 生成链路不动。新增 `EditProvider` + `buildImageEditRequest`（禁止改 `ImageProvider.generate` / `buildImageProviderOptions`）。前端用 `imageTarget` 仅由显式入口打开精修 Dock，替换 `AIImageEditor` 整图变体弹窗。mask 外像素由 sharp 合成兜底。

**Tech Stack:** Vue 3 + Pinia、NestJS、sharp、Vitest、APIMart `gpt-image-2-official` async JSON

**Spec:** `docs/superpowers/specs/2026-08-18-cx-image-edit-design.md`

## Global Constraints

- 选中图片节点**不得**打开精修；默认底部栏仍是生成 Studio Dock
- **禁止**给 `ImageProvider.generate()` / `buildImageProviderOptions()` 增加 `maskUrl`
- **禁止**在 `ImageDockPanel` / `ImageParamsSelector` 出现 mask 控件
- **禁止**复用 `buildImageRefConsistencyBlock` 作为编辑 prompt
- **禁止**用 `POST /studio/image/variation` 冒充局部精修（该接口本轮保留但不从画布入口调用）
- P1 上游固定 `modelKey: 'image2'` / `gpt-image-2-official`；用户不可选编辑模型
- 积分 **10 / 次**，`chargeReason: '图像精修'`；失败/取消走现有 consume → refund
- 写回**同一节点**版本链；不新建旁路节点；不改 Prisma schema
- mask：白/不透明 = 可编辑；覆盖面积 &lt; 0.3% 前端拦截；服务端合成 mask 外强制底图像素
- 入口文案：「编辑图像」保持；Dock 次入口「精修这张图」；工作台标题「精修」
- `get_image_edit_capabilities.supportedModes` P1 仅为 `['inpaint']`
- `run_icon_refine` 不改
- TDD：先写失败测试再实现；提交前缀 `feat:`
- 不进 `/image-studio`

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/canvas/imageVersions.ts` | 版本链纯函数 + 类型 |
| `packages/shared/src/imageEditProfiles.ts` | P1 编辑模型 profile |
| `packages/agent/src/studio/edit-adapter.ts` | `buildImageEditRequest` / 编辑 prompt |
| `packages/agent/src/tools/image-edit-provider.ts` | `EditProvider.edit()`（独立于 generate） |
| `apps/server/src/media/composite-unmasked.ts` | 尺寸校验 + sharp 合成 + 读图 |
| `apps/server/src/studio/studio.service.ts` | `editImage` |
| `apps/server/src/studio/studio.controller.ts` | `POST /studio/image/edit` |
| `apps/web/src/utils/maskCoverage.ts` | 选区覆盖率判定 |
| `apps/web/src/utils/refineSession.ts` | 打开/关闭/进行中切走规则 |
| `apps/web/src/components/canvas/refine/*` | Mask / Compare / Version / RefineDockPanel |
| `apps/web/src/stores/canvasEditor.ts` | `imageTarget` + `refineBusy` |
| `apps/web/src/pages/CanvasPage.vue` | 显式入口、Dock 切换、写回 |
| `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue` | 「精修这张图」次入口（无 mask） |
| `apps/web/src/components/canvas/AIImageEditor.vue` | **删除**（被精修工作台替换） |

---

### Task 0: 分支基线

- [ ] **Step 1:** `git checkout main && git pull origin main`
- [ ] **Step 2:** `git checkout -b feature/cx-image-edit`
- [ ] **Step 3:** `pnpm --filter @lnkpi/shared test && pnpm --filter @lnkpi/agent test` 确认基线绿

---

### Task 1: 节点图像版本链纯函数

**Files:**
- Create: `packages/shared/src/canvas/imageVersions.ts`
- Create: `packages/shared/src/canvas/imageVersions.test.ts`
- Modify: `packages/shared/src/index.ts`（增加 `export * from './canvas/imageVersions'`）

**Interfaces:**
- Produces:
  - `export type ImageVersionSource = 'generate' | 'upload' | 'edit'`
  - `export interface ImageVersionEntry { id: string; url: string; createdAt: string; source: ImageVersionSource; generationRecordId?: string; parentVersionId?: string; editPrompt?: string }`
  - `export interface ImageVersionState { url: string; currentVersionId?: string; imageVersions?: ImageVersionEntry[]; generationRecordId?: string }`
  - `export function seedImageVersions(state: ImageVersionState, opts?: { id?: string; now?: string; source?: ImageVersionSource }): ImageVersionState`
  - `export function appendEditVersion(state: ImageVersionState, input: { id: string; url: string; createdAt: string; generationRecordId?: string; editPrompt: string }): ImageVersionState`
  - `export function revertImageVersion(state: ImageVersionState, versionId: string): ImageVersionState`
  - `export function currentImageVersion(state: ImageVersionState): ImageVersionEntry | undefined`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  appendEditVersion,
  currentImageVersion,
  revertImageVersion,
  seedImageVersions,
} from './imageVersions'

describe('seedImageVersions', () => {
  it('inserts version 1 when chain is empty and url exists', () => {
    const next = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z', source: 'generate' },
    )
    expect(next.imageVersions).toHaveLength(1)
    expect(next.currentVersionId).toBe('v1')
    expect(next.imageVersions?.[0]).toMatchObject({
      url: 'https://cdn/a.png',
      source: 'generate',
      generationRecordId: 'g1',
    })
  })

  it('is a no-op when versions already exist', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const again = seedImageVersions(seeded, { id: 'v2', now: '2026-08-18T01:00:00.000Z' })
    expect(again.imageVersions).toHaveLength(1)
    expect(again.currentVersionId).toBe('v1')
  })
})

describe('appendEditVersion', () => {
  it('appends edit version and updates current url', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const next = appendEditVersion(seeded, {
      id: 'v2',
      url: 'https://cdn/b.png',
      createdAt: '2026-08-18T00:01:00.000Z',
      generationRecordId: 'g2',
      editPrompt: '去污渍',
    })
    expect(next.url).toBe('https://cdn/b.png')
    expect(next.currentVersionId).toBe('v2')
    expect(next.generationRecordId).toBe('g2')
    expect(next.imageVersions).toHaveLength(2)
    expect(next.imageVersions?.[1]).toMatchObject({
      source: 'edit',
      parentVersionId: 'v1',
      editPrompt: '去污渍',
    })
  })
})

describe('revertImageVersion', () => {
  it('restores url without deleting later versions', () => {
    const seeded = seedImageVersions(
      { url: 'https://cdn/a.png', generationRecordId: 'g1' },
      { id: 'v1', now: '2026-08-18T00:00:00.000Z' },
    )
    const edited = appendEditVersion(seeded, {
      id: 'v2',
      url: 'https://cdn/b.png',
      createdAt: '2026-08-18T00:01:00.000Z',
      generationRecordId: 'g2',
      editPrompt: '去污渍',
    })
    const reverted = revertImageVersion(edited, 'v1')
    expect(reverted.url).toBe('https://cdn/a.png')
    expect(reverted.currentVersionId).toBe('v1')
    expect(reverted.generationRecordId).toBe('g1')
    expect(reverted.imageVersions).toHaveLength(2)
    expect(currentImageVersion(reverted)?.id).toBe('v1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/canvas/imageVersions.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`packages/shared/src/canvas/imageVersions.ts`：按上面签名实现。`seedImageVersions` 在 `!url` 或已有 `imageVersions.length` 时原样返回。`revertImageVersion` 找不到 id 时原样返回。`currentImageVersion` 按 `currentVersionId` 查找，否则取最后一项。

`packages/shared/src/index.ts` 增加一行：`export * from './canvas/imageVersions'`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/canvas/imageVersions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/canvas/imageVersions.ts packages/shared/src/canvas/imageVersions.test.ts packages/shared/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add canvas image version-chain helpers

EOF
)"
```

---

### Task 2: 编辑 adapter（与生成隔离）

**Files:**
- Create: `packages/shared/src/imageEditProfiles.ts`
- Create: `packages/shared/src/imageEditProfiles.test.ts`
- Create: `packages/agent/src/studio/edit-adapter.ts`
- Create: `packages/agent/src/studio/edit-adapter.test.ts`
- Modify: `packages/shared/src/index.ts`（`export * from './imageEditProfiles'`）
- Modify: `packages/agent/src/index.ts`（导出 `buildImageEditRequest`、`buildEditPrompt`、`IMAGE_EDIT_PROMPT_PREFIX`）

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const P1_IMAGE_EDIT_MODEL_KEY = 'image2'`
  - `export const IMAGE_EDIT_GATEWAY_MODEL_ID = 'gpt-image-2-official'`
  - `export type ImageEditWire = 'apimart_mask'`
  - `export interface ImageEditModelProfile { editWire: ImageEditWire; gatewayModelId: string; responseMode: 'async_task'; size: 'auto'; pollIntervalMs: number; maxPollMs: number }`
  - `export function resolveImageEditProfile(modelKey?: string): ImageEditModelProfile`
  - `export const IMAGE_EDIT_PROMPT_PREFIX = '仅修改蒙版区域。蒙版以外的所有像素必须与原图完全一致。\n用户指令：'`
  - `export function buildEditPrompt(userPrompt: string): string`
  - `export function buildImageEditRequest(input: { userPrompt: string; imageUrl: string; maskUrl: string; modelKey?: string }): { prompt: string; body: Record<string, unknown>; meta: { editMode: 'inpaint'; modelKey: string; gatewayModelId: string; editWire: ImageEditWire; size: 'auto' } }`

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/imageEditProfiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  IMAGE_EDIT_GATEWAY_MODEL_ID,
  P1_IMAGE_EDIT_MODEL_KEY,
  resolveImageEditProfile,
} from './imageEditProfiles'

describe('resolveImageEditProfile', () => {
  it('returns Image2 apimart_mask profile for P1 key', () => {
    const p = resolveImageEditProfile(P1_IMAGE_EDIT_MODEL_KEY)
    expect(p.editWire).toBe('apimart_mask')
    expect(p.gatewayModelId).toBe(IMAGE_EDIT_GATEWAY_MODEL_ID)
    expect(p.responseMode).toBe('async_task')
    expect(p.size).toBe('auto')
    expect(p.pollIntervalMs).toBe(8000)
    expect(p.maxPollMs).toBe(360000)
  })
})
```

`packages/agent/src/studio/edit-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildImageRefConsistencyBlock } from './generation-adapter'
import { buildEditPrompt, buildImageEditRequest, IMAGE_EDIT_PROMPT_PREFIX } from './edit-adapter'

describe('buildImageEditRequest', () => {
  it('sends image_urls[0] + mask_url + auto size and prefixed prompt', () => {
    const built = buildImageEditRequest({
      userPrompt: '去除选区内的污渍',
      imageUrl: 'https://cdn/base.png',
      maskUrl: 'https://cdn/mask.png',
    })
    expect(built.body).toEqual({
      model: 'gpt-image-2-official',
      prompt: built.prompt,
      image_urls: ['https://cdn/base.png'],
      mask_url: 'https://cdn/mask.png',
      size: 'auto',
    })
    expect(built.prompt.startsWith(IMAGE_EDIT_PROMPT_PREFIX)).toBe(true)
    expect(built.prompt).toContain('去除选区内的污渍')
    expect(built.meta.editMode).toBe('inpaint')
    expect(JSON.stringify(built)).not.toContain('【参考图一致性】')
  })

  it('does not reuse generate consistency block', () => {
    const generateBlock = buildImageRefConsistencyBlock([
      { refKey: 'I1', url: 'https://cdn/a.png' },
    ])
    const edit = buildEditPrompt('换红色衣服')
    expect(edit).not.toContain(generateBlock.slice(0, 12))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter @lnkpi/shared exec vitest run src/imageEditProfiles.test.ts
pnpm --filter @lnkpi/agent exec vitest run src/studio/edit-adapter.test.ts
```
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`resolveImageEditProfile` P1 忽略未知 key，一律返回 Image2 profile（不在本轮做多模型）。

`buildEditPrompt`: `return IMAGE_EDIT_PROMPT_PREFIX + userPrompt.trim()`

`buildImageEditRequest`: 用 `resolveImageEditProfile` 填 `body.model` / `size: 'auto'`。

从 `@lnkpi/agent` 的 `generation-adapter.ts` **零改动**。

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/imageEditProfiles.ts packages/shared/src/imageEditProfiles.test.ts packages/shared/src/index.ts packages/agent/src/studio/edit-adapter.ts packages/agent/src/studio/edit-adapter.test.ts packages/agent/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add isolated image-edit adapter for inpaint

EOF
)"
```

---

### Task 3: EditProvider（独立 edit，复用 async 轮询形态）

**Files:**
- Create: `packages/agent/src/tools/image-edit-provider.ts`
- Create: `packages/agent/src/tools/image-edit-provider.test.ts`
- Modify: `packages/agent/src/index.ts`（导出 `createImageEditProvider`、`ImageEditProvider`、`ImageEditInput`）

**Interfaces:**
- Consumes: `buildImageEditRequest`（Task 2）
- Produces:
  - `export interface ImageEditInput { userPrompt: string; imageUrl: string; maskUrl: string; modelId?: string; pollIntervalMs?: number; maxPollMs?: number }`
  - `export interface ImageEditProvider { edit(input: ImageEditInput): Promise<{ url: string }> }`
  - `export function createImageEditProvider(opts?: { apiKey?: string; baseUrl?: string; model?: string }): ImageEditProvider`

**硬约束：** 不得给 `ImageProvider.generate()` 增加 `maskUrl` 或改其签名。轮询抽到 `packages/agent/src/tools/apimart-image-task.ts`（`extractApimartTaskId` / `extractApimartImageUrls` / `pollApimartImageTask`），`image-provider.ts` 与 `image-edit-provider.ts` **共用**该模块，禁止整段复制。

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createImageEditProvider } from './image-edit-provider'

describe('createImageEditProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts mask_url to /images/generations and returns completed url', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/images/generations') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        expect(body.mask_url).toBe('https://cdn/mask.png')
        expect(body.image_urls).toEqual(['https://cdn/base.png'])
        expect(body.size).toBe('auto')
        return new Response(JSON.stringify({ data: { task_id: 't1' } }), { status: 200 })
      }
      if (url.endsWith('/tasks/t1')) {
        return new Response(
          JSON.stringify({
            data: {
              status: 'completed',
              result: { images: [{ url: 'https://cdn/out.png' }] },
            },
          }),
          { status: 200 },
        )
      }
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const provider = createImageEditProvider({
      apiKey: 'k',
      baseUrl: 'https://api.apimart.ai/v1',
      model: 'gpt-image-2-official',
    })
    const out = await provider.edit({
      userPrompt: '去污渍',
      imageUrl: 'https://cdn/base.png',
      maskUrl: 'https://cdn/mask.png',
      pollIntervalMs: 1,
      maxPollMs: 1000,
    })
    expect(out.url).toBe('https://cdn/out.png')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/agent exec vitest run src/tools/image-edit-provider.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`ApimartImageEditProvider.edit`:
1. `built = buildImageEditRequest({ userPrompt, imageUrl, maskUrl })`
2. `POST ${baseUrl}/images/generations` body = `built.body`（可用 `input.modelId` 覆盖 `body.model`）
3. 取 `task_id`，轮询 `${baseUrl}/tasks/:id` 直到 `completed` 或 timeout
4. 返回 `{ url }`

无 apiKey 时 throw `'missing api key'`。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/tools/image-edit-provider.ts packages/agent/src/tools/image-edit-provider.test.ts packages/agent/src/index.ts
git commit -m "$(cat <<'EOF'
feat: add EditProvider for Image2 mask inpaint

EOF
)"
```

---

### Task 4: 服务端 mask 外合成

**Files:**
- Create: `apps/server/src/media/composite-unmasked.ts`
- Create: `apps/server/src/media/composite-unmasked.test.ts`

**Interfaces:**
- Produces:
  - `export class MaskDimensionMismatchError extends Error`
  - `export async function readImageBuffer(url: string): Promise<Buffer>`（本地 `/api/uploads/:userId/:file` 走磁盘，否则 fetch）
  - `export async function assertSameDimensions(base: Buffer, mask: Buffer, result?: Buffer): Promise<{ width: number; height: number }>`
  - `export async function compositeUnmaskedPixels(input: { base: Buffer; result: Buffer; mask: Buffer }): Promise<{ buffer: Buffer; width: number; height: number }>`

Mask 规则：灰度 &gt; 127 的像素视为可编辑（用结果图）；否则用底图。RGB 白 mask 与白 Alpha 都按此处理：对 mask `ensureAlpha` 后取 `max(luma, alpha)`。

- [ ] **Step 1: Write the failing tests**

用 sharp 造 2×2 PNG：底图全红、结果全蓝、mask 左白右黑。

```ts
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  MaskDimensionMismatchError,
  assertSameDimensions,
  compositeUnmaskedPixels,
} from './composite-unmasked'

async function png(data: Buffer, width: number, height: number) {
  return sharp(data, { raw: { width, height, channels: 3 } }).png().toBuffer()
}

describe('compositeUnmaskedPixels', () => {
  it('keeps base pixels outside mask and result pixels inside mask', async () => {
    const base = await png(Buffer.from([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]), 2, 2)
    const result = await png(Buffer.from([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255]), 2, 2)
    const mask = await png(Buffer.from([255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0]), 2, 2)
    const out = await compositeUnmaskedPixels({ base, result, mask })
    const raw = await sharp(out.buffer).removeAlpha().raw().toBuffer()
    expect([raw[0], raw[1], raw[2]]).toEqual([0, 0, 255])
    expect([raw[3], raw[4], raw[5]]).toEqual([255, 0, 0])
  })
})

describe('assertSameDimensions', () => {
  it('throws MaskDimensionMismatchError when mask size differs', async () => {
    const base = await png(Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2)
    const mask = await png(Buffer.from([0, 0, 0]), 1, 1)
    await expect(assertSameDimensions(base, mask)).rejects.toBeInstanceOf(MaskDimensionMismatchError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/media/composite-unmasked.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`readImageBuffer`：复用 `apps/server/src/media/upstream-ref-downscale.ts` 的本地 upload 解析（可从该文件 **导出** `readImageBuffer` 再 re-export，避免两套路径）。若导出改动面大，本文件内复制 `parseUploadRefPath` + `readFile` + fetch 即可。

合成：`raw({ channels: 4 })` 逐像素。不要在尺寸不一致时静默 resize。

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/media/composite-unmasked.ts apps/server/src/media/composite-unmasked.test.ts
git commit -m "$(cat <<'EOF'
feat: composite inpaint results to preserve unmasked pixels

EOF
)"
```

---

### Task 5: `POST /studio/image/edit`

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts`（DTO + route）
- Modify: `apps/server/src/studio/studio.service.ts`（`editImage`）
- Modify: `apps/server/src/studio/studio.module.ts`（`imports: [UploadModule]`）
- Modify: `apps/server/src/studio/studio.test-utils.ts` 以及所有自建 `StudioService` TestingModule 的测试，补 `UploadService` mock（`saveUserFile`）
- Create: `apps/server/src/studio/studio.edit-image.test.ts`
- Modify: `apps/web/src/services/studio-api.ts`（`editImage` 客户端）

**Interfaces:**
- Consumes: `createImageEditProvider`、`buildImageEditRequest`、`inlineUpstreamReferenceImages`、`compositeUnmaskedPixels`、`assertSameDimensions`、`readImageBuffer`、`UploadService.saveUserFile`、`P1_IMAGE_EDIT_MODEL_KEY`
- Produces:
  - `StudioService.editImage(userId, input, cancel?: CancelFlag): Promise<GenerationRecord>`
  - `input = { prompt: string; imageUrl: string; maskUrl: string; sessionId?: string; nodeId?: string; parentRecordId?: string; parentVersionId?: string }`
  - HTTP: `POST /studio/image/edit` AuthGuard，body 同上（`prompt`/`imageUrl`/`maskUrl` 必填）
  - Record: `type: 'image_edit'`，成功 `url` = **合成后** URL，metadata 含 `editMode:'inpaint'`、`composited:true`、`baseImageUrl`、`maskUrl`、`parentRecordId`、`parentVersionId`、`chargeReason:'图像精修'`
  - 客户端：`studioApi.editImage(body, signal?)`

**顺序（必须）：** 先下载底图+mask 并 `assertSameDimensions` → 失败则 **400 且不扣积分** → 再 `points.consume(10, '图像精修')` → create generating record → inline urls → `EditProvider.edit` → 下载结果 → composite → `saveUserFile` → completed。provider/合成失败：refund + `status:'failed'`。`cancel?.isCancelled()` 在 await 点检查，取消则 refund。

P1 **强制** `resolver.resolveForGeneration(userId, 'image2', 'image')`，忽略客户端模型。

- [ ] **Step 1: Write the failing test**

在 `studio.edit-image.test.ts` 用与 `studio.fallback.test.ts` 相同的 Nest TestingModule 风格。mock：

```ts
vi.mock('@lnkpi/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lnkpi/agent')>()
  return {
    ...actual,
    createImageEditProvider: vi.fn(() => ({ edit: imageEdit })),
  }
})
vi.mock('../media/composite-unmasked', () => ({
  MaskDimensionMismatchError: class MaskDimensionMismatchError extends Error {},
  readImageBuffer: vi.fn(),
  assertSameDimensions: vi.fn(),
  compositeUnmaskedPixels: vi.fn(),
}))
```

用例：
1. mask 尺寸失败：`assertSameDimensions` throw `MaskDimensionMismatchError` → `BadRequestException`，`pointsConsume` **0 次**
2. 成功：edit 返回上游 url，composite 返回 buffer，`saveUserFile` 返回合成 url；record `type === 'image_edit'`，`url` 为合成 url，`JSON.parse(metadata).composited === true`
3. provider throw：`pointsRefund` 被调用，record `failed`

`StudioService` 构造注入 `UploadService`。测试一律 `useValue: { saveUserFile: vi.fn(async () => ({ url: 'https://cdn/comp.png' })) }`。缺该 provider 会导致现有 studio 测试启动失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.edit-image.test.ts`
Expected: FAIL（`editImage` 不存在）

- [ ] **Step 3: Implement DTO, service, controller, client**

Controller DTO：

```ts
class ImageEditDto extends CanvasScopeFields {
  @IsString() prompt!: string
  @IsString() imageUrl!: string
  @IsString() maskUrl!: string
  @IsOptional() @IsString() parentRecordId?: string
  @IsOptional() @IsString() parentVersionId?: string
}
```

`studio-api.ts` 增加：

```ts
editImage: (
  body: {
    prompt: string
    imageUrl: string
    maskUrl: string
    parentRecordId?: string
    parentVersionId?: string
  } & CanvasGenerationScope,
  signal?: AbortSignal,
) =>
  api.post<{ data: GenerationRecord }>(
    '/studio/image/edit',
    { ...body, ...scopeBody({ sessionId: body.sessionId, nodeId: body.nodeId }) },
    { timeout: 300_000, signal },
  ),
```

注意 `scopeBody` 不要把 prompt 字段重复拆错。参照 `generateImageVariation` 写法。

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.edit-image.test.ts src/studio/studio.fallback.test.ts src/studio/studio.integration.test.ts
```
Expected: PASS（旧测试不因 UploadService 注入而挂）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.controller.ts apps/server/src/studio/studio.module.ts apps/server/src/studio/studio.edit-image.test.ts apps/server/src/studio/studio.test-utils.ts apps/web/src/services/studio-api.ts
git commit -m "$(cat <<'EOF'
feat: add studio image edit endpoint with composited output

EOF
)"
```

若 `studio.test-utils.ts` 以外的测试文件也要补 `UploadService`，一并加入本次 commit。

---

### Task 6: mask 覆盖率 + 精修会话规则

**Files:**
- Create: `apps/web/src/utils/maskCoverage.ts`
- Create: `apps/web/src/utils/maskCoverage.test.ts`
- Create: `apps/web/src/utils/refineSession.ts`
- Create: `apps/web/src/utils/refineSession.test.ts`

**Interfaces:**
- Produces:
  - `export const MIN_MASK_COVERAGE = 0.003`
  - `export const FULL_MASK_HINT_COVERAGE = 0.97`
  - `export function maskCoverageRatio(alphaOrLuma: Uint8ClampedArray | Uint8Array, pixelCount: number): number` — `pixelCount` 为像素数；数组按每像素 1 通道，值 &gt; 127 计为选中
  - `export function maskCoverageMessage(ratio: number): 'empty' | 'full' | 'ok'`
  - `export type RefineDismissDecision = 'keep' | 'dismiss' | 'block'`
  - `export function decideRefineDismiss(input: { busy: boolean; targetNodeId: string | null; selectedNodeId: string | null }): RefineDismissDecision`
  - `export const STAIN_PRESET_PROMPT = '去除选区内的污渍、瑕疵、多余物体，其余像素保持不变'`
  - `export const CX_IMAGE_EDIT_ENABLED = true`

规则：
- `busy && selectedNodeId !== targetNodeId` → `block`（含 `selectedNodeId === null`）
- `!busy && selectedNodeId !== targetNodeId` → `dismiss`
- `selectedNodeId === targetNodeId` → `keep`

- [ ] **Step 1: Write the failing tests**

覆盖率：10 像素里 0 个选中 → `empty`；10 里 1 个 → `ok`（0.1 &gt; 0.003）；10 里 10 个 → `full`。

`decideRefineDismiss`：busy 时换节点 = block；idle 换节点 = dismiss；同节点 = keep。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/maskCoverage.test.ts src/utils/refineSession.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests to verify they pass**

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/maskCoverage.ts apps/web/src/utils/maskCoverage.test.ts apps/web/src/utils/refineSession.ts apps/web/src/utils/refineSession.test.ts
git commit -m "$(cat <<'EOF'
feat: add refine mask coverage and dismiss rules

EOF
)"
```

---

### Task 7: 精修工作台 UI（Mask / Compare / Versions / Dock）

**Files:**
- Create: `apps/web/src/components/canvas/refine/MaskEditor.vue`
- Create: `apps/web/src/components/canvas/refine/CompareView.vue`
- Create: `apps/web/src/components/canvas/refine/VersionStrip.vue`
- Create: `apps/web/src/components/canvas/refine/RefineDockPanel.vue`
- Create: `apps/web/src/components/canvas/refine/maskExport.ts`
- Create: `apps/web/src/components/canvas/refine/maskExport.test.ts`

**Interfaces:**
- Consumes: `maskCoverageRatio`、`maskCoverageMessage`、`STAIN_PRESET_PROMPT`、`ImageVersionEntry`、`estimateImageCredits(1)`（10 分）
- Produces:
  - `RefineDockPanel` emits: `close`、`apply` `{ url: string; prompt: string; recordId?: string }`、`revert` `{ versionId: string }`、`busy` `boolean`
  - `maskExport.ts`: `export function exportMaskPng(canvas: HTMLCanvasElement): Promise<Blob>`；`export async function loadImageElement(url: string): Promise<HTMLImageElement>`（测试可跳过真实网络，只测 `countMaskPixelsFromImageData`）
  - `export function countMaskPixelsFromImageData(data: ImageData): { ratio: number; width: number; height: number }` — 用 alpha 或 luma &gt; 127

**UI 必须包含（文案锁定）：**
- 标题「精修」
- 左 Before / 右 After
- 按住按钮「原图」（`mousedown`/`mouseup`/`mouseleave`；另绑空格 `keydown`/`keyup`）
- 工具：画笔 / 橡皮 / 矩形、笔刷大小、清除选区
- 芯片「去除污渍瑕疵」（写入 `STAIN_PRESET_PROMPT`）、「替换选区内容」（focus textarea）
- textarea placeholder「改这里：……」
- 主按钮「精修」（无选区或 `empty` 时 disabled，并显示「请先圈选要改的区域」）
- `full` 时提示「这会改整张图，更像重新生成；可用底部生成栏」
- 「应用到节点」仅当 `afterUrl && afterUrl !== beforeUrl`
- 「返回生成」→ emit `close`；`busy` 时该按钮文案为「取消精修」且不 emit close 到切生成，而是 abort 请求
- 版本条最多 8 个缩略图；点选只改 Before 对照；「恢复此版本」才 emit `revert`

Mask canvas：内部 bitmap 宽高 = 底图 `naturalWidth/Height`（来自 props `width`/`height`，缺省则 `studioApi.probeMedia(url)`）。导出 PNG 必须是该像素尺寸，不得用 CSS 缩放尺寸。

`busy===true` 时禁用工具与返回生成（取消精修除外）。

- [ ] **Step 1: Write failing `maskExport` test**

```ts
import { describe, expect, it } from 'vitest'
import { countMaskPixelsFromImageData } from './maskExport'

describe('countMaskPixelsFromImageData', () => {
  it('reports coverage from alpha channel', () => {
    const data = new ImageData(2, 1)
    data.data.set([0, 0, 0, 0, 255, 255, 255, 255])
    const { ratio, width, height } = countMaskPixelsFromImageData(data)
    expect(width).toBe(2)
    expect(height).toBe(1)
    expect(ratio).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run to verify fail, then implement `maskExport.ts`**

Run: `pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskExport.test.ts`

- [ ] **Step 3: Implement the four Vue components**

`RefineDockPanel.vue` 流程：
1. props: `nodeId`, `beforeUrl`, `versions: ImageVersionEntry[]`, `currentVersionId`, `sessionId`, `generationRecordId?`, `width?`, `height?`
2. 「精修」click：`exportMaskPng` → `persistMediaUrl(file)` → `studioApi.editImage({ prompt, imageUrl: beforeUrl, maskUrl, sessionId, nodeId, parentRecordId: generationRecordId, parentVersionId: currentVersionId }, abort.signal)` → 把返回 `data.url` 设为 `afterUrl`
3. AbortController 存于组件；取消精修 `abort()`
4. 错误条展示 API / 上传失败，可重试

CompareView：`showingOriginal` 为 true 时右栏显示 `beforeUrl`。

不要引入 `ImageParamsSelector`。不要调用 `generateImageVariation`。

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskExport.test.ts
pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false
```
Expected: PASS / 无新文件 type error

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine
git commit -m "$(cat <<'EOF'
feat: add refine dock workbench UI

EOF
)"
```

---

### Task 8: 画布接入：显式入口、Dock 切换、写回、拆掉旧弹窗

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`（增加 `refineBusy`）
- Modify: `apps/web/src/pages/CanvasPage.vue`
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue`（`openEdit` 仍 `openImageEditor`，但受 `CX_IMAGE_EDIT_ENABLED` 控制）
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`（image + 有 url 的 mediaInput 可显示；flag 关闭则隐藏）
- Modify: `apps/web/src/components/canvas/dock-studio/DockStudioToolbar.vue` 或 `CanvasPage.vue`（精修打开时渲染 `RefineDockPanel` 而不是生成 Dock）
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` 若只需 CanvasPage 的 `handleAgentOpenImageEditor`（已存在）
- Delete: `apps/web/src/components/canvas/AIImageEditor.vue`
- Create: `apps/web/src/stores/canvasEditor.refine.test.ts`（或 `apps/web/src/utils/refineSession` 已覆盖 dismiss；本任务补 store：`openImageEditor` 不在「仅构造 store」时自动有 target）

**Interfaces:**
- Consumes: `seedImageVersions`、`appendEditVersion`、`revertImageVersion`、`decideRefineDismiss`、`CX_IMAGE_EDIT_ENABLED`、`RefineDockPanel`
- 打开精修必须：`selectOnlyNode(nodeId)` → `seedImageVersions` patch 到节点 data（仅当链为空）→ `openImageEditor({ nodeId, url })`
- 选中变化 / `onPaneClick`：`decideRefineDismiss({ busy: refineBusy, targetNodeId: imageTarget?.nodeId ?? null, selectedNodeId })`  
  - `block`：恢复选中 `imageTarget.nodeId`，不关精修  
  - `dismiss`：`closeImageEditor()`，丢弃未应用预览  
  - `keep`：不动
- `handleRefineApply`：`appendEditVersion` 写回 **同一 nodeId** 的 `url` / `currentVersionId` / `imageVersions` / `generationRecordId`；`persistUserEdit()`；**不** `addNodes`
- `handleRefineRevert`：`revertImageVersion` 后 patch 同一节点
- 删除 `<AIImageEditor>`；`handleImageEditorApply` 改为走版本链或删除后由 Refine emit `apply` 替代
- `handleAgentOpenImageEditor`：无 url 则 return；有 url 则走与按钮相同的 `openRefineForNode`

**硬约束：** `onNodeClick` / `selectOnlyNode` **不得**调用 `openImageEditor`。

- [ ] **Step 1: Write failing store test**

```ts
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import { useCanvasEditorStore } from './canvasEditor'

describe('canvasEditor refine target', () => {
  it('starts closed and only opens via openImageEditor', () => {
    setActivePinia(createPinia())
    const editor = useCanvasEditorStore()
    expect(editor.imageTarget).toBeNull()
    editor.openImageEditor({ nodeId: 'n1', url: 'https://cdn/a.png' })
    expect(editor.imageTarget?.nodeId).toBe('n1')
    editor.closeImageEditor()
    expect(editor.imageTarget).toBeNull()
  })
})
```

若现有 store 已满足，此测试会直接绿——允许。再补 `refineBusy` 的 set/get。

- [ ] **Step 2: Implement store `refineBusy`**

```ts
const refineBusy = ref(false)
function setRefineBusy(value: boolean) {
  refineBusy.value = value
}
```

`closeImageEditor` 时若 `refineBusy` 为 true，**不要**清空 target（由 UI 取消任务后再关）。或 close 只在 `!refineBusy` 时生效；busy 时 no-op。与 `decideRefineDismiss` 的 `block` 对齐。

- [ ] **Step 3: Wire CanvasPage**

模板底部（现 `DockStudioToolbar` 旁）：

```vue
<RefineDockPanel
  v-if="refinePanelNode"
  :node-id="refinePanelNode.id"
  :before-url="refineBeforeUrl"
  :versions="refineVersions"
  :current-version-id="refineCurrentVersionId"
  :session-id="sessionId"
  :generation-record-id="refineGenerationRecordId"
  :width="refineMediaWidth"
  :height="refineMediaHeight"
  @close="closeRefineWorkbench"
  @apply="handleRefineApply"
  @revert="handleRefineRevert"
  @busy="canvasEditor.setRefineBusy"
/>
<DockStudioToolbar
  v-else
  ...existing bindings...
  @refine="openRefineForSelected"
/>
```

`refinePanelNode` = `imageTarget` 对应节点且 flag 开启。

`watch(selectedNodeId, ...)` 调用 `decideRefineDismiss`。

`onPaneClick` 开头：若 decision 为 `block` 则 `return`。

实现 `openRefineForNode(node)` 供按钮、右键、Agent、Dock 次入口复用。

- [ ] **Step 4: Delete `AIImageEditor.vue` and all imports**

全局搜 `AIImageEditor` / `generateImageVariation` 的**画布**调用，画布侧必须清掉。`studioApi.generateImageVariation` 可留在 api 模块。

- [ ] **Step 5: Run tests**

```bash
pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts src/utils/refineSession.test.ts src/utils/maskCoverage.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts apps/web/src/pages/CanvasPage.vue apps/web/src/components/canvas/CanvasNodeImage.vue apps/web/src/components/canvas/CanvasContextMenu.vue apps/web/src/components/canvas/dock-studio/DockStudioToolbar.vue apps/web/src/components/canvas/AIImageEditor.vue
git commit -m "$(cat <<'EOF'
feat: wire refine dock and replace whole-image editor dialog

EOF
)"
```

---

### Task 9: 生成 Dock 次入口「精修这张图」

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/DockStudioRouter.vue`（增加 `refine` emit）
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`
- Modify: `apps/web/src/components/canvas/DockStudioToolbar.vue`（转发 `@refine`）
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`（`mediaInput` + 图片 url：菜单项「编辑图像」）

**Interfaces:**
- ImageDockPanel：当 `node.data.url` 有值且 `!readonly` 且 `CX_IMAGE_EDIT_ENABLED` 时，在 `DockGenerateButton` **左侧**显示文字按钮「精修这张图」，`@click="emit('refine')"`
- **不要**做成 Tab，不要默认选中
- 无 url：不渲染该按钮（不是 disabled 空按钮）
- `ImageDockPanel` / `ImageParamsSelector` 仍然零 mask

- [ ] **Step 1: Write a small component test**（Vue Test Utils 挂 `ImageDockPanel` 过重则测纯函数）

在 `maskCoverage.ts` 已有 flag。本任务在 `ImageDockPanel` 旁加：

Create `apps/web/src/components/canvas/dock-studio/panels/imageDockRefineEntry.ts`：

```ts
export function shouldShowRefineEntry(input: { url?: unknown; readonly: boolean; enabled: boolean }) {
  return input.enabled && !input.readonly && String(input.url ?? '').trim().length > 0
}
```

测试：有 url + enabled + not readonly → true；生成中 readonly → false。

- [ ] **Step 2: Run fail, implement helper + button**

- [ ] **Step 3: Forward emit `refine` through Router → Toolbar → CanvasPage `openRefineForNode(editorNode)`**

- [ ] **Step 4: Context menu for mediaInput**

`CanvasContextMenu` 的「编辑图像」`v-if` 改为 `nodeType === 'image' || nodeType === 'mediaInput'`。`handleContextAction('edit-image')`：节点无 `data.url` 则直接 return，不打开工作台。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/dock-studio apps/web/src/components/canvas/DockStudioToolbar.vue apps/web/src/components/canvas/CanvasContextMenu.vue
git commit -m "$(cat <<'EOF'
feat: add studio dock secondary entry for refine

EOF
)"
```

---

### Task 10: Agent capabilities 对齐全量 inpaint

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`（`getImageEditCapabilities`）
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`

**Interfaces:**
- Consumes: 现有 `getNode`
- Produces: `supportedModes: canEdit ? ['inpaint'] : []`  
  `canEdit` = (`image` | `mediaInput`) 且 `url` 非空  
  **不得**再返回 `crop` / `outpaint` / `remove_bg`

- [ ] **Step 1: Write failing tests**（替换现有 `toContain('inpaint')` 为精确相等）

```ts
it('getImageEditCapabilities reports only inpaint when image has url', async () => {
  canvas = {
    nodes: [
      {
        id: 'img-1',
        type: 'image',
        position: { x: 0, y: 0 },
        data: { url: 'https://x/a.png' },
      },
    ],
    edges: [],
  }
  const caps = await svc.getImageEditCapabilities({ sessionId: 's1', nodeId: 'img-1' })
  expect(caps.canEdit).toBe(true)
  expect(caps.supportedModes).toEqual(['inpaint'])
})

it('getImageEditCapabilities is empty without url', async () => {
  canvas = {
    nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
    edges: [],
  }
  const caps = await svc.getImageEditCapabilities({ sessionId: 's1', nodeId: 'img-1' })
  expect(caps.canEdit).toBe(false)
  expect(caps.supportedModes).toEqual([])
})
```

- [ ] **Step 2: Run to verify current implementation fails the exact `toEqual(['inpaint'])` if it still returns four modes**

Run: `pnpm --filter @lnkpi/server exec vitest run src/agent/agent-canvas-tools.service.test.ts`

- [ ] **Step 3: Change `supportedModes` line only**

现有：
```ts
supportedModes: canEdit ? ['crop', 'inpaint', 'outpaint', 'remove_bg'] : [],
```
改为：
```ts
supportedModes: canEdit ? ['inpaint'] : [],
```

- [ ] **Step 4: Confirm `open_image_editor` 仍只发 canvasCommand；CanvasPage 已打开精修工作台。不改 `run_icon_refine`。**

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.ts apps/server/src/agent/agent-canvas-tools.service.test.ts
git commit -m "$(cat <<'EOF'
fix: report only implemented inpaint image-edit capability

EOF
)"
```

---

### Task 11: 全量验证与 spec 状态

**Files:**
- Modify: `docs/superpowers/specs/2026-08-18-cx-image-edit-design.md`（Status → `Approved, plan in 2026-08-18-cx-image-edit.md`）

- [ ] **Step 1: Run verification**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/server exec vitest run src/media/composite-unmasked.test.ts src/studio/studio.edit-image.test.ts src/agent/agent-canvas-tools.service.test.ts
pnpm --filter @lnkpi/web exec vitest run src/utils/maskCoverage.test.ts src/utils/refineSession.test.ts src/components/canvas/refine/maskExport.test.ts src/stores/canvasEditor.refine.test.ts
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
```

Expected: 全绿。

- [ ] **Step 2: Manual checklist（开发者本地画布）**

1. 选中已有图图片节点 → 只有生成 Dock，无精修工作台  
2. 点「编辑图像」或「精修这张图」→ 精修工作台替换底部栏  
3. 不画 mask 点精修 → 被拦截、不扣积分  
4. 画 mask + 去除污渍 → After 更新；应用到节点后同一节点 url 变、无新节点、版本条可回 N  
5. 精修进行中点其他节点 → 选中被挡回  
6. Agent `open_image_editor` → 打开精修而非旧弹窗  

- [ ] **Step 3: Commit spec status if changed**

```bash
git add docs/superpowers/specs/2026-08-18-cx-image-edit-design.md
git commit -m "$(cat <<'EOF'
docs: point cx-image-edit spec at implementation plan

EOF
)"
```

---

## Spec coverage（self-review）

| Spec 项 | Task |
|---------|------|
| A+B 同一 UX（mask+指令、污渍芯片） | 7 |
| 同节点版本链 / 回退 | 1, 8 |
| 左右对照 + 按住原图 | 7 |
| 方案 2 Dock；选中不打开精修 | 8 |
| 四处显式入口 | 8, 9 |
| 关闭/切走/进行中 block | 6, 8 |
| 不进图像工作室 | 全局 / 无任务（不改 ImageStudioPage） |
| EditProvider 隔离、不用 generate mask | 2, 3 |
| 服务端合成 | 4, 5 |
| 10 积分 | 5, 7 |
| 替换 AIImageEditor | 8 |
| capabilities 仅 inpaint | 10 |
| `run_icon_refine` 不动 | 10 |
| 全图 mask 提示 | 7 |
| feature flag `CX_IMAGE_EDIT_ENABLED` | 6, 8, 9 |

无 P2 智能选区 / Wipe / 工作室精修 / Prisma 新表。
