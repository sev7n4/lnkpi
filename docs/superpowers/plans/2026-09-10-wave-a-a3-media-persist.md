# Wave A · A3 媒体持久化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 确认流式下载 P0 无缺口；实现可插拔 `StorageAdapter` + `POST /api/assets/persist-remote`；upstream「存入资产库」转存对象存储；Agent `save_node_to_asset_library` 同路径。默认生成仍只存 upstream URL。

**Architecture:** 复用 `MediaService.resolveDownloadSource` + `openDownloadStream` 做归属/SSRF/拉流；新 `PersistRemoteService` 流式写入 `StorageAdapter`；未配置 Adapter 返回 503。前端 `saveAssetToLibrary` 对 upstream 改调 persist；`/api/uploads/` 仍直存。

**Tech Stack:** NestJS、Prisma `UserAsset`、Vitest、`@aws-sdk/client-s3` + `@aws-sdk/lib-storage`（S3 兼容，可接腾讯云 COS）、现有 `useCanvasMedia` / `assets-api`

**Spec:** [docs/superpowers/specs/2026-09-10-wave-a-a3-media-persist-design.md](../specs/2026-09-10-wave-a-a3-media-persist-design.md)  
**Program:** [docs/superpowers/specs/2026-09-10-wave-a-delivery-program-design.md](../specs/2026-09-10-wave-a-delivery-program-design.md)

## Global Constraints

- 生成物默认仍存 upstream CDN；**禁止**生成成功自动 rehost。
- persist / 转存过程 **不写** CVM `uploads/` 磁盘（仅对象存储；本站 upload 跳过转存）。
- 单文件上限 **200MB**（与 `MediaService` `MAX_DOWNLOAD_BYTES` 一致）。
- Adapter 未配置 → **HTTP 503** + 可读文案；**禁止**把 upstream URL 标成 `persisted` 假成功。
- 人机同路径：UI 与 Agent 共用 `PersistRemoteService`。
- SSRF / 归属：复用 `MediaService.resolveDownloadSource`，不复制一套规则。
- Commit per task；PR 前：`pnpm build`、`pnpm --filter @lnkpi/web test`、`pnpm --filter @lnkpi/server test`。

## File map

| File | Role |
| --- | --- |
| `apps/server/src/storage/storage.adapter.ts` | `StorageAdapter` 接口 + DI token |
| `apps/server/src/storage/unconfigured.storage-adapter.ts` | 未配置时抛 503 |
| `apps/server/src/storage/s3-compatible.storage-adapter.ts` | COS/S3 兼容实现 |
| `apps/server/src/storage/storage.module.ts` | 按 env 选择 Adapter |
| `apps/server/src/storage/storage.adapter.test.ts` | Adapter 工厂 / unconfigured 测试 |
| `apps/server/src/assets/persist-remote.service.ts` | 拉流 → putStream → upsert UserAsset → 可选回写节点 |
| `apps/server/src/assets/persist-remote.service.test.ts` | 核心单测 |
| `apps/server/src/assets/build-user-asset-metadata.ts` | 扩展 `storageTier` / `upstreamUrl` / `objectKey` |
| `apps/server/src/assets/assets.controller.ts` | `POST persist-remote` |
| `apps/server/src/assets/assets.module.ts` | import StorageModule + MediaModule；providers |
| `apps/server/src/media/media.module.ts` | **export** `MediaService`（若尚未 export） |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `saveNodeToAssetLibrary` 改调 PersistRemoteService |
| `apps/server/src/agent/agent.module.ts`（或等价） | 注入 Assets/Persist 依赖 |
| `apps/web/src/services/assets-api.ts` | `persistRemote` API |
| `apps/web/src/composables/useAssetLibrary.ts` | upstream → persist；upload → saveMine |
| `apps/web/src/composables/useAssetLibrary.test.ts` | 新建前端单测 |
| `apps/web/src/composables/useCanvasMedia.ts` | 已有 hint/toast；仅补洞时改 |
| `apps/web/src/components/media/MediaInspectorDrawer.vue` | 下载按钮外链 hint（P0 缺口） |
| `.env.example`（若存在） | `OBJECT_STORAGE_*` 文档 |

---

### Task 1: P0 补洞 — MediaInspector 外链 hint

**Files:**
- Modify: `apps/web/src/components/media/MediaInspectorDrawer.vue`
- Test: 手工 / 现有 `useCanvasMedia.test.ts`（hint 常量已覆盖）

**Interfaces:**
- Consumes: `isUpstreamMediaUrl`, `UPSTREAM_MEDIA_DOWNLOAD_HINT` from `@/composables/useCanvasMedia`

- [ ] **Step 1: 在下载按钮上显示 upstream hint**

在 `MediaInspectorDrawer.vue` script 增加：

```typescript
import {
  downloadMediaFile,
  isUpstreamMediaUrl,
  mediaDownloadName,
  UPSTREAM_MEDIA_DOWNLOAD_HINT,
} from '@/composables/useCanvasMedia'

const downloadTitle = computed(() => {
  const url = record.value?.url || target.value?.url || outputFile.value?.url || ''
  return isUpstreamMediaUrl(String(url)) ? UPSTREAM_MEDIA_DOWNLOAD_HINT : '下载'
})
```

模板中下载按钮加 `:title="downloadTitle"`（或已有 tooltip 组件则绑定同一文案）。

- [ ] **Step 2: 确认生成 toast**

确认调用链使用 `GENERATION_SAVE_LOCAL_HINT`（`useCanvasMedia.ts` 已导出）。若某条生成成功路径仍用裸「生成完成」，改为调用已有 helper（搜索 `ElMessage.success` + 生成完成）。

- [ ] **Step 3: Run web tests**

Run: `pnpm --filter @lnkpi/web test -- useCanvasMedia`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/media/MediaInspectorDrawer.vue
git commit -m "fix(web): upstream expiry hint on media inspector download"
```

---

### Task 2: StorageAdapter 接口 + Unconfigured + Module 工厂

**Files:**
- Create: `apps/server/src/storage/storage.adapter.ts`
- Create: `apps/server/src/storage/unconfigured.storage-adapter.ts`
- Create: `apps/server/src/storage/storage.module.ts`
- Create: `apps/server/src/storage/storage.adapter.test.ts`
- Modify: `apps/server/src/app.module.ts`（import `StorageModule`）

**Interfaces:**
- Produces: `STORAGE_ADAPTER` token；`StorageAdapter.putStream(...)`
- Produces: `createStorageAdapterFromEnv(): StorageAdapter`

- [ ] **Step 1: Write failing tests**

```typescript
// storage.adapter.test.ts
import { ServiceUnavailableException } from '@nestjs/common'
import { createStorageAdapterFromEnv } from './storage.module'
import { UnconfiguredStorageAdapter } from './unconfigured.storage-adapter'
import { Readable } from 'stream'

describe('StorageAdapter factory', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env = { ...prev }
  })

  it('returns UnconfiguredStorageAdapter when env missing', () => {
    delete process.env.OBJECT_STORAGE_ENDPOINT
    delete process.env.OBJECT_STORAGE_BUCKET
    delete process.env.OBJECT_STORAGE_ACCESS_KEY
    delete process.env.OBJECT_STORAGE_SECRET_KEY
    const adapter = createStorageAdapterFromEnv()
    expect(adapter).toBeInstanceOf(UnconfiguredStorageAdapter)
  })

  it('Unconfigured putStream throws 503', async () => {
    const adapter = new UnconfiguredStorageAdapter()
    await expect(
      adapter.putStream({
        key: 'users/u/assets/2026/x.png',
        body: Readable.from([Buffer.from('x')]),
        contentType: 'image/png',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @lnkpi/server test -- storage.adapter.test`

Expected: FAIL（模块不存在）

- [ ] **Step 3: Implement interface + unconfigured + factory**

```typescript
// storage.adapter.ts
export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER')

export interface StoragePutInput {
  key: string
  body: NodeJS.ReadableStream
  contentType: string
  contentLength?: number
}

export interface StorageAdapter {
  putStream(input: StoragePutInput): Promise<{ publicUrl: string }>
}
```

```typescript
// unconfigured.storage-adapter.ts
import { ServiceUnavailableException } from '@nestjs/common'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export class UnconfiguredStorageAdapter implements StorageAdapter {
  async putStream(_input: StoragePutInput): Promise<{ publicUrl: string }> {
    throw new ServiceUnavailableException(
      '对象存储未配置，无法持久化收藏。请配置 OBJECT_STORAGE_* 或稍后重试',
    )
  }
}
```

```typescript
// storage.module.ts — 初版仅返回 Unconfigured；Task 3 再接 S3
export function createStorageAdapterFromEnv(): StorageAdapter {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim()
  const accessKey = process.env.OBJECT_STORAGE_ACCESS_KEY?.trim()
  const secretKey = process.env.OBJECT_STORAGE_SECRET_KEY?.trim()
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    return new UnconfiguredStorageAdapter()
  }
  // Task 3: return new S3CompatibleStorageAdapter({...})
  return new UnconfiguredStorageAdapter()
}

@Global()
@Module({
  providers: [
    { provide: STORAGE_ADAPTER, useFactory: createStorageAdapterFromEnv },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
```

在 `app.module.ts` 加入 `StorageModule`。

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/server test -- storage.adapter.test`

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/storage/ apps/server/src/app.module.ts
git commit -m "feat(server): add StorageAdapter with unconfigured 503 fallback"
```

---

### Task 3: S3CompatibleStorageAdapter（env 齐全时启用）

**Files:**
- Create: `apps/server/src/storage/s3-compatible.storage-adapter.ts`
- Modify: `apps/server/src/storage/storage.module.ts`
- Modify: `apps/server/package.json`（加依赖）
- Modify: `apps/server/src/storage/storage.adapter.test.ts`（工厂在 env 齐全时构造 S3 类 — 可用轻量 mock 或 `instanceof`）
- Modify: 根或 `apps/server` 的 `.env.example`（若有）

**Interfaces:**
- Consumes: `OBJECT_STORAGE_ENDPOINT`, `BUCKET`, `ACCESS_KEY`, `SECRET_KEY`, `OBJECT_STORAGE_REGION?`, `OBJECT_STORAGE_PUBLIC_BASE_URL?`, `OBJECT_STORAGE_FORCE_PATH_STYLE?`
- Produces: `S3CompatibleStorageAdapter.putStream` → `{ publicUrl }`

- [ ] **Step 1: Install deps**

```bash
pnpm --filter @lnkpi/server add @aws-sdk/client-s3 @aws-sdk/lib-storage
```

- [ ] **Step 2: Implement adapter**

```typescript
import { S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export type S3CompatibleConfig = {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region?: string
  publicBaseUrl?: string
  forcePathStyle?: boolean
}

export class S3CompatibleStorageAdapter implements StorageAdapter {
  private readonly client: S3Client
  constructor(private readonly config: S3CompatibleConfig) {
    this.client = new S3Client({
      region: config.region || 'ap-guangzhou',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    })
  }

  async putStream(input: StoragePutInput): Promise<{ publicUrl: string }> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ...(input.contentLength != null ? { ContentLength: input.contentLength } : {}),
      },
    })
    await upload.done()
    const base = (this.config.publicBaseUrl || this.config.endpoint).replace(/\/$/, '')
    const publicUrl = this.config.publicBaseUrl
      ? `${base}/${input.key}`
      : `${base}/${this.config.bucket}/${input.key}`
    return { publicUrl }
  }
}
```

更新 `createStorageAdapterFromEnv`：env 齐全时 `return new S3CompatibleStorageAdapter({...})`。

- [ ] **Step 3: Extend factory test**

```typescript
it('returns S3CompatibleStorageAdapter when env complete', () => {
  process.env.OBJECT_STORAGE_ENDPOINT = 'https://cos.example'
  process.env.OBJECT_STORAGE_BUCKET = 'b'
  process.env.OBJECT_STORAGE_ACCESS_KEY = 'ak'
  process.env.OBJECT_STORAGE_SECRET_KEY = 'sk'
  const adapter = createStorageAdapterFromEnv()
  expect(adapter.constructor.name).toBe('S3CompatibleStorageAdapter')
})
```

- [ ] **Step 4: Run tests + commit**

Run: `pnpm --filter @lnkpi/server test -- storage.adapter.test`

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/storage/
git commit -m "feat(server): S3-compatible StorageAdapter for COS persist"
```

---

### Task 4: 扩展 UserAsset metadata 类型

**Files:**
- Modify: `apps/server/src/assets/build-user-asset-metadata.ts`
- Modify: `apps/server/src/assets/build-user-asset-metadata.test.ts`

**Interfaces:**
- Produces: `UserAssetMetadata.storageTier?`, `upstreamUrl?`, `objectKey?`
- Produces: `mergeUserAssetMetadata(raw, patch)`

- [ ] **Step 1: Failing test for merge + tiers**

```typescript
it('mergeUserAssetMetadata sets storageTier persisted and keeps upstreamUrl', () => {
  const merged = mergeUserAssetMetadata(null, {
    storageTier: 'persisted',
    upstreamUrl: 'https://cdn.example/a.png',
    objectKey: 'users/u/assets/2026/x.png',
  })
  expect(merged.storageTier).toBe('persisted')
  expect(merged.upstreamUrl).toContain('cdn.example')
})
```

- [ ] **Step 2: Implement types + merge helper**

```typescript
export type StorageTier = 'upstream' | 'upload' | 'persisted'

export interface UserAssetMetadata {
  // ...existing fields...
  storageTier?: StorageTier
  upstreamUrl?: string
  objectKey?: string
}

export function mergeUserAssetMetadata(
  raw: string | null | undefined,
  patch: Partial<UserAssetMetadata>,
): UserAssetMetadata {
  return { ...parseUserAssetMetadata(raw), ...patch }
}
```

- [ ] **Step 3: Pass tests + commit**

```bash
git commit -m "feat(server): extend UserAsset metadata for storage tier"
```

---

### Task 5: PersistRemoteService（核心）

**Files:**
- Create: `apps/server/src/assets/persist-remote.service.ts`
- Create: `apps/server/src/assets/persist-remote.service.test.ts`
- Modify: `apps/server/src/media/media.module.ts` — `exports: [MediaService]`
- Modify: `apps/server/src/assets/assets.module.ts` — providers + imports

**Interfaces:**
- Consumes: `MediaService.resolveDownloadSource`, `openDownloadStream`, `STORAGE_ADAPTER`
- Produces:

```typescript
persistRemote(input: {
  userId: string
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
  sessionId?: string
  sourceNodeId?: string
  replaceNodeUrl?: boolean
  generationRecordId?: string
}): Promise<{ persistedUrl: string; assetId: string; storageTier: 'persisted' | 'upload' }>
```

- [ ] **Step 1: Write failing tests（mock MediaService + Adapter）**

```typescript
describe('PersistRemoteService', () => {
  it('skips object storage for /api/uploads/ and upserts as upload tier', async () => {
    // url = `/api/uploads/${userId}/a.png` → no putStream call; storageTier upload
  })

  it('streams remote url through adapter and upserts persisted', async () => {
    // mock resolveDownloadSource remote + putStream returns https://cos/.../key
    // expect metadata.upstreamUrl + storageTier persisted
  })

  it('propagates 503 when adapter unconfigured', async () => {
    // adapter throws ServiceUnavailableException
  })

  it('replaceNodeUrl=true rewrites matching node data.url in session canvasData', async () => {
    // prisma session update
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/server test -- persist-remote.service.test`

- [ ] **Step 3: Implement PersistRemoteService**

关键逻辑：

1. 若 `parseUploadRefPath` 命中且属主 → 直接 upsert `UserAsset`（`storageTier: 'upload'`），**不**调 Adapter；返回 `storageTier: 'upload'`，`persistedUrl` 用原 upload URL（字段名保持响应契约：`persistedUrl` 填稳定 URL）。  
2. 否则 `resolveDownloadSource` → `openDownloadStream` → 生成 key  
   `users/{userId}/assets/{yyyy}/{cuid}{ext}` → `adapter.putStream`。  
3. upsert `UserAsset`：`url = publicUrl`；metadata = merge(..., `{ storageTier: 'persisted', upstreamUrl: original, objectKey }`)。  
4. 若库中存在 **同一 upstreamUrl** 的旧行（`url === original`），删除或更新以免双份（优先：`deleteMany` where userId + url === original，再 create persisted）。  
5. `replaceNodeUrl`：加载 session（须归属 userId），解析 `canvasData.nodes`，匹配 `sourceNodeId`，写 `data.url = publicUrl`，可选 `data.upstreamUrl` / `data.storageTier`，`prisma.session.update`。

- [ ] **Step 4: Pass tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(server): PersistRemoteService for asset library rehost"
```

---

### Task 6: HTTP `POST /api/assets/persist-remote`

**Files:**
- Modify: `apps/server/src/assets/assets.controller.ts`
- Modify: `apps/server/src/assets/assets.module.ts`（Inject PersistRemoteService；import MediaModule + StorageModule）

**Interfaces:**
- Produces: `POST /api/assets/persist-remote` body 对齐规格 §4

- [ ] **Step 1: Add DTO + endpoint**

```typescript
class PersistRemoteDto {
  @IsString() @MaxLength(4096) url!: string
  @IsIn(['image', 'video', 'audio']) kind!: 'image' | 'video' | 'audio'
  @IsOptional() @IsString() @MaxLength(128) label?: string
  @IsOptional() @IsString() @MaxLength(64) sessionId?: string
  @IsOptional() @IsString() @MaxLength(64) sourceNodeId?: string
  @IsOptional() @IsString() @MaxLength(64) nodeId?: string // alias → sourceNodeId
  @IsOptional() @IsBoolean() replaceNodeUrl?: boolean
  @IsOptional() @IsString() @MaxLength(64) generationRecordId?: string
}

@Post('persist-remote')
@UseGuards(AuthGuard)
async persistRemote(@Req() req: AuthedRequest, @Body() dto: PersistRemoteDto) {
  const data = await this.persistRemoteService.persistRemote({
    userId: req.user.sub,
    url: dto.url,
    kind: dto.kind,
    label: dto.label,
    sessionId: dto.sessionId,
    sourceNodeId: dto.sourceNodeId ?? dto.nodeId,
    replaceNodeUrl: dto.replaceNodeUrl ?? false,
    generationRecordId: dto.generationRecordId,
  })
  return { code: 0, message: 'ok', data }
}
```

`AssetsController` 构造注入 `PersistRemoteService`；`AssetsModule` imports: `MediaModule`,（Storage 已 Global 则可省略）。

- [ ] **Step 2: 手工或 e2e：未配置 Adapter 时 POST 返回 503**

可用 vitest + TestingModule 调 controller，或 curl 本地。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(server): POST /api/assets/persist-remote endpoint"
```

---

### Task 7: 前端 `saveAssetToLibrary` 接线

**Files:**
- Modify: `apps/web/src/services/assets-api.ts`
- Modify: `apps/web/src/composables/useAssetLibrary.ts`
- Create: `apps/web/src/composables/useAssetLibrary.test.ts`
- Modify: 调用方无需改（仍调 `saveAssetToLibrary`）— 可选传入 `sessionId`：扩展 payload

**Interfaces:**
- Produces: `assetsApi.persistRemote(payload)`
- Produces: `SaveUserAssetPayload.sessionId?`, `replaceNodeUrl?`

- [ ] **Step 1: Failing frontend tests**

```typescript
import { saveAssetToLibrary } from './useAssetLibrary'
import { assetsApi } from '@/services/assets-api'
import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/services/assets-api', () => ({
  assetsApi: {
    persistRemote: vi.fn(),
    saveMine: vi.fn(),
  },
}))

describe('saveAssetToLibrary', () => {
  beforeEach(() => {
    localStorage.setItem('token', 't')
    vi.mocked(assetsApi.persistRemote).mockReset()
    vi.mocked(assetsApi.saveMine).mockReset()
  })

  it('persists upstream https urls', async () => {
    vi.mocked(assetsApi.persistRemote).mockResolvedValue({
      data: { persistedUrl: 'https://cos/x', assetId: 'a1', storageTier: 'persisted' },
    } as never)
    await saveAssetToLibrary({ kind: 'image', url: 'https://cdn.example/a.png', label: 'a' })
    expect(assetsApi.persistRemote).toHaveBeenCalled()
    expect(assetsApi.saveMine).not.toHaveBeenCalled()
  })

  it('saveMine directly for /api/uploads/', async () => {
    vi.mocked(assetsApi.saveMine).mockResolvedValue({ data: {} } as never)
    await saveAssetToLibrary({ kind: 'image', url: '/api/uploads/u/a.png' })
    expect(assetsApi.saveMine).toHaveBeenCalled()
    expect(assetsApi.persistRemote).not.toHaveBeenCalled()
  })
})
```

（按项目 `api.post` 实际返回形状微调 mock。）

- [ ] **Step 2: Implement API + composable**

```typescript
// assets-api.ts
persistRemote: (payload: PersistRemotePayload) =>
  api.post<{ code: number; data: { persistedUrl: string; assetId: string; storageTier: string } }>(
    '/assets/persist-remote',
    payload,
  ),
```

```typescript
// useAssetLibrary.ts
import { isUpstreamMediaUrl } from '@/composables/useCanvasMedia'

export async function saveAssetToLibrary(payload: SaveUserAssetPayload & { sessionId?: string; replaceNodeUrl?: boolean }) {
  // ... token + blob checks ...
  try {
    if (isUpstreamMediaUrl(payload.url)) {
      await assetsApi.persistRemote({
        url: payload.url,
        kind: payload.kind,
        label: payload.label,
        sourceNodeId: payload.sourceNodeId,
        sessionId: payload.sessionId,
        replaceNodeUrl: payload.replaceNodeUrl,
        generationRecordId: payload.generationRecordId,
      })
    } else {
      await assetsApi.saveMine(payload)
    }
    bumpAssetLibrary()
    ElMessage.success('已存入资产库')
    return true
  } catch (e) {
    // 若能读到 503，提示「对象存储未配置…」
    ElMessage.error('保存失败，请稍后重试')
    return false
  }
}
```

画布节点调用处：若易拿到 `sessionId`，传入（如 `CanvasPage` / 节点 props）；没有则省略（归属扫描全用户 session，与下载一致）。

- [ ] **Step 3: Run web tests**

Run: `pnpm --filter @lnkpi/web test -- useAssetLibrary`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): persist upstream assets via persist-remote on save"
```

---

### Task 8: Agent `saveNodeToAssetLibrary` 同路径

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: Agent 所在 Module（注入 `PersistRemoteService`）
- Test: 扩展或新增 `agent-canvas-tools` 相关测（若已有 save 测则改期望 url 为 persisted）

**Interfaces:**
- Consumes: `PersistRemoteService.persistRemote`
- Produces: `{ assetId, url: persistedUrl, kind }`

- [ ] **Step 1: Replace prisma upsert block**

```typescript
async saveNodeToAssetLibrary(input: {...}) {
  await this.loadOwnedSession(input.sessionId, input.userId)
  const node = await this.getNode({ sessionId: input.sessionId, nodeId: input.nodeId })
  const kind = assetKindFromNodeType(String(node.type ?? ''))
  const url = String(node.data?.url ?? '').trim()
  if (!kind || !url) throw new BadRequestException('节点缺少可保存的媒体 URL')

  const result = await this.persistRemote.persistRemote({
    userId: input.userId,
    url,
    kind,
    label: input.label?.trim() || nodeTitle(node) || node.id,
    sessionId: input.sessionId,
    sourceNodeId: node.id,
    replaceNodeUrl: false,
  })
  return { assetId: result.assetId, url: result.persistedUrl, kind }
}
```

- [ ] **Step 2: 未配置 Adapter 时 tool 应返回错误（503）而非写入 upstream**

加测或手工 verify。

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(server): agent save_node_to_asset_library uses persist-remote"
```

---

### Task 9: 文档 / env 与规格勾选

**Files:**
- Modify: `.env.example` 或 `apps/server/.env.example`（若仓库有）
- Modify: `docs/superpowers/specs/2026-09-10-wave-a-a3-media-persist-design.md` 修订记录（实现完成日）
- Optional: `deploy/prod-media-persist-verify.py` smoke（登录 → persist-remote → assert storageTier）

- [ ] **Step 1: Document env**

```bash
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
OBJECT_STORAGE_REGION=ap-guangzhou
OBJECT_STORAGE_PUBLIC_BASE_URL=
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

- [ ] **Step 2: PR 前验证**

```bash
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/web test
pnpm --filter @lnkpi/server test
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: OBJECT_STORAGE env for Wave A A3 persist"
```

---

## Spec coverage self-check

| Spec 要求 | Task |
| --- | --- |
| P0 stream-download 补洞 / Inspector hint | Task 1 |
| StorageAdapter + 未配置 503 | Task 2–3 |
| metadata storageTier / upstreamUrl | Task 4 |
| persist-remote 拉流不落盘 | Task 5 |
| POST /api/assets/persist-remote | Task 6 |
| saveAssetToLibrary upstream→persist | Task 7 |
| Agent 同路径 | Task 8 |
| 默认不 rehost 生成物 | Global + Task 5 skip 自动路径 |
| A1 复用 Adapter | Task 2–3 接口预留 |
| uploads 跳过转存 | Task 5 / 7 |
| 200MB | 复用 MediaService |

## Out of scope（本 plan 不做）

- A2 真 ZIP 流式打包（下个规格）
- A1 OSS STS 直传
- 生成即 COS（P3）
- worldModel / 对外 Skill

## Placeholder scan

无 TBD /「类似 Task N」占位；S3 SDK 包名与 env 键已写死。

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-10-wave-a-a3-media-persist.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 新开 subagent，任务间审查，迭代快  
2. **Inline Execution** — 本会话用 executing-plans 按 Task 推进并设检查点  

**Which approach?**
