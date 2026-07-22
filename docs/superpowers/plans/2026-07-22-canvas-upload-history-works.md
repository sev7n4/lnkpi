# Canvas Upload / History / Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix media upload failures with progress UX, repair edge-highlight residue, make task history session-scoped with richer cards/details, add homepage canvas […] actions, and ship publish-with-primary-asset + share detail (watch / readonly process / like / share / author).

**Architecture:** One feature branch with five sequential commit gates matching the approved design. Shared upload core (`persistMediaUrl` + progress) feeds every media entry point. History and works get schema fields (`sessionId`/`nodeId` on GenerationRecord; `playbackUrl`/`playbackKind` on Work). Edge highlight is display-only and never written back into `edges.value` class.

**Tech Stack:** Vue 3 + Pinia + Vue Flow, NestJS + Prisma (SQLite), axios, Element Plus, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-07-22-canvas-upload-history-works-design.md`

## Global Constraints

- Delivery: same branch `feature/canvas-upload-history-works`, five semantic commits, one final PR
- History node identity display: `node.id` (e.g. `image-3`)
- Publish requires explicit primary media node selection
- “制作过程” = readonly canvas snapshot + optional “复制到我的画布”
- Model and channel shown as separate detail rows (both retained)
- Remove `DockFailureChip` from dock-studio; keep node corner ⓘ diagnostic
- Login-required uploads must not silently fall back to `blob:`
- Chinese UI copy; no drive-by unrelated refactors

## File map

| Area | Create | Modify |
|------|--------|--------|
| Upload core | `apps/web/src/composables/useMediaUpload.test.ts` | `useMediaUpload.ts`, `upload-api.ts`, `useNodeMediaUpload.ts`, `CanvasAssetPanel.vue`, Image/Video dock panels, `CanvasPage.vue` drop handlers |
| Edge highlight | — | `CanvasPage.vue` `flowEdges` / selection clear |
| History | — | prisma `GenerationRecord`, studio list/create, `CanvasTaskHistoryPanel.vue`, remove DockFailureChip wiring |
| Sessions | — | `sessions.service/controller`, `WorkflowPage.vue` |
| Works | readonly canvas page (or mode) | prisma `Work`, works API/publish dialog, `SharePage.vue`, `WorkCard.vue` |

---

### Task 1: Upload core — no silent blob + progress API

**Files:**
- Modify: `apps/web/src/services/upload-api.ts`
- Modify: `apps/web/src/composables/useMediaUpload.ts`
- Create: `apps/web/src/composables/useMediaUpload.test.ts`

**Interfaces:**
- Produces:
  - `uploadApi.upload(file, opts?: { onProgress?: (pct: number) => void }): Promise<AxiosResponse<{ code?: number; data: UploadResult; message?: string }>>`
  - `persistMediaUrl(file, fallbackUrl, opts?: { onProgress?: (pct: number) => void; allowBlobFallback?: boolean }): Promise<string>`
  - `fileToPersistedPayload(file, opts?: { onProgress?: (pct: number) => void; allowBlobFallback?: boolean }): Promise<MediaFilePayload>`
- Default: logged-in → `allowBlobFallback=false`; logged-out → blob fallback allowed

- [ ] **Step 1: Write failing tests for persistMediaUrl**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistMediaUrl } from './useMediaUpload'

vi.mock('@/services/upload-api', () => ({
  uploadApi: { upload: vi.fn() },
}))
vi.mock('@/services/api-base', () => ({
  resolveMediaUrl: (u: string) => u,
}))

import { uploadApi } from '@/services/upload-api'

describe('persistMediaUrl', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't')
    vi.mocked(uploadApi.upload).mockReset()
  })

  it('throws when upload returns non-zero code', async () => {
    vi.mocked(uploadApi.upload).mockResolvedValue({
      data: { code: 1, message: '未收到文件', data: undefined as never },
    } as never)
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).rejects.toThrow(/未收到文件|上传/)
  })

  it('throws when logged-in upload network-fails (no blob fallback)', async () => {
    vi.mocked(uploadApi.upload).mockRejectedValue(new Error('Network Error'))
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).rejects.toThrow()
  })

  it('returns server url on success', async () => {
    vi.mocked(uploadApi.upload).mockResolvedValue({
      data: { code: 0, data: { url: '/uploads/u/a.png', fileName: 'a.png', mimeType: 'image/png', size: 1 } },
    } as never)
    await expect(persistMediaUrl(new File(['x'], 'a.png'), 'blob:x')).resolves.toBe('/uploads/u/a.png')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --dir apps/web exec vitest run src/composables/useMediaUpload.test.ts`
Expected: FAIL (current code returns blob on catch)

- [ ] **Step 3: Implement uploadApi + persistMediaUrl**

`upload-api.ts`:

```ts
upload: (file: File, opts?: { onProgress?: (pct: number) => void }) => {
  const form = new FormData()
  form.append('file', file)
  return api.post<{ code?: number; message?: string; data: UploadResult }>('/upload', form, {
    onUploadProgress: (e) => {
      if (!opts?.onProgress || !e.total) return
      opts.onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)))
    },
  })
},
```

`persistMediaUrl`: if no token → return fallback; else call upload; if `data.code` not 0/undefined-ok and no `data.data.url` throw `Error(message)`; on catch rethrow (no blob); resolve URL via `resolveMediaUrl`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --dir apps/web exec vitest run src/composables/useMediaUpload.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/services/upload-api.ts apps/web/src/composables/useMediaUpload.ts apps/web/src/composables/useMediaUpload.test.ts
git commit -m "fix(web): upload API surfaces errors and progress (no silent blob)"
```

---

### Task 2: Wire all upload entry points + dock Files drop

**Files:**
- Modify: `apps/web/src/composables/useNodeMediaUpload.ts`
- Modify: `apps/web/src/components/canvas/CanvasAssetPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue` (ingestMediaFile, drop on dock for Files)
- Modify: `apps/web/src/styles/neo-node.css` (optional uploading overlay styles)

**Interfaces:**
- Consumes: Task 1 `fileToPersistedPayload` / `persistMediaUrl` with `onProgress`
- Produces: dock Files drop → `applyLocalRefToSelectedNode` / `appendLocalRef` after successful upload

- [ ] **Step 1: Node card upload — status + progress + real errors**

In `useNodeMediaUpload.applyFile`:
1. `patchNode(nodeId, { status: 'uploading', uploadProgress: 0, errorMessage: undefined })`
2. `fileToPersistedPayload(file, { onProgress: (p) => patchNode(..., { uploadProgress: p }) })`
3. on success apply URL as today; clear `uploadProgress`
4. on catch: `status:'error'`, `errorMessage: err.message`, `errorCode:'upload_required'`
5. Remove the post-hoc “blob + token ⇒ error” branch (no longer needed if Task 1 throws)

Show a thin progress bar or percentage in image/video/audio node placeholder when `status==='uploading'` (minimal UI in each node or NeoBaseNode).

- [ ] **Step 2: Asset library upload**

In `CanvasAssetPanel.onUploadChange`: wrap `fileToPersistedPayload` in try/catch; show `uploading` flag + progress on the Upload button (`上传 45%`); on error `ElMessage.error(err.message)`.

- [ ] **Step 3: Dock reference image upload**

In ImageDockPanel / VideoDockPanel reference upload handlers: pass `onProgress` into `persistMediaUrl`; keep `refUploading` / `refUploadError`; set error from `err.message`.

- [ ] **Step 4: Canvas drop — clear blob-empty hack; show uploading**

In `ingestMediaFile` / `createFileNodeAt`:
- Remove “if blob && token then url=''” special-case
- try/catch around `fileToPersistedPayload`; on failure create error node or ElMessage
- Optionally create node first with `status:'uploading'` then patch URL

- [ ] **Step 5: Dock Files drop**

In `CanvasPage` area `dragover`/`drop` (same listener as asset MIME):
- If `dataTransfer.files?.length` and target `.closest('.dock-studio-toolbar')`:
  - `preventDefault`
  - take first file → `fileToPersistedPayload` with progress toast or dock busy state
  - build `LocalRefBinding` `{ id: createLocalRefId('upload'), mediaType, sourceKind:'upload', label:fileName, url }`
  - `applyLocalRefToSelectedNode(binding)` or warn if type unsupported
- If files drop on canvas (not dock): existing `mediaHandlers.onDrop`

- [ ] **Step 6: Manual smoke checklist (dev)**

Verify locally (or note in commit body): asset upload, node upload, dock picker, canvas drag, dock drag — each shows progress or clear error.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/composables/useNodeMediaUpload.ts apps/web/src/components/canvas/CanvasAssetPanel.vue apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue apps/web/src/pages/CanvasPage.vue apps/web/src/components/canvas/CanvasNodeImage.vue apps/web/src/components/canvas/CanvasNodeVideo.vue apps/web/src/components/canvas/CanvasNodeAudio.vue apps/web/src/styles/neo-node.css
git commit -m "feat(web): upload progress on nodes/assets/dock and Files drop onto dock"
```

---

### Task 3: Edge highlight — strip class every render

**Files:**
- Modify: `apps/web/src/pages/CanvasPage.vue` (`flowEdges`, `onEdgeClick`, selection clear)
- Optional test: extract pure helper `apps/web/src/utils/edgeHighlight.ts` + test

**Interfaces:**
- Produces: `annotateEdgesForSelection(edges, upstreamIds: Set<string>, downstreamIds: Set<string>): EdgeLike[]` always sets `class` to highlight class or `undefined`

- [ ] **Step 1: Add helper + test**

```ts
// edgeHighlight.ts
export function annotateEdgesForSelection<T extends { id: string; class?: string }>(
  edges: T[],
  upstream: Set<string>,
  downstream: Set<string>,
): T[] {
  return edges.map((edge) => {
    if (upstream.has(edge.id)) return { ...edge, class: 'neo-edge-upstream' }
    if (downstream.has(edge.id)) return { ...edge, class: 'neo-edge-downstream' }
    return { ...edge, class: undefined }
  })
}
```

Test: after upstream annotation, second call with empty sets clears class.

- [ ] **Step 2: Use helper in `flowEdges` computed**

Always map via helper (even when both sets empty).

- [ ] **Step 3: Clear highlight on edge click**

In `onEdgeClick`: clear `multiSelectedIds` / `clearSelection()` (keep edge selection if product needs it, but node-link highlight must die).

- [ ] **Step 4: Run unit test + commit**

```bash
pnpm --dir apps/web exec vitest run src/utils/edgeHighlight.test.ts
git add apps/web/src/utils/edgeHighlight.ts apps/web/src/utils/edgeHighlight.test.ts apps/web/src/pages/CanvasPage.vue
git commit -m "fix(web): clear upstream/downstream edge highlight when selection changes"
```

---

### Task 4: History — session scope, cards, detail, failure UX, remove DockFailureChip

**Files:**
- Modify: `apps/server/prisma/schema.prisma` (`GenerationRecord.sessionId`, `nodeId` + index)
- Modify: `apps/server/src/studio/studio.service.ts` + controller list query
- Modify: studio generate DTOs / canvas generate callers to pass `sessionId` + `nodeId`
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/shared/DockToolbarShell.vue` (remove failure chip)
- Modify: panels that bind `DockFailureChip` / `dockFailureBindFromNode`
- Run: `pnpm --dir apps/server exec prisma db push && prisma generate`

**Interfaces:**
- `listGenerations(userId, type?, sessionId?)` filters `where: { userId, sessionId }` when sessionId provided
- `GenerationRecord` create paths accept optional `sessionId`, `nodeId`
- Frontend `studioApi.listGenerations({ sessionId })`

- [ ] **Step 1: Schema + db push**

```prisma
model GenerationRecord {
  // existing fields...
  sessionId String?
  nodeId    String?
  @@index([userId, sessionId, createdAt])
}
```

- [ ] **Step 2: Server list + write**

- `listGenerations`: if `sessionId` query present → filter equality; **do not** return rows with null sessionId for that query
- All `generationRecord.create` from canvas generation: set `sessionId`, `nodeId` from request body (extend generate DTOs / agent canvas generate payloads already carrying node id)

- [ ] **Step 3: Frontend list scoped**

`CanvasTaskHistoryPanel`: `useRoute().params.sessionId` → `listGenerations({ sessionId })`.

- [ ] **Step 4: Card UI**

Default card:
- Type icon + `record.nodeId || '—'`
- Status pill; if failed, `!` button opens error popover (userMessage + copy diagnostic)
- Thumb: image `url`; video element; audio placeholder; text snippet from metadata

- [ ] **Step 5: Detail UI**

Separate rows:
- 模型: `modelOptionName(record.model ?? meta.originalModel ?? '')`
- 渠道: resolve channel name from `meta.channelId` if available in client provider store; else short `channelId`
- 节点: `nodeId`
- 参数: aspectRatio / resolution / size / count / duration / crop / voice / speed when present
- 失败原因 when status failed

- [ ] **Step 6: Remove DockFailureChip**

- Stop rendering in `DockToolbarShell`
- Leave `NodeTaskCornerActions` ⓘ intact
- Update/remove unit tests that assert dock chip presence (`dockFailureChip.test.ts` keep pure helpers if still used by history copy)

- [ ] **Step 7: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/src/studio apps/web/src/services/studio-api.ts apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue apps/web/src/components/canvas/dock-studio apps/web/src/pages/CanvasPage.vue apps/web/src/composables/useNodeGeneration.ts
git commit -m "feat: session-scoped generation history with richer cards and no dock failure chip"
```

---

### Task 5: Homepage canvas […] menu (rename / delete / duplicate)

**Files:**
- Modify: `apps/server/src/sessions/sessions.service.ts`
- Modify: `apps/server/src/sessions/sessions.controller.ts`
- Modify: `apps/web/src/pages/WorkflowPage.vue`
- Modify/create: web sessions API client if missing duplicate method

**Interfaces:**
- `POST /sessions/:id/duplicate` → `{ code:0, data: Session }` copies `canvasData`, title `${title} 副本`

- [ ] **Step 1: Server duplicate**

```ts
async duplicate(userId: string, id: string) {
  const src = await this.prisma.session.findFirst({ where: { id, userId } })
  if (!src) throw new NotFoundException()
  return this.prisma.session.create({
    data: {
      userId,
      title: `${src.title || '未命名画布'} 副本`,
      canvasData: src.canvasData,
    },
  })
}
```

- [ ] **Step 2: WorkflowPage menu UI**

On each canvas card:
- Absolute `...` button visible on hover, `@click.stop`
- Dropdown: 重命名 (ElMessageBox.prompt → PUT), 复制副本 (POST duplicate → refresh list / optional open), 删除 (confirm → DELETE)

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/sessions apps/web/src/pages/WorkflowPage.vue apps/web/src/services
git commit -m "feat: canvas list rename/delete/duplicate via hover menu"
```

---

### Task 6: Works — primary asset publish + share detail + like + readonly process

**Files:**
- Modify: `packages/shared/src/index.ts` (`Work.playbackUrl?`, `playbackKind?`)
- Modify: prisma `Work` model same fields
- Modify: `apps/server/src/works/works.service.ts` / controller (`publish` body, `like`, public canvas snapshot read)
- Modify: `apps/web/src/components/works/PublishNeoTVDialog.vue`
- Modify: `apps/web/src/pages/SharePage.vue`
- Modify: `apps/web/src/components/works/WorkCard.vue`
- Create: `apps/web/src/pages/CanvasReadonlyPage.vue` (or route query `?readonly=1` on CanvasPage with guards)
- Modify: router

**Interfaces:**
- `publish(userId, { sessionId, title, category?, primaryNodeId })`
- Resolves node from `session.canvasData`, requires `url`, sets `playbackUrl`, `playbackKind`, `coverUrl`
- `POST /works/:id/like` increments likes (auth)
- `GET /works/:id/canvas` returns canvasData if work is published (public read)

- [ ] **Step 1: Schema + shared types + db push**

```prisma
// Work
playbackUrl  String?
playbackKind String? // image | video
```

- [ ] **Step 2: Publish requires primaryNodeId**

Server throws `BadRequestException('请选择主成片节点')` if missing/invalid/no url.

Dialog: load session canvas nodes (image/video with url), radio/select required, disable submit until chosen.

- [ ] **Step 3: SharePage — watch / share / like / author**

- Video: `<video controls :src="playbackUrl">`; image: large img
- Like button → API; Share → `navigator.clipboard.writeText(location.href)` + toast
- Author block → `/creator/:authorId`
- CTA「查看制作过程」→ `/workflow/:sessionId/readonly` or `/share/:id/process`

- [ ] **Step 4: Readonly canvas**

Load canvas via work canvas endpoint or session if owner; Vue Flow with `nodes-draggable=false`, hide dock generate, hide agent generate, show banner「只读 · 制作过程」+ button「复制到我的画布」→ `POST /sessions/:id/duplicate` (for owner’s session id on the work) then navigate to new id.

If current user is not owner, duplicate should copy published snapshot into **their** new session (server: `duplicatePublishedWork(workId)` creating session for requester from work.session canvasData). Prefer one endpoint:

`POST /works/:id/fork-canvas` → creates session for current user from work’s session canvasData.

- [ ] **Step 5: WorkCard wiring**

Ensure clicks hit SharePage; buttons for 立即观看 / 制作过程 / 分享 stop propagation correctly.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/server/prisma apps/server/src/works apps/web/src/components/works apps/web/src/pages/SharePage.vue apps/web/src/pages/CanvasReadonlyPage.vue apps/web/src/router apps/web/src/services
git commit -m "feat: publish primary asset, share watch/like/process readonly canvas"
```

---

### Task 7: Branch validation + PR

- [ ] **Step 1: Local validation**

```bash
pnpm --dir apps/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/agent test
pnpm --dir apps/web exec vitest run
```

Expected: build green; tests pass (fix any breakage from DockFailureChip removal / Work type).

- [ ] **Step 2: Push + PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: 上传可观测性、历史画布级、主页画布菜单与作品详情" --body "$(cat <<'EOF'
## Summary
- 上传失败不再静默 blob；全入口进度；dock 支持本地文件拖放
- 上下游连线高亮 class 残留修复
- 历史改为 session 作用域；卡片/详情/失败 UX；下线 DockFailureChip
- 主页画布 […] 重命名/删除/复制
- 发布强制主成片；详情观看/点赞/分享/只读制作过程

## Spec
docs/superpowers/specs/2026-07-22-canvas-upload-history-works-design.md

## Test plan
- [ ] 登录后五条上传路径成功或明确报错+进度
- [ ] 点节点高亮上下游；点空白/换节点熄灭
- [ ] 历史仅本画布；卡片显示 node.id；失败可复制
- [ ] 画布卡片 […] 三项
- [ ] 发布选主成片后详情可观看/点赞/只读过程/复制画布
EOF
)"
```

---

## Spec coverage check

| Spec section | Task |
|--------------|------|
| 1–5 upload + dock Files | Task 1–2 |
| 6 edge highlight | Task 3 |
| 7–10 history + remove chip | Task 4 |
| 11 canvas menu | Task 5 |
| 12 publish/share/like/readonly | Task 6 |
| build/PR | Task 7 |

## Placeholder / consistency self-review

- No TBD steps; upload signatures consistent across Task 1–2
- `nodeId` / `sessionId` naming consistent in schema, API, UI
- `playbackUrl` / `playbackKind` consistent shared + prisma + publish
- Fork path standardized as `POST /works/:id/fork-canvas` for non-owner “复制到我的画布”
