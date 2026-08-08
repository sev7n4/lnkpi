# 媒体流式下载（P0）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 画布节点点击「下载」经服务端流式代理保存到本机；去掉 `window.open` 假下载；外链资源提示可能过期；生成完成 toast 建议存本机。**不改变**生成物默认存 upstream URL 的策略。

**Architecture:** Nest `GET /api/media/stream-download` 鉴权 + SSRF + session 归属校验后 `fetch` upstream 并 `pipe` 到响应（不写 CVM 磁盘）；前端 `downloadMediaFile` 改调该 API；节点/预览层加 copy；生成完成 toast 追加文案。

**Tech Stack:** NestJS、Express stream、`assertSafeOutboundUrl`、Vitest（web + server）、现有 `resolveMediaUrl`

**Spec:** [docs/superpowers/specs/2026-08-08-media-storage-download-deferred-design.md](../specs/2026-08-08-media-storage-download-deferred-design.md)

## Global Constraints

- **生成物默认仍存 AI 平台 CDN 外链**；本 plan **不** rehost 到 CVM/COS。
- 代理响应 **不落盘**；单文件上限 **200MB**；须 `AuthGuard`。
- SSRF：复用 `assertSafeOutboundUrl`；拒绝内网/metadata。
- URL 须属于当前用户 session 的 `canvasData` / `Material` / 本站 `/api/uploads/{userId}/`。
- 删除 `downloadMediaFile` 的 `window.open` 兜底；失败 `ElMessage.warning`。
- `revokeObjectURL` 延迟 **~1000ms**。
- 外链角标 copy：「第三方链接，可能过期，请及时下载」。
- 生成完成 toast 追加：「建议立即下载到本机保存」。
- Commit per task；PR 前：`pnpm build`、`pnpm --filter @lnkpi/web test`、`pnpm --filter @lnkpi/server test`。

## File map

| File | Role |
| --- | --- |
| `apps/server/src/media/media.controller.ts` | `GET stream-download` |
| `apps/server/src/media/media.service.ts` | 归属校验、fetch pipe、filename |
| `apps/server/src/media/media.module.ts` | 模块注册 |
| `apps/server/src/media/media.service.test.ts` | 单元测试 |
| `apps/server/src/app.module.ts` | import MediaModule |
| `apps/web/src/composables/useCanvasMedia.ts` | proxy 下载、revoke 延迟 |
| `apps/web/src/composables/useCanvasMedia.test.ts` | 下载逻辑测试 |
| `apps/web/src/components/canvas/CanvasNodeImage.vue` | 外链 hint（video/audio 同步） |
| `apps/web/src/components/canvas/MediaPreviewOverlay.vue` | 同上 |
| `apps/web/src/components/agent/AgentSideRail.vue` 或生成 toast 处 | 生成完成 copy |
| `deploy/prod-media-download-verify.py` | 生产 smoke（可选） |

---

### Task 1: MediaService — URL 归属与 SSRF

**Files:**
- Create: `apps/server/src/media/media.service.ts`
- Create: `apps/server/src/media/media.service.test.ts`
- Modify: `apps/server/src/media/media.module.ts`（Task 2 创建 module 时 import）

**Interfaces:**
- Produces: `MediaService.assertDownloadAllowed(userId, url, sessionId?): Promise<{ fetchUrl: string; filename: string }>`

- [ ] **Step 1: Write failing tests**

```typescript
// media.service.test.ts — 摘录
describe('MediaService.assertDownloadAllowed', () => {
  it('allows /api/uploads/ owned by user', async () => { /* ... */ })
  it('allows upstream url present in session canvasData', async () => { /* ... */ })
  it('rejects private IP SSRF', async () => { /* ... */ })
  it('rejects url not in user sessions', async () => { /* ... */ })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @lnkpi/server test -- media.service.test`

- [ ] **Step 3: Implement `MediaService`**

```typescript
@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(UPLOAD_PUBLIC_BASE) private readonly publicBase: string,
  ) {}

  async assertDownloadAllowed(userId: string, rawUrl: string, sessionId?: string) {
    const url = resolvePublicMediaUrl(rawUrl.trim(), { publicBase: this.publicBase })
    if (url.startsWith('/api/uploads/')) {
      // 校验路径含 /api/uploads/{userId}/
      ...
    } else {
      assertSafeOutboundUrl(url)
      await this.assertUrlInUserCanvas(userId, url, sessionId)
    }
    return { fetchUrl: url.startsWith('/') ? `${this.publicBase}${url}` : url, filename: ... }
  }

  private async assertUrlInUserCanvas(userId: string, url: string, sessionId?: string) {
    // 扫描用户 sessions 的 canvasData JSON 节点 data.url + Material.url
    // 若传 sessionId 仅查该 session
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/media/
git commit -m "feat(server): media download URL ownership and SSRF checks"
```

---

### Task 2: MediaController — 流式 pipe

**Files:**
- Create: `apps/server/src/media/media.controller.ts`
- Create: `apps/server/src/media/media.module.ts`
- Modify: `apps/server/src/app.module.ts`

**Interfaces:**
- Consumes: `MediaService.assertDownloadAllowed`
- Produces: `GET /api/media/stream-download?url=&filename=&sessionId=`

- [ ] **Step 1: Write controller integration test**（supertest 或 service 层 mock stream）

- [ ] **Step 2: Implement controller**

```typescript
@Controller('media')
export class MediaController {
  @Get('stream-download')
  @UseGuards(AuthGuard)
  async streamDownload(@Query() dto, @Req() req, @Res() res: Response) {
    const { fetchUrl, filename } = await this.mediaService.assertDownloadAllowed(
      req.user.sub, dto.url, dto.sessionId,
    )
    const upstream = await fetch(fetchUrl)
    if (!upstream.ok) throw new BadGatewayException('上游资源不可达')
    const cl = upstream.headers.get('content-length')
    if (cl && Number(cl) > 200 * 1024 * 1024) throw new PayloadTooLargeException()
    res.setHeader('Content-Disposition', contentDispositionAttachment(filename))
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream')
    upstream.body.pipe(res)
  }
}
```

- [ ] **Step 3: Register `MediaModule` in `AppModule`**

- [ ] **Step 4: Run server tests + manual curl with token**

Run: `pnpm --filter @lnkpi/server test`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): stream-download proxy endpoint for canvas media"
```

---

### Task 3: 前端 downloadMediaFile 改走 proxy

**Files:**
- Modify: `apps/web/src/composables/useCanvasMedia.ts`
- Create: `apps/web/src/composables/useCanvasMedia.test.ts`
- Modify: `apps/web/src/components/canvas/CanvasNodeImage.vue`（传入 sessionId）
- Modify: `CanvasNodeVideo.vue`, `CanvasNodeAudio.vue`, `MediaPreviewOverlay.vue`

**Interfaces:**
- Consumes: `GET /api/media/stream-download`
- Produces: `downloadMediaFile(url, filename, opts?: { sessionId?: string })`

- [ ] **Step 1: Write failing vitest**

```typescript
it('downloadMediaFile fetches blob via stream-download API', async () => {
  // mock fetch returning blob
  await downloadMediaFile('https://cdn.example/a.png', 'a.png', { sessionId: 's1' })
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/media/stream-download'), ...)
})
it('does not call window.open on failure', async () => { ... })
```

- [ ] **Step 2: Implement**

```typescript
export async function downloadMediaFile(
  url: string,
  filename: string,
  opts?: { sessionId?: string },
) {
  const token = localStorage.getItem('token')
  const q = new URLSearchParams({
    url: resolveMediaUrl(url),
    filename,
    ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
  })
  const res = await fetch(apiUrl(`/media/stream-download?${q}`), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    ElMessage.warning('下载失败，链接可能已过期，请稍后重试')
    return
  }
  triggerDownload(await res.blob(), filename)
}
```

- [ ] **Step 3: Pass `sessionId` from route in node components**

- [ ] **Step 4: Run vitest + manual browser test on upstream 生成图**

Run: `pnpm --filter @lnkpi/web test useCanvasMedia`

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(web): canvas download via authenticated stream proxy"
```

---

### Task 4: UX — 外链提示 + 生成 toast

**Files:**
- Modify: `CanvasNodeImage.vue`, `CanvasNodeVideo.vue`, `CanvasNodeAudio.vue`
- Modify: `MediaPreviewOverlay.vue`
- Modify: 生成完成 toast 来源（`AgentSideRail` SSE 完成文案或 `material.service` 前端映射）

- [ ] **Step 1: Add computed `isUpstreamUrl`**

```typescript
const isUpstreamUrl = computed(() => {
  const u = String(props.data.url ?? '')
  return u.startsWith('http') && !u.includes('/api/uploads/')
})
```

- [ ] **Step 2: Show tooltip/title on download btn when upstream**

- [ ] **Step 3: Append toast snippet on generation success**（复用现有 ElMessage.success 或 agent 完成事件）

- [ ] **Step 4: Visual check + commit**

```bash
git commit -m "feat(web): upstream media expiry hint and save-local toast"
```

---

### Task 5: 生产 verify（可选）

**Files:**
- Create: `deploy/prod-media-download-verify.py`

- [ ] **Step 1:** Login → create session → generate image → GET stream-download with token → assert `Content-Disposition: attachment` and body length > 0

- [ ] **Step 2: Commit + run on prod after deploy**

---

## Out of scope (P2/P3 —  separate plans)

- COS/R2 懒持久化（收藏入库）
- 生成即持久化 opt-in
- OSS 生命周期
- 多选 ZIP 流式打包

---

## Spec coverage self-check

| Spec § | Task |
| --- | --- |
| P0 stream-download API | Task 1–2 |
| 去掉 window.open | Task 3 |
| 外链 UI 提示 | Task 4 |
| 生成 toast | Task 4 |
| 不占 CVM 磁盘 | 全 plan（pipe only） |
| P2/P3 | 不在本 plan |

---

## Execution handoff

Plan saved. 实现时优先 **Task 1→5 顺序**；P2（COS 懒持久化）另开 plan。
