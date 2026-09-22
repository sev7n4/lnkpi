# 精修抠图 + 精修应用语义统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增抠图特性（CVM 自托管 rembg，rail 独立模式 + 浮层一键，免费出透明 PNG），并把所有精修工具与一键操作的「应用」语义统一为「连接下游新节点」，版本条全线退役。

**Architecture:** 服务端新增 `POST /api/studio/image/matting` 代理内网 rembg 容器；前端新增 `refine-matting` 注册表模式（MattingPanel/MattingDock）+ 选区本地合成纯函数；`CanvasPage` 的 `handleRefineApply` 重写为 `applyRefineAsChild`（addNode/addEdge 注入，仿 `runGridSlice`），`VersionStrip` 链路与 `handleRefineRevert` 删除，会话内结果改走 store 的 `refineSessionResults` 胶片条。

**Tech Stack:** Vue 3 `<script setup>` + TS + Pinia、NestJS + Prisma、Vitest/jsdom、Docker（python:3.11-slim + rembg[cpu]）。

**Spec:** `docs/superpowers/specs/2026-09-22-refine-matting-unified-apply-design.md`（执行者必须先读，本计划从它出发）

## Global Constraints

- 抠图**免费**：不查积分、不扣积分、不建 GenerationRecord（spec §3.3）。
- 应用语义唯一：**任何**精修工具/一键操作的「应用」= 新建下游节点 + 连边，原节点 data/position **绝不修改**（spec §1.1、图 1）。
- 幂等：同一结果重复应用 → 选中已有下游节点，不新建（spec §2.2，`appliedKey`）。
- matting 端点错误契约：未配置 `MATTING_SERVICE_URL` → 503；rembg 失败/超时 30s → 502；图片 >20MB 或 >4096px → 400（spec §3.3/§5）。
- 会话胶片条：最多 8 张，超出挤掉最旧；退出精修即清空（spec §2.4）。
- shared 的 `appendEditVersion` / `revertImageVersion` / `ImageVersionEntry` **类型保留不删**，仅精修链路不再调用（spec §2.3）。
- 新 worktree 依赖：`pnpm install --frozen-lockfile`（约 20s）；web/server 两套 vitest **串行**跑，不并行。
- 提交规范：feature 分支 + PR；回归测试必须在修复前实现上确认会红。

## Review Focus

1. **原节点被意外写入**：任何 apply 路径若 `patchNodeData(源节点, {url...})` 残留即回归——期望原图 url/position 恒不变。→ Task 9 测试 `不修改源节点`。
2. **重复应用铺一排重复节点**：连点「应用」两次。→ Task 8 测试 `appliedKey 幂等`。
3. **rembg 超时/未配置把前端搞挂**：503/502 必须是可恢复 toast，面板不崩。→ Task 1 契约测试 + Task 7 禁用态。
4. **会话结果跨节点泄漏**：换一张图进精修，上一张的结果不能出现在胶片条。→ Task 5 测试 `换图清空`。
5. **透明 PNG 在深色画布上不可辨**：预览必须叠棋盘格。→ Task 7 测试 `棋盘格样式存在` + 浏览器验收。

---

### Task 1: 服务端 matting 端点（契约 + rembg 客户端）

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`（新增 `mattingImage` 方法，仿 `segmentImage` @1558）
- Modify: `apps/server/src/studio/studio.controller.ts`（新增 `@Post('image/matting')`，仿 @405）
- Test: `apps/server/src/studio/studio.matting.test.ts`（新建，仿 `studio.segment.test.ts`）

**Interfaces:**
- Consumes: `UploadService.saveUserFile(userId, buffer, filename, mime)`（studio.service.ts:1512 已有用法）、`readImageBuffer(url)`（同文件已有 helper）。
- Produces: `POST /api/studio/image/matting`，body `{ imageUrl: string }`，成功 `200 { data: { url: string } }`；`503`（无 `MATTING_SERVICE_URL`）；`502`（rembg 非 200/超时 30s/响应非 PNG）；`400`（imageUrl 空、图 >20MB、尺寸 >4096px，尺寸校验复用 media-probe 既有 util）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/server/src/studio/studio.matting.test.ts（骨架，仿 studio.segment.test.ts 的 mock 方式）
describe('POST /api/studio/image/matting', () => {
  it('未配置 MATTING_SERVICE_URL 返回 503', async () => {
    /* delete process.env.MATTING_SERVICE_URL; 期望 503，文案「抠图服务未启用」 */
  })
  it('rembg 非 200 返回 502', async () => {
    /* mock fetch(内网 matting) 返回 500；期望 502，文案「抠图服务暂时不可用」 */
  })
  it('rembg 成功时上传 PNG 并返回 url，不查积分', async () => {
    /* mock rembg 返回 PNG buffer；断言 200、saveUserFile 以 'matting.png'/'image/png' 调用、
       points 服务零调用 */
  })
  it('imageUrl 为空返回 400', async () => { /* ... */ })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.matting.test.ts`
Expected: FAIL（`mattingImage` 不存在 / 路由 404）

- [ ] **Step 3: 实现**

```ts
// studio.service.ts 新增（要点，完整实现参照 segmentImage 的结构）
async mattingImage(userId: string, input: { imageUrl: string }): Promise<{ url: string }> {
  const imageUrl = input.imageUrl?.trim()
  if (!imageUrl) throw new BadRequestException('imageUrl 不能为空')
  const endpoint = process.env.MATTING_SERVICE_URL?.trim()
  if (!endpoint) throw new ServiceUnavailableException('抠图服务未启用')
  const { buffer, width, height, contentType } = await readImageBuffer(imageUrl) // 复用既有 helper + 尺寸探测
  if (buffer.byteLength > 20 * 1024 * 1024 || width > 4096 || height > 4096) {
    throw new BadRequestException('图片过大（限 20MB / 4096px）')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let out: Response
  try {
    out = await fetch(`${endpoint.replace(/\/$/, '')}/matting`, {
      method: 'POST',
      body: new Uint8Array(buffer),
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      signal: controller.signal,
    })
  } catch {
    throw new ServiceUnavailableException('抠图服务暂时不可用')
  } finally {
    clearTimeout(timer)
  }
  if (!out.ok) throw new ServiceUnavailableException('抠图服务暂时不可用') // 统一映射 502 语义
  const png = Buffer.from(await out.arrayBuffer())
  if (png.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new ServiceUnavailableException('抠图服务暂时不可用')
  }
  const saved = await this.upload.saveUserFile(userId, png, 'matting.png', 'image/png')
  return { url: saved.url }
}
```

注意：502 语义用 NestJS 映射——本仓库点选把上游失败映射为 `HttpException(..., HttpStatus.BAD_GATEWAY)`（见 spec §1.3 of sam-fallback）；**实现时参照 `segmentImage` 对 fal 失败的 502 映射写法**，上方草稿中的 `ServiceUnavailableException` 一律替换为同款 502 构造。rembg 服务不可达也归 502（区分于"未配置"的 503）。

```ts
// studio.controller.ts
@Post('image/matting')
async mattingImage(@Req() req: Request, @Body() body: { imageUrl: string }) {
  const data = await this.studioService.mattingImage(req.user.sub, { imageUrl: body.imageUrl })
  return { data }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @lnkpi/server exec vitest run src/studio/studio.matting.test.ts`
Expected: PASS（4 用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/studio/studio.service.ts apps/server/src/studio/studio.controller.ts apps/server/src/studio/studio.matting.test.ts
git commit -m "feat(server): 抠图端点 POST /studio/image/matting（rembg 代理，503/502 契约，免费）"
```

---

### Task 2: CVM 自托管 rembg 容器（lnkpi-matting）

**Files:**
- Create: `deploy/docker/matting/Dockerfile`
- Create: `deploy/docker/matting/main.py`
- Create: `deploy/docker/matting/requirements.txt`
- Modify: `deploy/docker-compose.prod.yml`（新增 `matting` service）
- Modify: `deploy/.env.production.example`（新增 `MATTING_SERVICE_URL=http://lnkpi-matting:8000`）

**Interfaces:**
- Consumes: 无。
- Produces: 内网服务 `http://lnkpi-matting:8000`，`POST /matting`（body = 原图二进制，响应 = 透明 PNG 二进制）、`GET /health` → `{"ok":true}`；Task 1 的 server 端点经 `MATTING_SERVICE_URL` 调它。

- [ ] **Step 1: 写服务文件**

```python
# deploy/docker/matting/main.py
from fastapi import FastAPI, Request, Response
from rembg import remove, new_session
from io import BytesIO
from PIL import Image

app = FastAPI()
# isnet-general-use：通用主体分割，首次调用下载到 ~/.u2net（volume 持久化）
session = new_session("isnet-general-use")

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/matting")
async def matting(req: Request):
    raw = await req.body()
    out = remove(Image.open(BytesIO(raw)), session=session)
    buf = BytesIO()
    out.save(buf, "PNG")
    return Response(content=buf.getvalue(), media_type="image/png")
```

```dockerfile
# deploy/docker/matting/Dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# 预置模型到镜像层，避免运行时下载抖动（约 170MB）
RUN python -c "from rembg import new_session; new_session('isnet-general-use')"
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```
# deploy/docker/matting/requirements.txt
fastapi==0.115.*
uvicorn==0.32.*
rembg[cpu]==2.0.*
pillow==11.*
onnxruntime==1.19.*
```

- [ ] **Step 2: compose 接线**（对齐 agent-runtime 的「仅内网」写法）

```yaml
  # 仅内网；勿映射端口到公网。模型预置在镜像层（isnet-general-use，~170MB）
  matting:
    image: ${LNKPI_MATTING_IMAGE:-lnkpi-matting:local}
    build:
      context: ./docker/matting
    container_name: lnkpi-matting
    restart: unless-stopped
    mem_limit: 1g
    networks:
      - lnkpi
    volumes:
      - matting-models:/root/.u2net
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
```

volumes 段追加 `matting-models:`；api 服务 environment 追加 `MATTING_SERVICE_URL: "http://lnkpi-matting:8000"`（保留 env_file 覆盖能力，与既有 PORT 写法一致）；`deploy/.env.production.example` 同步注释示例。

- [ ] **Step 3: 本地验证（可选项，无 CI 断言）**

```bash
docker build -t lnkpi-matting:local deploy/docker/matting/
docker run --rm -d -p 18000:8000 lnkpi-matting:local && sleep 8
curl -sf http://localhost:18000/health
# 用任一本地图片：curl -sf --data-binary @test.png -H 'Content-Type: image/png' http://localhost:18000/matting -o out.png && file out.png（应为 PNG）
docker stop $(docker ps -q --filter ancestor=lnkpi-matting:local)
```

Expected: health 返回 `{"ok":true}`；out.png 为 PNG（透明背景可用预览确认）。

- [ ] **Step 4: Commit**

```bash
git add deploy/docker/matting/ deploy/docker-compose.prod.yml deploy/.env.production.example
git commit -m "feat(deploy): lnkpi-matting 自托管 rembg 容器（isnet-general-use，仅内网，1GB 内存上限）"
```

---

### Task 3: web API 客户端 + 选区合成纯函数

**Files:**
- Modify: `apps/web/src/services/studio-api.ts`（`segmentImage` @117 旁新增）
- Create: `apps/web/src/components/canvas/refine/mattingComposite.ts`
- Test: `apps/web/src/components/canvas/refine/mattingComposite.test.ts`

**Interfaces:**
- Consumes: Task 1 的端点。
- Produces:
  - `studioApi.mattingImage(body: { imageUrl: string }, signal?: AbortSignal): Promise<{ url: string }>`
  - `compositeMattingPng(opts: { image: HTMLImageElement; maskRgba: Uint8ClampedArray }): Promise<Blob>` —— mask 白色（r 通道）= 保留，透明 = 抠掉；输出 PNG blob。

- [ ] **Step 1: 写失败测试**（jsdom 无真 canvas 时用 `createImageBitmap` 不可用 → 测试拆纯数据层）

```ts
// mattingComposite.test.ts —— 把核心逻辑抽成可测纯函数 applyAlphaFromMask
import { describe, expect, it } from 'vitest'
import { applyAlphaFromMask } from './mattingComposite'

describe('applyAlphaFromMask', () => {
  const rgba = (r: number, g: number, b: number, a: number) => [r, g, b, a]

  it('mask 白色区域保留 alpha，黑色区域归零', () => {
    const image = new Uint8ClampedArray([
      ...rgba(200, 10, 10, 255), // 像素0：mask 白 → 保留
      ...rgba(10, 200, 10, 255), // 像素1：mask 黑 → alpha 0
    ])
    const mask = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0])
    const out = applyAlphaFromMask(image, mask)
    expect([out[0], out[1], out[2], out[3]]).toEqual([200, 10, 10, 255])
    expect(out[7]).toBe(0)
  })

  it('mask 灰度产生半透明（边缘软化）', () => {
    const image = new Uint8ClampedArray([...rgba(0, 0, 255, 255)])
    const mask = new Uint8ClampedArray([128, 128, 128, 255])
    const out = applyAlphaFromMask(image, mask)
    expect(out[3]).toBe(128)
  })

  it('mask 长度与像素数不匹配时抛错', () => {
    expect(() => applyAlphaFromMask(new Uint8ClampedArray(4), new Uint8ClampedArray(8))).toThrow()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/web && node ../../node_modules/vitest/vitest.mjs run src/components/canvas/refine/mattingComposite.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// mattingComposite.ts
/** mask 的 r 通道（0-255）映射为目标 alpha；返回新 RGBA 数组（不改入参）。 */
export function applyAlphaFromMask(
  image: Uint8ClampedArray,
  mask: Uint8ClampedArray,
): Uint8ClampedArray {
  const pxCount = image.length / 4
  if (mask.length !== pxCount * 4) throw new Error('mask 尺寸与图像不匹配')
  const out = new Uint8ClampedArray(image)
  for (let i = 0; i < pxCount; i += 1) out[i * 4 + 3] = mask[i * 4]
  return out
}

/** 原图 + mask → 透明 PNG blob（canvas 路径，浏览器专用）。 */
export async function compositeMattingPng(opts: {
  image: HTMLImageElement
  maskRgba: Uint8ClampedArray
}): Promise<Blob> {
  const { image, maskRgba } = opts
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d 不可用')
  ctx.drawImage(image, 0, 0)
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  data.data.set(applyAlphaFromMask(data.data, maskRgba))
  ctx.putImageData(data, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png')
  })
}
```

API 客户端（studio-api.ts，紧邻 `segmentImage`）：

```ts
  mattingImage: (body: { imageUrl: string }, signal?: AbortSignal) =>
    api.post<{ data: { url: string } }>('/studio/image/matting', body, { timeout: 45_000, signal }),
```

- [ ] **Step 4: 跑测试确认通过**（同 Step 2 命令）Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/studio-api.ts apps/web/src/components/canvas/refine/mattingComposite.ts apps/web/src/components/canvas/refine/mattingComposite.test.ts
git commit -m "feat(web): mattingImage API 客户端 + 选区 alpha 合成纯函数"
```

---

### Task 4: store 会话结果（refineSessionResults）

**Files:**
- Modify: `apps/web/src/stores/canvasEditor.ts`（refine 状态区，`refineOutpaintBase` 附近）
- Test: `apps/web/src/stores/canvasEditor.refine.test.ts`（追加 describe）

**Interfaces:**
- Consumes: 无。
- Produces:
  - 类型 `RefineSessionResult { id: string; url: string; recordId?: string; prompt: string; createdAt: string }`（定义在 `packages/shared/src/canvas/imageVersions.ts` 旁或本 store 文件内——**放 store 文件内导出**，避免动 shared）
  - state：`refineSessionResults: RefineSessionResult[]`、`refineSessionCurrentId: string | null`
  - actions：`pushRefineSessionResult(r: Omit<RefineSessionResult,'id'|'createdAt'> & { id?: string })`（自动补 id/时间；push 后 currentId 指向它；数组 >8 挤掉最旧且被挤者若是 current 则 current 顺移）、`selectRefineSessionResult(id: string)`、`clearRefineSessionResults()`
  - getter：`currentRefineSessionResult: ComputedRef<RefineSessionResult | null>`
  - 清空时机：`closeImageEditor()`、`setRefineMode('select')` 重置路径、`openImageEditor()` 换图入口（三处已有 `refineOutpaintRect.value = null` 的位置）

- [ ] **Step 1: 写失败测试**

```ts
describe('refineSessionResults', () => {
  it('push 后 current 指向新结果，最多保留 8 张挤旧', () => {
    const editor = useCanvasEditorStore()
    for (let i = 0; i < 9; i++) editor.pushRefineSessionResult({ url: `u${i}`, prompt: '' })
    expect(editor.refineSessionResults.length).toBe(8)
    expect(editor.refineSessionResults[0].url).toBe('u1')
    expect(editor.currentRefineSessionResult?.url).toBe('u8')
  })
  it('selectRefineSessionResult 切换 current', () => { /* push u0/u1 → select u0 → current.url === 'u0' */ })
  it('换图/退出清空：clearRefineSessionResults 后为空且 current 为 null', () => { /* ... */ })
  it('挤掉最旧若为 current，current 顺移到新的最旧', () => { /* push 8 张，select 第0张，再 push 1 张 → current 为原第1张 */ })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @lnkpi/web exec vitest run src/stores/canvasEditor.refine.test.ts`
Expected: FAIL（action 不存在）

- [ ] **Step 3: 实现**（在 canvasEditor.ts 的 refine 区块按 Produces 契约写齐 state/actions/getter，并在三处既有重置点调用 `clearRefineSessionResults()`）

- [ ] **Step 4: 跑测试确认通过** Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/canvasEditor.ts apps/web/src/stores/canvasEditor.refine.test.ts
git commit -m "feat(web): 精修会话结果 store（胶片条数据源，8 张挤旧，换图清空）"
```

---

### Task 5: SessionFilmstrip 组件

**Files:**
- Create: `apps/web/src/components/canvas/refine/SessionFilmstrip.vue`
- Test: `apps/web/src/components/canvas/refine/SessionFilmstrip.test.ts`

**Interfaces:**
- Consumes: 无（纯展示组件，数据由父级传）。
- Produces:
  - props：`results: RefineSessionResult[]`、`currentId: string | null`、`disabled?: boolean`
  - emits：`select: [id: string]`
  - 根节点 `data-testid="session-filmstrip"`；每项 `data-testid="filmstrip-item"`、当前项 class `is-current`

- [ ] **Step 1: 写失败测试**

```ts
it('渲染 3 项缩略图，点击触发 select', async () => {
  const w = mount(SessionFilmstrip, {
    props: { results: [{ id: 'a', url: 'u-a', prompt: '' }, { id: 'b', url: 'u-b', prompt: '' }, { id: 'c', url: 'u-c', prompt: '' }], currentId: 'b' },
  })
  expect(w.findAll('[data-testid="filmstrip-item"]')).toHaveLength(3)
  expect(w.find('[data-testid="filmstrip-item"].is-current').attributes('data-id')).toBe('b')
  await w.findAll('[data-testid="filmstrip-item"]')[0].trigger('click')
  expect(w.emitted('select')?.[0]).toEqual(['a'])
})
it('disabled 时点击不 emit', async () => { /* ... */ })
```

- [ ] **Step 2: 跑测试确认失败** → **Step 3: 实现**（横向 scroll 缩略图行，img 44px 高圆角，`is-current` 高亮描边；样式复用 `refine-rail__*` 同级 token，不新增全局类）

- [ ] **Step 4: 跑测试确认通过** → **Step 5: Commit**

```bash
git commit -am "feat(web): SessionFilmstrip 会话结果胶片条组件"
```

---

### Task 6: refine-matting 注册 + MattingPanel / MattingDock

**Files:**
- Modify: `apps/web/src/components/canvas/refine/workbenchToolRegistry.ts`（新增注册项）
- Create: `apps/web/src/components/canvas/refine/MattingPanel.vue`
- Create: `apps/web/src/components/canvas/refine/MattingDock.vue`
- Modify: `apps/web/src/components/canvas/refine/refineToolRailModel.ts`（能力区移除 matting 占位）
- Test: `apps/web/src/components/canvas/refine/MattingPanel.test.ts`、`workbenchToolRegistry.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 `studioApi.mattingImage` / `compositeMattingPng`；Task 4 store actions；`editor.getRefineMask()`（现有）、`loadMaskRgbaFromUrl`（maskRemote.ts:47）、`persistMediaUrl`（现有 util）。
- Produces:
  - 注册项：`'refine-matting' = { panel: MattingPanel, dock: MattingDock, dockPlacement: 'panel' }`；`toolIdForRefineMode` 不涉及（matting 是独立 mode id）
  - MattingPanel props：`{ beforeUrl: string; busy: boolean; mattingUnavailable: boolean }`；emits：`run-auto`、`run-mask`、`apply`（父级 RefineSidePanel 实现动作，面板保持哑组件——与 RefineSelectPanel 同模式）
  - MattingDock：CTA 调用 `emit('run-auto')`，`mattingUnavailable` 时 disabled + title「抠图服务未启用」；CTA 尺寸 `md`（GC4）、文案 aria-label 与 title 同步「一键抠图」（GC7）

- [ ] **Step 1: 注册表测试先行**

```ts
// workbenchToolRegistry.test.ts 追加
it('refine-matting 已注册且为 panel 落位', () => {
  const tool = getWorkbenchTool('refine-matting')
  expect(tool?.panel).toBeTruthy()
  expect(tool?.dockPlacement).toBe('panel')
})
```

- [ ] **Step 2: 跑失败** → **Step 3: MattingPanel 实现**（结构）：

```vue
<template>
  <div class="matting-panel" data-testid="matting-panel">
    <div class="matting-preview" data-testid="matting-preview">
      <!-- 棋盘格底（CSS conic-gradient，8px 格）+ after 图层（无结果时显示 before） -->
    </div>
    <SessionFilmstrip ... />
    <button data-testid="matting-run-auto" :disabled="busy || mattingUnavailable"
      :title="mattingUnavailable ? '抠图服务未启用' : '一键抠图'" @click="emit('run-auto')">一键抠图</button>
    <button data-testid="matting-run-mask" :disabled="busy || !maskAvailable"
      title="用当前选区抠" @click="emit('run-mask')">用当前选区抠</button>
    <button data-testid="matting-apply" :disabled="busy || !canApply" @click="emit('apply')">应用到画布</button>
  </div>
</template>
```

`maskAvailable` / `canApply` 由 props 下发（`maskAvailable: boolean`，父级从 `editor.getRefineMask()` 判空；`canApply: boolean` = 会话结果非空）。MattingDock 复用 `RefineDock` 的壳或独立窄卡（与 `RefineOutpaintDock` 同构，含 `size="md"` CTA）。

- [ ] **Step 4: MattingPanel 测试**：棋盘格样式类存在（`matting-preview` 有 `checkerboard` class）；`mattingUnavailable` 时 run-auto 禁用 + title；`canApply=false` 时 apply 禁用；点击 emits。

- [ ] **Step 5: 跑全部通过** → **Step 6: Commit**

```bash
git commit -am "feat(web): refine-matting 注册三件套（MattingPanel/MattingDock，能力区占位移除）"
```

---

### Task 7: RefineSidePanel 接线（matting 动作 + 胶片条 + 版本条退役）

**Files:**
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`
- Modify: `apps/web/src/components/canvas/refine/RefineWorkbench.vue`（props 透传链）
- Test: `apps/web/src/components/canvas/refine/RefineSidePanel.test.ts`（改写）

**Interfaces:**
- Consumes: Task 4/5/6 全部 Produces。
- Produces（对 Task 8）：
  - props **删除** `versions` / `currentVersionId`；emit **删除** `revert`
  - `afterUrl` 数据源改为 `editor.currentRefineSessionResult?.url ?? null`；`canApply = !!afterUrl`
  - matting 动作实现（本组件内）：
    - `runMattingAuto()`：`studioApi.mattingImage({ imageUrl: beforeUrl })` → 成功 `editor.pushRefineSessionResult({ url, recordId: undefined, prompt: '抠图' })`；503 → `ElMessage.warning('抠图服务未启用')`；502 → `ElMessage.warning('抠图服务暂时不可用')`；busy 态置 `editor.setRefineBusy`
    - `runMattingMask()`：`editor.getRefineMask()` → canvas → `compositeMattingPng({ image, maskRgba })`（image 由 `beforeUrl` new Image 加载；mask RGBA 走本地 mask canvas 或 `loadMaskRgbaFromUrl`）→ `persistMediaUrl(file, fallbackUrl)` → push 会话结果
    - `apply` emit payload 不变：`{ url: afterUrl, prompt: currentResult.prompt, recordId? }`（CanvasPage 侧语义在 Task 8 改）
  - 胶片条渲染：非 select 模式的滚动槽底部（对照 band 之下）挂 `SessionFilmstrip`，select 变更 → `editor.selectRefineSessionResult`
  - `VersionStrip` 引用、`onRevert*`、`refine-side__versions` 区块全删

- [ ] **Step 1: 改写测试**（红）：

```ts
it('扩图生成成功后结果进会话胶片条且 after 切换', async () => { /* mock editImage → push 断言 editor.refineSessionResults */ })
it('matting 面板渲染 + run-auto 调 mattingImage + 结果入会话', async () => { /* mock studioApi.mattingImage */ })
it('matting 503 时 toast 且不 push', async () => { /* ... */ })
it('不再渲染 VersionStrip、revert emit 移除', () => {
  expect(q('[data-testid="refine-version-strip"]')).toBeNull()
})
it('胶片条点击切换 afterUrl（apply payload 跟随）', async () => { /* ... */ })
```

- [ ] **Step 2: 确认失败** → **Step 3: 实现**（props/emit 签名变更同步 `RefineWorkbench.vue` 透传） → **Step 4: 通过** → **Step 5: Commit**

```bash
git commit -am "feat(web): 精修面板接线 matting 动作 + 会话胶片条，VersionStrip 链路退役"
```

---

### Task 8: CanvasPage 应用语义重写（applyRefineAsChild）

**Files:**
- Create: `apps/web/src/composables/useRefineApply.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`（`handleRefineApply` @2990、`handleRefineRevert` @3053、RefineWorkbench 绑定 @4083）
- Test: `apps/web/src/composables/useRefineApply.test.ts`

**Interfaces:**
- Consumes: Task 7 的 apply payload；`runGridSlice` 的注入范式（useGridSlice.ts:92）；`seedImageVersions`（shared）；`containFitSize`（CanvasPage 已有）。
- Produces:

```ts
// useRefineApply.ts
export interface RefineApplyAsChildInput {
  sourceNode: { id: string; position: { x: number; y: number } }
  result: { url: string; prompt: string; recordId?: string; appliedKey: string; nodeSize?: { width: number; height: number } }
  addNode: (type: 'image', data: Record<string, unknown>, opts?: Record<string, unknown>) => string
  addEdge: (edge: { id: string; source: string; target: string }) => void
  findAppliedNode: (key: string) => { id: string } | undefined
  defaultBox?: { width: number; height: number } // 默认 { width: 280, height: 280 }
}
export function applyRefineAsChild(input: RefineApplyAsChildInput): { nodeId: string; created: boolean }
```

- `findAppliedNode` 命中 → 返回 `{ nodeId, created: false }`（幂等，**不建节点不加边**）
- 未命中 → `addNode('image', { url, prompt, imageModel, generationRecordId?, status: 'completed', appliedKey, nodeSize, imageVersions: seed 单版本 })` + `addEdge({ id: 'e-<source>-<new>', source, target })`；position = 源节点右侧偏移（横向间距 40px，纵向对齐源节点 top）；返回 `{ nodeId, created: true }`

- [ ] **Step 1: 写失败测试**

```ts
it('首次应用：新建下游节点 + 连边，携带 appliedKey 与 recordId', () => { /* 断言 addNode/addEdge 调用参数与返回 { created: true } */ })
it('重复应用同 appliedKey：不新建，返回已有节点（幂等）', () => { /* findAppliedNode 命中路径 */ })
it('扩图结果 nodeSize 按 outpaintTo contain-fit 进 280 框', () => { /* nodeSize.width/height 断言 */ })
it('不修改源节点：input.sourceNode 无 url 字段可写（类型层面排除）+ 不触发 patch', () => { /* 结构性保证：函数根本没有源节点 data 写入路径 */ })
```

- [ ] **Step 2: 确认失败** → **Step 3: 实现 useRefineApply.ts** → **Step 4: 通过**

- [ ] **Step 5: CanvasPage 重写**

```ts
function handleRefineApply(payload: RefineApplyPayload) {
  const nodeId = canvasEditor.imageTarget?.nodeId
  const node = nodeId && findNodeById(nodeId)
  if (!node) return
  const appliedKey = payload.recordId ?? `matting:${payload.url}`
  const res = applyRefineAsChild({
    sourceNode: { id: node.id, position: { ...node.position } },
    result: {
      url: payload.url,
      prompt: payload.prompt,
      recordId: payload.recordId,
      appliedKey,
      nodeSize: payload.metadata?.outpaintTo
        ? containFitSize({ width: 280, height: 280 }, payload.metadata.outpaintTo)
        : undefined,
    },
    addNode: (type, data, opts) => addNode(type, { prompt: '', imageModel: getProviderConfig('image').model, ...data } as never, opts),
    addEdge,
    findAppliedNode: (key) => nodes.value.find((n) => (n.data as Record<string, unknown>)?.appliedKey === key),
  })
  selectNodeIds([res.nodeId])
  void persistUserEditAsync()
  if (res.created) ElMessage.success('已应用到画布（下游新节点）')
  else ElMessage.info('该结果已应用过，已为你定位节点')
}
```

- `handleRefineRevert` 整函数删除 + `@revert` 绑定删除
- RefineWorkbench 绑定：删 `:versions` / `:current-version-id` / `@revert`
- `shouldApplyRefineToNode`、`applyOutpaintCenterAnchor`、`handleRefineRevert` 相关 import 清理；`appendEditVersion`/`revertImageVersion` 从 import @25 移除（`seedImageVersions` 保留——useRefineApply 用）

- [ ] **Step 6: 全量相关测试**

Run: `cd apps/web && node ../../node_modules/vitest/vitest.mjs run src/composables/useRefineApply.test.ts src/pages` + canvas 全套
Expected: PASS（旧 apply 语义断言已在 Task 7 改写）

- [ ] **Step 7: Commit**

```bash
git commit -am "feat(web): 精修应用语义统一——applyRefineAsChild 下游节点，版本回退链路删除"
```

---

### Task 9: 浮层一键点亮（matting 工具）

**Files:**
- Modify: `apps/web/src/components/canvas/selectionToolModel.ts:45`（`disabled: false`，删 `disabledReason`）
- Modify: `apps/web/src/components/canvas/SelectionActionBar.vue:55`（dispatch 分支 + emit 声明 + busy 态）
- Modify: `apps/web/src/pages/CanvasPage.vue`（`@matting` handler）
- Test: `apps/web/src/components/canvas/selectionToolModel.test.ts`、`SelectionActionBar.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 `studioApi.mattingImage`；Task 8 `applyRefineAsChild`。
- Produces: 浮层点击「抠图」→ `emit('matting')` → CanvasPage `handleFloatingMatting(node)`：busy（按钮 loading）→ `studioApi.mattingImage({ url })` → `applyRefineAsChild({ appliedKey: 'matting:' + url })` → toast；503/502 toast 同 Task 7 文案。

- [ ] **Step 1: 失败测试**

```ts
// selectionToolModel.test.ts 追加
it('matting 工具已点亮（非 disabled）', () => {
  const tools = buildSelectionTools({ hasUrl: true })
  expect(tools.find((t) => t.id === 'matting')?.disabled).toBe(false)
})
// SelectionActionBar.test.ts 追加
it('点击 matting 工具 emit matting', async () => { /* trigger [data-action="matting"] click */ })
```

- [ ] **Step 2: 确认失败** → **Step 3: 实现**（dispatch：`else if (tool.id === 'matting') emit('matting')`；CanvasPage handler 内 busy ref 防重入，进行中 toolbar 按钮 disabled） → **Step 4: 通过** → **Step 5: Commit**

```bash
git commit -am "feat(web): 浮层一键抠图点亮——直接生成下游节点，行为与精修应用一致"
```

---

### Task 10: 回归收口 + 浏览器验收

**Files:**
- Modify: 无新逻辑（清理与验证）

- [ ] **Step 1: 全量测试（串行）**

```bash
pnpm --filter @lnkpi/server exec vitest run          # server 全量
cd apps/web && node ../../node_modules/vitest/vitest.mjs run   # web 全量（142+ 文件）
```
Expected: 全绿；旧「覆盖原图」断言已全部改写为下游节点断言。

- [ ] **Step 2: 构建与配图校验**

```bash
pnpm build && pnpm verify-spec-figures --file docs/superpowers/specs/2026-09-22-refine-matting-unified-apply-design.md
```
Expected: 构建通过；配图 0 错误（注意：必须 `--file`，位置参数无效）。

- [ ] **Step 3: 浏览器验收（agent-browser + vite dev + 本地 rembg 容器）**

```bash
docker run --rm -d -p 18000:8000 lnkpi-matting:local
# apps/server/.env: MATTING_SERVICE_URL=http://localhost:18000（本地 dev 指宿主端口）
cd apps/web && node ../../node_modules/vitest/vitest.mjs --version >/dev/null; node ./node_modules/vite/bin/vite.js --port 5173 &
```

验收清单（spec §8 逐条）：
1. rail「抠图」进入独立模式，预览叠棋盘格；一键抠图出透明 PNG
2. 进涂抹画一笔 → 回抠图「用当前选区抠」出结果（不依赖 rembg 也可单独验：停容器后此路径仍可用）
3. 「应用」→ 原图下游新节点 + 连边 + 自动选中；重复应用 → 定位已有节点不新建
4. 扩图应用 → 下游节点按 outpaintTo 尺寸；原图 url/position 不变
5. 涂抹/点选生成 → 胶片条出现结果、可切换、应用走下游节点；退出精修胶片条清空
6. 浮层「抠图」一键 → 不进精修直接出下游节点；连点幂等
7. 停 rembg 容器 → 一键抠图禁用/503 toast；选区抠不受影响

- [ ] **Step 4: 清理 + Commit（若有测试补丁）**

```bash
git commit -am "test: 浏览器验收补丁（如有）" || true
```

---

## Self-Review 记录

- 覆盖检查：spec §2.2（Task 8）、§2.3（Task 7/8）、§2.4（Task 4/5/7）、§2.5（Task 7 hasAfter 随 afterUrl 改源）、§3.3（Task 1/2）、§3.4（Task 6/7）、§3.5（Task 9）、§4 迁移（Task 7/8）、§5 错误（Task 1/7/9）、§8 验收（Task 10）——无缺口。
- 类型一致性：`RefineSessionResult`（Task 4 定义 → Task 5/6/7 消费）；`applyRefineAsChild`（Task 8 定义 → Task 9 消费）；`mattingImage`（Task 1 端点 → Task 3 client → Task 7/9 调用）——签名已对齐。
- Review Focus 五项均有归属测试（Task 8×2、Task 1、Task 4、Task 7）。
