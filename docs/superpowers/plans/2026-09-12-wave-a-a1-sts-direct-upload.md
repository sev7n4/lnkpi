# Wave A · A1 PR1 直传（Presigned PUT）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** COS 已配置时，浏览器经预签名 PUT 直传对象存储；未配置时保持现有 `POST /upload`（含分片）兜底；统一前端 `uploadApi`；capabilities 暴露 `stsDirectUpload`。

**Architecture:** 扩展 `StorageAdapter` 可选 `presignPut`；仅 `S3CompatibleStorageAdapter` 实现。`DirectUploadService` 签发凭证或返回 `mode=local`。前端先问凭证再 PUT 或走旧路径。复用 A3 的 `OBJECT_STORAGE_*` env，不平行发明第二套配置。

**Tech Stack:** NestJS、Vitest、`@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`、现有 `upload-api.ts`

**Spec:** [docs/superpowers/specs/2026-09-12-wave-a-a1-sts-upscale-design.md](../specs/2026-09-12-wave-a-a1-sts-upscale-design.md) §4  
**Program:** [docs/superpowers/specs/2026-09-10-wave-a-delivery-program-design.md](../specs/2026-09-10-wave-a-delivery-program-design.md)  
**Follow-up:** [2026-09-12-wave-a-a1-upscale.md](./2026-09-12-wave-a-a1-upscale.md)（PR2，本计划完成后另开）

## Global Constraints

- 直传形态 = **预签名 PUT**；禁止向浏览器下发完整 STS 临时 AK/SK/Token。
- Key 必须 `uploads/{userId}/...`；禁止客户端自选任意 key。
- 单文件上限 **50MB**（与现网 `UploadService` 一致）。
- 预签名 TTL：**10 分钟**（规格 5–15 中值）。
- 无 COS → `mode=local`，现有 upload 路径不得回归失败。
- Commit per task；勿 `git add -A`；勿提交 `deploy/prod-workflow-exchange-verify.py` 等无关文件。
- PR 前：`pnpm build`；相关 vitest 全绿。

## File map

| File | Role |
| --- | --- |
| `apps/server/package.json` | 增加 `@aws-sdk/s3-request-presigner` |
| `apps/server/src/storage/storage.adapter.ts` | 可选 `presignPut` + 类型 |
| `apps/server/src/storage/s3-compatible.storage-adapter.ts` | 实现 `presignPut` + `publicUrlForKey` |
| `apps/server/src/storage/s3-compatible.storage-adapter.test.ts` | 单测（mock S3 / 或测 URL 拼装 + 调用签名） |
| `apps/server/src/storage/object-storage-env.ts` | `isObjectStorageConfigured()` 纯函数（从 module 抽出便于测） |
| `apps/server/src/storage/storage.module.ts` | 复用 env helper |
| `apps/server/src/upload/direct-upload.service.ts` | 签发 / local 双轨 |
| `apps/server/src/upload/direct-upload.service.test.ts` | 核心单测 |
| `apps/server/src/upload/upload.controller.ts` | `POST /upload/direct-credential` |
| `apps/server/src/upload/upload.module.ts` | 注册 DirectUploadService；import StorageModule |
| `apps/server/src/agent/agent.service.ts` | `getCapabilities` 增加 `stsDirectUpload` |
| `apps/server/src/agent/agent.service.capabilities.test.ts`（或现有测） | 断言 flag |
| `apps/web/src/services/upload-api.ts` | presign 优先 |
| `apps/web/src/services/upload-api.test.ts` | 扩展单测 |
| `.env.example`（若存在） | 注明直传复用 `OBJECT_STORAGE_*` |

---

### Task 1: StorageAdapter.presignPut + S3 实现

**Files:**
- Modify: `apps/server/package.json`
- Modify: `apps/server/src/storage/storage.adapter.ts`
- Modify: `apps/server/src/storage/s3-compatible.storage-adapter.ts`
- Create: `apps/server/src/storage/s3-compatible.storage-adapter.presign.test.ts`
- Create: `apps/server/src/storage/object-storage-env.ts`
- Modify: `apps/server/src/storage/storage.module.ts`

**Interfaces:**
- Produces:
  - `StoragePresignPutInput`: `{ key: string; contentType: string; expiresInSeconds: number }`
  - `StoragePresignPutResult`: `{ putUrl: string; headers: Record<string, string>; publicUrl: string; expiresAt: string }`
  - `StorageAdapter.presignPut?(input: StoragePresignPutInput): Promise<StoragePresignPutResult>`
  - `isObjectStorageConfigured(): boolean`（读 `OBJECT_STORAGE_*` / `DRIVER=none`）

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @lnkpi/server add @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: 扩展 adapter 类型**

在 `storage.adapter.ts` 增加上述类型，并在 `StorageAdapter` 上声明可选 `presignPut?`。

- [ ] **Step 3: 抽出 `isObjectStorageConfigured`**

`object-storage-env.ts`：与 `createStorageAdapterFromEnv` 相同判定（`DRIVER=none` → false；四件套齐全 → true）。`storage.module.ts` 调用该函数。

- [ ] **Step 4: 写失败单测（publicUrl 拼装 + presign 调用 PutObjectCommand）**

```ts
import { describe, expect, it, vi } from 'vitest'
import { S3CompatibleStorageAdapter } from './s3-compatible.storage-adapter'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.example/put'),
}))

describe('S3CompatibleStorageAdapter.presignPut', () => {
  it('returns putUrl, Content-Type header, and publicUrl', async () => {
    const adapter = new S3CompatibleStorageAdapter({
      endpoint: 'https://cos.example',
      bucket: 'b',
      accessKeyId: 'ak',
      secretAccessKey: 'sk',
      publicBaseUrl: 'https://cdn.example',
    })
    const out = await adapter.presignPut!({
      key: 'uploads/u1/a.png',
      contentType: 'image/png',
      expiresInSeconds: 600,
    })
    expect(out.putUrl).toBe('https://signed.example/put')
    expect(out.headers['Content-Type']).toBe('image/png')
    expect(out.publicUrl).toBe('https://cdn.example/uploads/u1/a.png')
    expect(Date.parse(out.expiresAt)).toBeGreaterThan(Date.now())
  })
})
```

Run: `pnpm --filter @lnkpi/server exec vitest run src/storage/s3-compatible.storage-adapter.presign.test.ts`  
Expected: FAIL（无 `presignPut`）

- [ ] **Step 5: 实现 `presignPut`**

使用 `PutObjectCommand` + `getSignedUrl(client, command, { expiresIn })`；`headers` 至少含 `Content-Type`；`publicUrl` 与 `putStream` 同一拼装规则（抽私有 `buildPublicUrl(key)`）。

- [ ] **Step 6: 再跑单测 — PASS**

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json apps/server/pnpm-lock.yaml \
  apps/server/src/storage/storage.adapter.ts \
  apps/server/src/storage/s3-compatible.storage-adapter.ts \
  apps/server/src/storage/s3-compatible.storage-adapter.presign.test.ts \
  apps/server/src/storage/object-storage-env.ts \
  apps/server/src/storage/storage.module.ts
# 若 lockfile 在仓库根：一并 add pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(storage): add S3 presignPut for direct browser upload

EOF
)"
```

---

### Task 2: DirectUploadService + POST /upload/direct-credential

**Files:**
- Create: `apps/server/src/upload/direct-upload.service.ts`
- Create: `apps/server/src/upload/direct-upload.service.test.ts`
- Modify: `apps/server/src/upload/upload.controller.ts`
- Modify: `apps/server/src/upload/upload.module.ts`

**Interfaces:**
- Consumes: `STORAGE_ADAPTER`, `isObjectStorageConfigured`, `presignPut`
- Produces:
  - `DirectUploadService.createCredential(userId, { fileName, mimeType, size })`
  - 返回联合类型：
    - `{ mode: 'presign'; key; putUrl; headers; expiresAt; publicUrl }`
    - `{ mode: 'local' }`

- [ ] **Step 1: 写失败单测**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { DirectUploadService } from './direct-upload.service'

describe('DirectUploadService', () => {
  const presignPut = vi.fn()
  let svc: DirectUploadService

  beforeEach(() => {
    presignPut.mockReset()
    svc = new DirectUploadService(
      { presignPut } as any,
      () => true, // isConfigured
    )
  })

  it('rejects oversize', async () => {
    await expect(
      svc.createCredential('u1', {
        fileName: 'a.png',
        mimeType: 'image/png',
        size: 51 * 1024 * 1024,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('returns local when storage not configured', async () => {
    svc = new DirectUploadService({} as any, () => false)
    await expect(
      svc.createCredential('u1', { fileName: 'a.png', mimeType: 'image/png', size: 10 }),
    ).resolves.toEqual({ mode: 'local' })
  })

  it('presigns with user-scoped key', async () => {
    presignPut.mockResolvedValue({
      putUrl: 'https://put',
      headers: { 'Content-Type': 'image/png' },
      publicUrl: 'https://cdn/x',
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })
    const out = await svc.createCredential('user-42', {
      fileName: 'shot.PNG',
      mimeType: 'image/png',
      size: 100,
    })
    expect(out.mode).toBe('presign')
    if (out.mode === 'presign') {
      expect(out.key.startsWith('uploads/user-42/')).toBe(true)
      expect(out.key.endsWith('.png') || out.key.endsWith('.PNG')).toBe(true)
      expect(out.putUrl).toBe('https://put')
    }
    expect(presignPut).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/png', expiresInSeconds: 600 }),
    )
  })
})
```

Run: `pnpm --filter @lnkpi/server exec vitest run src/upload/direct-upload.service.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现 DirectUploadService**

Key 格式：`uploads/{userId}/{yyyy}/{mm}/{dd}/{timestamp}-{uuid8}{ext}`（`ext` 来自 `fileName` 或 mime；sanitize 长度 ≤12）。  
若 `!isConfigured()` 或 adapter 无 `presignPut` → `{ mode: 'local' }`。  
否则调用 `presignPut`，原样返回字段 + `mode: 'presign'`。

构造注入：`@Inject(STORAGE_ADAPTER) adapter`，`isObjectStorageConfigured` 可作为构造参数或内部 import（测试用可注入函数）。

- [ ] **Step 3: Controller 路由**

```ts
@Post('direct-credential')
@UseGuards(AuthGuard)
async directCredential(@Req() req: { user: { sub: string } }, @Body() dto: DirectCredentialDto) {
  const data = await this.directUpload.createCredential(req.user.sub, {
    fileName: dto.fileName,
    mimeType: dto.mimeType || 'application/octet-stream',
    size: dto.size,
  })
  return { code: 0, message: 'ok', data }
}
```

DTO：`fileName` string、`mimeType?` string、`size` int Min(1)。

- [ ] **Step 4: Module 注册** — `UploadModule` import `StorageModule`，providers 加 `DirectUploadService`。

- [ ] **Step 5: 单测 PASS**

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(upload): add direct-credential endpoint for presigned PUT

EOF
)"
```

---

### Task 3: capabilities.stsDirectUpload

**Files:**
- Modify: `apps/server/src/agent/agent.service.ts`
- Create or modify: `apps/server/src/agent/agent.service.capabilities.test.ts`

**Interfaces:**
- Produces: `getCapabilities()` 增加 `stsDirectUpload: boolean`（= `isObjectStorageConfigured()`）

- [ ] **Step 1: 测试**

```ts
it('exposes stsDirectUpload from object storage env', () => {
  // mock isObjectStorageConfigured 或设 env 后 new AgentService(...)
  expect(svc.getCapabilities()).toEqual(
    expect.objectContaining({ stsDirectUpload: expect.any(Boolean) }),
  )
})
```

- [ ] **Step 2: 实现并 PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): expose stsDirectUpload capability flag

EOF
)"
```

---

### Task 4: 前端 uploadApi 走直传

**Files:**
- Modify: `apps/web/src/services/upload-api.ts`
- Modify: `apps/web/src/services/upload-api.test.ts`

**Interfaces:**
- Consumes: `POST /upload/direct-credential`
- Produces: `uploadApi.upload` 行为不变（返回 `UploadResult`），内部增加 presign 分支

- [ ] **Step 1: 扩展单测**

在现有 `upload-api.test.ts` 增加：

```ts
it('PUTs to putUrl when credential mode is presign', async () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  // mock api.post('/upload/direct-credential') → mode presign
  // mock 不调用 /upload
  const result = await uploadApi.upload(new File([new Uint8Array([1,2,3])], 'a.png', { type: 'image/png' }))
  expect(result.url).toBe('https://cdn.example/uploads/u/a.png')
  expect(fetchMock).toHaveBeenCalledWith(
    'https://signed.example/put',
    expect.objectContaining({
      method: 'PUT',
      headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
    }),
  )
})

it('falls back to multipart when mode is local', async () => {
  // credential → { mode: 'local' }；随后现有 multipart mock
})
```

（按项目现有 `api` mock 风格改写；若 `api` 难 mock，可导出内部 `uploadViaPresign` 单测。）

Run: `pnpm --filter @lnkpi/web exec vitest run src/services/upload-api.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现**

```ts
async function uploadViaDirectOrLegacy(file: File, opts?: { onProgress?: (pct: number) => void }) {
  const { data: credRes } = await api.post<{ code?: number; data: DirectCred }>('/upload/direct-credential', {
    fileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  })
  const cred = credRes.data
  if (cred.mode === 'presign') {
    const res = await fetch(cred.putUrl, {
      method: 'PUT',
      headers: cred.headers,
      body: file,
    })
    if (!res.ok) throw new Error(`直传失败 HTTP ${res.status}`)
    opts?.onProgress?.(100)
    return {
      url: cred.publicUrl,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    }
  }
  // mode=local：保留现有 shouldPreferChunkedUpload / multipart / chunked
  ...
}
```

PUT 失败：可 **再要一次凭证重试 1 次**；仍失败则抛错。

- [ ] **Step 3: 单测 PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): route uploads through presigned PUT when available

EOF
)"
```

---

### Task 5: PR 收口

- [ ] **Step 1: 本地验证**

```bash
pnpm --filter @lnkpi/server exec prisma generate
pnpm --filter @lnkpi/server exec vitest run src/storage/s3-compatible.storage-adapter.presign.test.ts src/upload/direct-upload.service.test.ts
pnpm --filter @lnkpi/web exec vitest run src/services/upload-api.test.ts
pnpm build
```

Expected: 全绿。

- [ ] **Step 2: 开 PR**（`feature/a1-sts-direct-upload`）

Body 引用规格 §4；Test plan 含：COS 环境 Network 可见 PUT；无 COS 仍得 `/api/uploads/...`。

- [ ] **Step 3: 更新 tracking（可选同 PR）**

`docs/DOCK_STUDIO_E2E_TRACKING.md`：B-4 标为「直传 Presigned PUT 已做 / 本地兜底」。

---

## Spec coverage (PR1)

| Spec § | Task |
|--------|------|
| 4.1 双轨 | T2 |
| 4.2 API | T2 |
| 4.3 Key / TTL | T2 |
| 4.4 前端 | T4 |
| 4.5 capabilities | T3 |
| 4.6 安全 | T1–T2 测试 |
| Upscale / UI | **不在本计划** → PR2 |
