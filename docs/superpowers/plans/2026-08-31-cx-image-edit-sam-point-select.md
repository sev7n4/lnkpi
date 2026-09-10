# 精修 SAM 点击选主体 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精修选区链增加「点选」：单击工作图 → `POST /studio/image/segment`（fal SAM3）→ 按 `refineMaskOp` 并入/挖除 mask；点选不扣分。

**Architecture:** `packages/agent` 新增 `SegmentProvider`（fal HTTP）。`StudioService.segmentImage` 鉴权、inline 图 URL、限流、调 provider、返回 `maskUrl`。前端 `refineTool: 'point'` + MaskEditor 单击拉 mask PNG 栅格合并。密钥仅服务端 `FAL_KEY`。

**Tech Stack:** NestJS、Vitest、Vue 3、现有 MaskEditor / canvasEditor、fal `fal-ai/sam-3/image`（`fetch`，不强制 `@fal-ai/client`）

**Spec:** `docs/superpowers/specs/2026-08-31-cx-image-edit-sam-point-select-design.md`

## Global Constraints

- 远端分割：**fal.ai** `fal-ai/sam-3/image`；CVM **不**跑 SAM
- 点选 **不扣分**、**不**创建 GenerationRecord
- 点「点选」**只换工具不改** `refineMaskOp`；加选并入、减选挖除
- **每次单击一次**请求；MVP 仅 `label: 1`
- 密钥不出浏览器；禁止改 `ImageProvider.generate` / 抠图 / 文本指代 / P4
- TDD；提交前缀 `feat:` / `fix:` / `test:` / `docs:`
- 不 `git add -A`；勿提交 `.seedream-backup`、`deploy/`、`q.js`、`.superpowers/sdd/*`

## File map

| File | Responsibility |
|------|----------------|
| `packages/agent/src/tools/segment-provider.ts` | fal segment HTTP + `createSegmentProvider` |
| `packages/agent/src/tools/segment-provider.test.ts` | 请求体映射 / 单 mask 选取 |
| `packages/agent/src/index.ts` | 导出 |
| `apps/server/src/studio/studio.controller.ts` | `POST image/segment` + DTO |
| `apps/server/src/studio/studio.service.ts` | `segmentImage`：inline、限流、调 provider |
| `apps/server/src/studio/studio.segment.test.ts` | 服务层单测 |
| `apps/web/src/services/studio-api.ts` | `segmentImage` 客户端 |
| `apps/web/src/stores/canvasEditor.ts` | `RefineMaskTool` 含 `'point'`；`setRefineTool` 不改 op |
| `apps/web/src/stores/canvasEditor.refine.test.ts` | point 保持 op |
| `apps/web/src/components/canvas/refine/maskRemote.ts` | PNG → RGBA 并入/挖除纯函数辅助（可测部分） |
| `apps/web/src/components/canvas/refine/maskRemote.test.ts` | 合并逻辑 |
| `apps/web/src/components/canvas/refine/MaskEditor.vue` | point 单击 → emit 请求坐标 |
| `apps/web/src/components/canvas/refine/RefineWorkViewport.vue` | 透传 props/events |
| `apps/web/src/components/canvas/refine/RefineSidePanel.vue` | 点选按钮 + 调 API + 写 mask |

---

### Task 0: Feature 分支

- [ ] **Step 1:** 从含 SAM design 的 docs 分支切 feature 分支。

```bash
git fetch origin
git checkout docs/cx-image-edit-sam-point-select
git pull origin docs/cx-image-edit-sam-point-select 2>/dev/null || true
git checkout -b feature/cx-image-edit-sam-point-select
```

若 docs 仅本地：`git checkout -b feature/cx-image-edit-sam-point-select docs/cx-image-edit-sam-point-select`

- [ ] **Step 2: 基线**

```bash
pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts
pnpm --filter @lnkpi/agent exec vitest run src/studio/edit-adapter.test.ts
```

Expected: PASS

---

### Task 1: `mergeMaskRgba` 纯函数（远端 mask 并入/挖除）

**Files:**
- Create: `apps/web/src/components/canvas/refine/maskRemote.ts`
- Create: `apps/web/src/components/canvas/refine/maskRemote.test.ts`

**Interfaces:**
- Produces:
  - `mergeMaskRgba(opts: { width; height; baseMaskRgba: Uint8ClampedArray; remoteMaskRgba: Uint8ClampedArray; fillRgb: [number, number, number]; mode: 'add' | 'subtract' }): Uint8ClampedArray`
  - 规则：`remote` 像素 **alpha > 127** 视为选中。`add`：选中处写 `fillRgb` + A=255；`subtract`：选中处 RGB=0 A=0。其它像素保持 `base`。

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { mergeMaskRgba } from './maskRemote'

function rgba(vals: number[]) {
  return new Uint8ClampedArray(vals)
}

describe('mergeMaskRgba', () => {
  it('add paints remote opaque pixels', () => {
    const base = rgba([0, 0, 0, 0, 0, 0, 0, 0])
    const remote = rgba([255, 255, 255, 255, 0, 0, 0, 0])
    const out = mergeMaskRgba({
      width: 2,
      height: 1,
      baseMaskRgba: base,
      remoteMaskRgba: remote,
      fillRgb: [9, 9, 9],
      mode: 'add',
    })
    expect([...out.slice(0, 4)]).toEqual([9, 9, 9, 255])
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })

  it('subtract clears remote opaque pixels', () => {
    const base = rgba([9, 9, 9, 255, 9, 9, 9, 255])
    const remote = rgba([255, 255, 255, 200, 0, 0, 0, 0])
    const out = mergeMaskRgba({
      width: 2,
      height: 1,
      baseMaskRgba: base,
      remoteMaskRgba: remote,
      fillRgb: [9, 9, 9],
      mode: 'subtract',
    })
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([9, 9, 9, 255])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/refine/maskRemote.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement**

```ts
export function mergeMaskRgba(opts: {
  width: number
  height: number
  baseMaskRgba: Uint8ClampedArray
  remoteMaskRgba: Uint8ClampedArray
  fillRgb: [number, number, number]
  mode: 'add' | 'subtract'
}): Uint8ClampedArray {
  const n = opts.width * opts.height * 4
  const out = new Uint8ClampedArray(opts.baseMaskRgba)
  const [fr, fg, fb] = opts.fillRgb
  for (let i = 0; i < n; i += 4) {
    if (opts.remoteMaskRgba[i + 3]! <= 127) continue
    if (opts.mode === 'subtract') {
      out[i] = 0
      out[i + 1] = 0
      out[i + 2] = 0
      out[i + 3] = 0
    } else {
      out[i] = fr
      out[i + 1] = fg
      out[i + 2] = fb
      out[i + 3] = 255
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/refine/maskRemote.ts apps/web/src/components/canvas/refine/maskRemote.test.ts
git commit -m "feat(web): merge remote SAM mask into refine canvas"
```

---

### Task 2: `SegmentProvider`（fal）

**Files:**
- Create: `packages/agent/src/tools/segment-provider.ts`
- Create: `packages/agent/src/tools/segment-provider.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces:
  - `SegmentPointInput = { imageUrl: string; x: number; y: number; label?: 0 | 1 }`
  - `SegmentProvider = { segment(input: SegmentPointInput): Promise<{ maskUrl: string }> }`
  - `createSegmentProvider(opts: { apiKey: string; falModel?: string }): SegmentProvider`
  - 默认 model：`fal-ai/sam-3/image`
  - HTTP：`POST https://fal.run/${model}`，Header `Authorization: Key ${apiKey}`，Body：
    ```json
    {
      "image_url": "...",
      "point_prompts": [{ "x": 10, "y": 20, "label": 1 }],
      "return_multiple_masks": false,
      "apply_mask": false,
      "output_format": "png"
    }
    ```
  - 从 JSON 取 `masks[0].url`（或 `image.url` 回退）；缺失则 throw

- [ ] **Step 1: Failing test**（mock `global.fetch`）

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createSegmentProvider } from './segment-provider'

describe('createSegmentProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts point prompt to fal.run and returns masks[0].url', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        masks: [{ url: 'https://fal.media/mask.png' }],
      }),
    } as Response)
    const provider = createSegmentProvider({ apiKey: 'fal-test' })
    const out = await provider.segment({ imageUrl: 'https://cdn/a.png', x: 12, y: 34, label: 1 })
    expect(out.maskUrl).toBe('https://fal.media/mask.png')
    expect(fetch).toHaveBeenCalledWith(
      'https://fal.run/fal-ai/sam-3/image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Key fal-test' }),
      }),
    )
    const body = JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body))
    expect(body.point_prompts).toEqual([{ x: 12, y: 34, label: 1 }])
    expect(body.image_url).toBe('https://cdn/a.png')
  })
})
```

- [ ] **Step 2: RED** → **Step 3: implement** → **Step 4: GREEN**

```bash
pnpm --filter @lnkpi/agent exec vitest run src/tools/segment-provider.test.ts
```

- [ ] **Step 5: Export from `index.ts`** + commit

```bash
git add packages/agent/src/tools/segment-provider.ts packages/agent/src/tools/segment-provider.test.ts packages/agent/src/index.ts
git commit -m "feat(agent): fal SegmentProvider for point prompts"
```

---

### Task 3: Studio `POST /studio/image/segment`

**Files:**
- Modify: `apps/server/src/studio/studio.controller.ts`（DTO + route，紧挨 `image/edit`）
- Modify: `apps/server/src/studio/studio.service.ts`（`segmentImage`）
- Create: `apps/server/src/studio/studio.segment.test.ts`

**Interfaces:**
- DTO：`imageUrl: string; x: number; y: number; label?: 0 | 1`
- `StudioService.segmentImage(userId, input): Promise<{ maskUrl: string }>`
  - 校验 `imageUrl` 非空；`x`/`y` 为有限数且 ≥ 0
  - `inlineUpstreamReferenceImages([imageUrl])` 后取公网 URL
  - 读：`process.env.FAL_KEY`；缺失 → `ServiceUnavailableException('点选暂不可用')`
  - 简易限流：内存 `Map<userId, timestamps[]>`，窗口 60s 最多 **20** 次；超限 `HttpException` 429「点选过于频繁，请稍后再试」
  - `createSegmentProvider({ apiKey }).segment(...)`；**不** `points.consume`
  - label 默认 1

- [ ] **Step 1: Failing service test**（照 `studio.edit-image.test.ts` 的 Nest testing 模式 mock prisma/points/resolver；本测可不依赖 prisma）

最小测法：直接 `new StudioService(...)` 若构造过重，则测抽出的限流纯函数 + mock provider 注入。

推荐：在 `studio.service.ts` 旁或同文件可测的

```ts
export function allowSegmentRate(userId: string, now = Date.now(), windowMs = 60_000, max = 20): boolean
```

单测限流；另测 `segmentImage` 在无 `FAL_KEY` 时抛 ServiceUnavailable（可用 env 临时删除）。

更完整：mock `createSegmentProvider` via `vi.mock('@lnkpi/agent')` 与 edit 测试相同。

```ts
it('segmentImage returns maskUrl without charging points', async () => {
  process.env.FAL_KEY = 'k'
  // mock createSegmentProvider → { segment: async () => ({ maskUrl: 'https://m' }) }
  // mock inlineUpstreamReferenceImages → identity
  const points = { consume: vi.fn(), refund: vi.fn() }
  const out = await svc.segmentImage('u1', { imageUrl: 'https://a.png', x: 1, y: 2 })
  expect(out).toEqual({ maskUrl: 'https://m' })
  expect(points.consume).not.toHaveBeenCalled()
})
```

- [ ] **Step 2–4:** RED → 实现 controller + service → GREEN

Controller 片段：

```ts
@Post('image/segment')
@UseGuards(AuthGuard)
async segmentImage(@Req() req: { user: { sub: string } }, @Body() dto: ImageSegmentDto) {
  const data = await this.studioService.segmentImage(req.user.sub, {
    imageUrl: dto.imageUrl,
    x: dto.x,
    y: dto.y,
    label: dto.label,
  })
  return { code: 0, message: 'ok', data }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/studio.controller.ts apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.segment.test.ts
git commit -m "feat(server): POST /studio/image/segment via fal"
```

---

### Task 4: Store `point` 工具

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`
- Modify: `apps/web/src/stores/canvasEditor.refine.test.ts`

**Interfaces:**
- `RefineMaskTool` 增加 `'point'`
- `setRefineTool('point')`：**不**改 `refineMaskOp`（与 wand/polygon 相同分支）

- [ ] **Step 1: Extend test**

```ts
  it('keeps refineMaskOp when switching to point', () => {
    const editor = useCanvasEditorStore()
    editor.setRefineTool('eraser')
    expect(editor.refineMaskOp).toBe('subtract')
    editor.setRefineTool('point')
    expect(editor.refineTool).toBe('point')
    expect(editor.refineMaskOp).toBe('subtract')
  })
```

- [ ] **Step 2: RED**（若类型未含 point）→ **Step 3: 改类型与 setter** → GREEN

```ts
export type RefineMaskTool = 'brush' | 'eraser' | 'rect' | 'wand' | 'polygon' | 'point'
// setRefineTool: point 落入「不改 op」分支（与 wand/polygon）
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(web): refineTool point keeps mask op"
```

---

### Task 5: MaskEditor + SidePanel + studioApi 接线

**Files:**
- Modify: `apps/web/src/services/studio-api.ts` — `segmentImage`
- Modify: `apps/web/src/components/canvas/refine/MaskEditor.vue` — `tool: 'point'` 单击 `emit('pointSelect', { x, y })`；不涂抹
- Modify: `apps/web/src/components/canvas/refine/RefineWorkViewport.vue` — 透传
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue` — 按钮；处理 pointSelect：调 API、拉 PNG、`mergeMaskRgba`、写 canvas

**Interfaces:**
- `studioApi.segmentImage(body): Promise<{ data: { maskUrl: string } }>` → `POST /studio/image/segment`
- MaskEditor：`MaskTool` 含 `'point'`；`defineEmits` 增加 `pointSelect: [{ x: number; y: number }]`
- SidePanel：`segmentBusy` ref；成功/失败 ElMessage；用现有 mask canvas ref / `export` 路径的反向：`getImageData` → merge → `putImageData`

拉 PNG 栅格化辅助（可放 `maskRemote.ts`）：

```ts
export async function loadMaskRgbaFromUrl(
  url: string,
  width: number,
  height: number,
): Promise<Uint8ClampedArray> {
  const img = await createImageBitmap(await (await fetch(url)).blob())
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}
```

（若 jsdom 难测 `createImageBitmap`，该函数可不单测，只测 `mergeMaskRgba`。）

SidePanel 点选按钮：

```vue
<button
  type="button"
  class="refine-side__icon-btn"
  :class="{ 'is-active': editor.refineTool === 'point' }"
  :title="editor.refineMaskOp === 'subtract' ? '点选减选' : '点选主体'"
  :disabled="busy || segmentBusy"
  @click="editor.setRefineTool('point')"
>
  <!-- 简单 crosshair / 鼠标图标 SVG -->
</button>
```

- [ ] **Step 1:** 实现 studio-api + MaskEditor emit + SidePanel handler（可选手动测为主；可选 mount 测按钮 title）
- [ ] **Step 2:**

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/stores/canvasEditor.refine.test.ts \
  src/components/canvas/refine/maskRemote.test.ts
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/services/studio-api.ts \
  apps/web/src/components/canvas/refine/MaskEditor.vue \
  apps/web/src/components/canvas/refine/RefineWorkViewport.vue \
  apps/web/src/components/canvas/refine/RefineSidePanel.vue \
  apps/web/src/components/canvas/refine/maskRemote.ts
git commit -m "feat(web): wire SAM point select into refine side panel"
```

---

### Task 6: 验证 + 规格状态

- [ ] **Step 1: 测试**

```bash
pnpm --filter @lnkpi/agent exec vitest run src/tools/segment-provider.test.ts
pnpm --filter @lnkpi/server exec vitest run src/studio/studio.segment.test.ts
pnpm --filter @lnkpi/web exec vitest run \
  src/stores/canvasEditor.refine.test.ts \
  src/components/canvas/refine/maskRemote.test.ts
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
```

Expected: PASS

- [ ] **Step 2:** 更新 design Status → `Approved, plan in docs/superpowers/plans/2026-08-31-cx-image-edit-sam-point-select.md`

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-08-31-cx-image-edit-sam-point-select-design.md \
  docs/superpowers/plans/2026-08-31-cx-image-edit-sam-point-select.md
git commit -m "docs: link SAM point-select implementation plan"
```

**手动 UAT（有 `FAL_KEY` 的环境）**
1. 精修 → 点选 → 点主体 → mask 出现  
2. 橡皮 → 点选 → 挖除  
3. 积分仅在「精修」变化  
4. 断网 toast，mask 不变  

**部署注意：** 生产 / `.env` 配置 `FAL_KEY`；未配置时点选返回「点选暂不可用」。

---

## Spec coverage

| Spec | Task |
|------|------|
| fal SegmentProvider | 2 |
| POST /studio/image/segment，不扣分 | 3 |
| 限流 | 3 |
| inline 图 URL | 3 |
| refineTool point + 不改 op | 4 |
| 单击独立请求 + merge op | 1, 5 |
| 侧栏 title 减选 | 5 |
| 非目标未做 | Global Constraints |

## Manual note for B later

文本指代应复用 `SegmentProvider`，扩展 `prompt?: string` 调同一 fal 模型；本 plan 不实现。
