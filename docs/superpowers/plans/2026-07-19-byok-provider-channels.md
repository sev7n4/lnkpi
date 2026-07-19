# BYOK Provider Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 100% 复刻 infinite-canvas v0.4.0 配置弹窗（渠道/模型/生成偏好/WebDAV），密钥 AES-256-GCM 服务端加密存储，生成经服务端代理；Dock 仅展示用户「可选模型」；BYOK 失败进入 `fallback_pending` 并二次确认后才回退平台 `.env`。

**Architecture:** 平台只读渠道 + 用户私有渠道；模型值 `channelId::modelName`；`ProviderResolver` 注入凭据到现有 Studio/Material 生成链；WebDAV 凭据同等加密并由服务端代理 test/sync。

**Tech Stack:** NestJS、Prisma (SQLite `db push`)、Vitest、Vue 3、`@lnkpi/shared`、`@lnkpi/agent` providers

**Spec:** `docs/superpowers/specs/2026-07-19-byok-provider-channels-design.md`

## Global Constraints

- UI 基准：**Vercel v0.4.0** 四 Tab；不实现调用脚本 / 提示词来源 / v0.8+ Drawer
- 加密：AES-256-GCM；主密钥 `BYOK_ENCRYPTION_KEY_V1`；GET **永不**返回明文密钥
- Dock 下拉唯一来源：用户「可选模型」；Catalog+`.env` 仅构成平台候选池
- BYOK 失败：**不静默**回退；文案固定「自定义渠道失败，已切换平台服务，可能会有额外费用，是否继续？」
- 文本/图片/视频/音频 + Studio/Canvas Material **行为一致**
- Base URL SSRF 防护；跨用户渠道 404
- 分支 `feature/byok-provider-channels`；任务提交前相关包测试绿；合入前 `pnpm build && pnpm test`

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `packages/shared/src/providerChannels.ts` | `encodeChannelModel` / `decodeChannelModel` / 能力类型 |
| `apps/server/prisma/schema.prisma` | ProviderChannel / UserAiPreferences / UserWebdavConfig |
| `apps/server/src/provider/crypto.service.ts` | AES-GCM 加解密 |
| `apps/server/src/provider/ssrf.ts` | Base URL 校验 |
| `apps/server/src/provider/provider.service.ts` | bootstrap / channels / preferences / webdav |
| `apps/server/src/provider/provider-resolver.service.ts` | 解析渠道模型 + 凭据 |
| `apps/server/src/provider/provider.controller.ts` | HTTP API |
| `apps/server/src/provider/provider.module.ts` | Nest 模块 |
| `packages/agent/src/tools/*-provider.ts` | `create*Provider(opts?)` 显式凭据 |
| `apps/server/src/studio/studio.service.ts` | 注入 Resolver；fallback_pending |
| `apps/server/src/canvas/material.service.ts` | 同上 |
| `apps/web/src/services/provider-api.ts` | 前端 API |
| `apps/web/src/composables/useProviderBootstrap.ts` | bootstrap 状态 |
| `apps/web/src/components/canvas/ProviderConfigDialog.vue` | v0.4.0 四 Tab UI |
| `apps/web/src/components/canvas/UniversalModelSelector.vue` | 可选项驱动 |
| `apps/web/src/composables/useNodeGeneration.ts` | 传 `channelId::model`；回退确认 |
| `docs/DOCK_STUDIO_E2E_TRACKING.md` | BYOK 验收章节 |
| `.env.example` / `deploy/.env.production.example` | `BYOK_ENCRYPTION_KEY_V1` |

废弃：`useModelProviderSettings.ts` localStorage 方案（删除或改为 thin wrapper 调 API，禁止存明文 key）。

---

### Task 1: Shared channel model encoding

**Files:**
- Create: `packages/shared/src/providerChannels.ts`
- Create: `packages/shared/src/providerChannels.test.ts`
- Modify: `packages/shared/src/index.ts`（re-export）

**Interfaces:**
- Produces:
  ```ts
  export type ModelCapability = 'text' | 'image' | 'video' | 'audio'
  export type ApiCallFormat = 'openai' | 'gemini'
  export const CHANNEL_MODEL_SEPARATOR = '::'
  export function encodeChannelModel(channelId: string, modelName: string): string
  export function decodeChannelModel(value: string): { channelId: string; modelName: string } | null
  export function modelOptionName(value: string): string
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import { encodeChannelModel, decodeChannelModel, modelOptionName } from './providerChannels'

describe('providerChannels', () => {
  it('round-trips channel::model', () => {
    const v = encodeChannelModel('platform', 'seedream-5.0-pro')
    expect(v).toBe('platform::seedream-5.0-pro')
    expect(decodeChannelModel(v)).toEqual({ channelId: 'platform', modelName: 'seedream-5.0-pro' })
    expect(modelOptionName(v)).toBe('seedream-5.0-pro')
  })

  it('returns null for legacy bare model keys', () => {
    expect(decodeChannelModel('seedream-5.0-pro')).toBeNull()
    expect(modelOptionName('seedream-5.0-pro')).toBe('seedream-5.0-pro')
  })
})
```

- [ ] **Step 2: Run FAIL**

```bash
pnpm --filter @lnkpi/shared test -- src/providerChannels.test.ts
```

Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现并 PASS + Commit**

```bash
pnpm --filter @lnkpi/shared test -- src/providerChannels.test.ts
pnpm --filter @lnkpi/shared build
git add packages/shared/src/providerChannels.ts packages/shared/src/providerChannels.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add channelId::model encoding helpers"
```

---

### Task 2: CryptoService + SSRF helper

**Files:**
- Create: `apps/server/src/provider/crypto.service.ts`
- Create: `apps/server/src/provider/crypto.service.test.ts`
- Create: `apps/server/src/provider/ssrf.ts`
- Create: `apps/server/src/provider/ssrf.test.ts`
- Modify: `.env.example`、`deploy/.env.production.example`（增加 `BYOK_ENCRYPTION_KEY_V1=` 说明：32+ 字节随机，base64）

**Interfaces:**
- Produces:
  ```ts
  class CryptoService {
    encrypt(plaintext: string): { ciphertext: string; iv: string; authTag: string; keyVersion: number }
    decrypt(parts: { ciphertext: string; iv: string; authTag: string; keyVersion: number }): string
  }
  function assertSafeOutboundUrl(url: string, opts?: { allowHttpLocalhost?: boolean }): URL
  ```

- [ ] **Step 1: Crypto 测试**

```ts
it('round-trips plaintext', () => {
  process.env.BYOK_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
  const crypto = new CryptoService()
  const enc = crypto.encrypt('sk-test')
  expect(crypto.decrypt(enc)).toBe('sk-test')
})

it('rejects missing key', () => {
  delete process.env.BYOK_ENCRYPTION_KEY_V1
  expect(() => new CryptoService()).toThrow(/BYOK_ENCRYPTION_KEY_V1/)
})
```

SSRF：拒绝 `http://127.0.0.1`、`http://169.254.169.254`、非 http(s)；允许 `https://api.openai.com`；`allowHttpLocalhost` 时允许 `http://localhost:3000`。

- [ ] **Step 2: 实现 AES-256-GCM（Node `crypto`）**

- key：`Buffer.from(process.env.BYOK_ENCRYPTION_KEY_V1, 'base64')`，长度必须 32
- `keyVersion` 固定返回 `1`
- ciphertext/iv/authTag 存 base64

- [ ] **Step 3: PASS + Commit**

```bash
pnpm --filter @lnkpi/server test -- src/provider/crypto.service.test.ts src/provider/ssrf.test.ts
git add apps/server/src/provider .env.example deploy/.env.production.example
git commit -m "feat(server): add BYOK AES-GCM crypto and SSRF URL guard"
```

---

### Task 3: Prisma models + ProviderService bootstrap/channels/preferences

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/src/provider/provider.service.ts`
- Create: `apps/server/src/provider/provider.service.test.ts`
- Create: `apps/server/src/provider/provider.controller.ts`
- Create: `apps/server/src/provider/provider.module.ts`
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/auth/auth.guard.ts` 所保护的路由挂载方式（与现有 Controller 一致）

**Interfaces:**
- Schema 按规格 §4：`ProviderChannel`、`UserAiPreferences`、`UserWebdavConfig`；`User` 增加 relations
- `bootstrap(userId)` → `{ platformChannel, channels[], preferences, webdav }`（密钥仅 `hasApiKey` + mask）
- 平台渠道 id 固定 `platform`；首次 bootstrap 时若无则从 `STUDIO_MODEL_CATALOG` 种子化
- 新用户偏好：可选项 = `platform::` + catalog；默认 = `platform::` + `defaultModelKey(modality)`
- Channel CRUD：不可改删 `platform`；`apiKey` 空=保留；`clearApiKey: true`=清除

- [ ] **Step 1: 更新 schema 后**

```bash
pnpm --filter @lnkpi/server exec prisma generate
pnpm --filter @lnkpi/server exec prisma db push
```

- [ ] **Step 2: 测试 bootstrap 种子平台渠道 + 用户偏好默认**

```ts
it('bootstraps platform channel from catalog and default preferences', async () => {
  const result = await svc.bootstrap('u1')
  expect(result.platformChannel.id).toBe('platform')
  expect(result.preferences.defaultImageModel).toBe('platform::seedream-5.0-pro')
  expect(result.platformChannel.hasApiKey).toBe(false)
})

it('stores encrypted apiKey and never returns plaintext', async () => {
  await svc.createChannel('u1', { name: 'mine', apiFormat: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-secret', models: [] })
  const boot = await svc.bootstrap('u1')
  const ch = boot.channels.find((c) => c.name === 'mine')!
  expect(ch.hasApiKey).toBe(true)
  expect(JSON.stringify(boot)).not.toContain('sk-secret')
})
```

- [ ] **Step 3: 实现 Controller 路由（规格 §5）+ Commit**

```bash
pnpm --filter @lnkpi/server test -- src/provider/
git add apps/server/prisma/schema.prisma apps/server/src/provider apps/server/src/app.module.ts
git commit -m "feat(server): provider channels bootstrap and preferences APIs"
```

---

### Task 4: create*Provider 接受显式凭据 + ProviderResolver

**Files:**
- Modify: `packages/agent/src/tools/text-provider.ts`
- Modify: `packages/agent/src/tools/image-provider.ts`
- Modify: `packages/agent/src/tools/video-provider.ts`
- Modify: `packages/agent/src/tools/audio-provider.ts`
- Modify: `packages/agent/src/index.ts`（如需导出类型）
- Create: `apps/server/src/provider/provider-resolver.service.ts`
- Create: `apps/server/src/provider/provider-resolver.service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type ProviderCredentialOpts = { apiKey?: string; baseUrl?: string; model?: string }
  createImageProvider(opts?: ProviderCredentialOpts): ImageProvider
  // text/video/audio 同理：有 opts.apiKey 时用 opts，否则回退 process.env
  ```
- Resolver:
  ```ts
  resolveForGeneration(userId: string, modelValue: string | undefined, modality: ModelCapability): Promise<{
    channelId: string
    modelName: string
    apiFormat: ApiCallFormat
    credentials: { apiKey?: string; baseUrl: string }
    source: 'user' | 'platform'
  }>
  ```
  - 无 decode → 视为平台 + legacy modelKey（兼容旧节点）
  - 用户渠道无密钥 → 仍返回 user source，调用方可失败进 pending（或 Resolver 抛 `ByokCredentialMissingError`）

- [ ] **Step 1: agent 单测 — opts 覆盖 env**

- [ ] **Step 2: Resolver 单测 — 用户渠道解密 / 平台 / 跨用户 404**

- [ ] **Step 3: Commit**

```bash
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/server test -- src/provider/provider-resolver.service.test.ts
git add packages/agent apps/server/src/provider/provider-resolver.service.ts apps/server/src/provider/provider-resolver.service.test.ts
git commit -m "feat(agent,server): resolve channel credentials for generation"
```

---

### Task 5: Studio + Material 接入 Resolver 与 fallback_pending

**Files:**
- Modify: `apps/server/src/studio/studio.service.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`
- Modify: `apps/server/src/studio/studio.integration.test.ts`（或新增 `studio.fallback.test.ts`）
- Modify: `apps/server/src/canvas/material.service.ts`
- Modify: `apps/server/src/canvas/material.service.test.ts`
- Modify: `apps/server/src/canvas/canvas.controller.ts`
- Modify: `apps/server/src/studio/studio.module.ts` / `canvas.module.ts`（导入 ProviderModule）

**Interfaces:**
- 生成开始：`resolveForGeneration`；`source==='user'` 时用用户凭据调用 provider
- 用户渠道失败：将 `GenerationRecord` / `Material` 置 `fallback_pending`；metadata JSON 含 `channelId`、`failureClass`；**不**自动平台重试
- `confirmPlatformFallback(userId, recordId|materialId)`：仅当 status=`fallback_pending`；用平台凭据重跑；成功后 `completed` + `providerFallback: true`
- 取消：客户端可调 fail 接口或再次编辑；最小实现：`POST .../cancel-platform-fallback` → `failed`

固定弹窗文案常量（shared 或 server）：

```ts
export const BYOK_FALLBACK_CONFIRM_MESSAGE =
  '自定义渠道失败，已切换平台服务，可能会有额外费用，是否继续？'
```

- [ ] **Step 1: 测试用户渠道失败 → pending，未调平台 provider**

- [ ] **Step 2: 测试 confirm → 平台 generate 被调用**

- [ ] **Step 3: image/video/text/audio 与 material image/video 路径各至少 1 条覆盖或参数化**

- [ ] **Step 4: Commit**

```bash
pnpm --filter @lnkpi/server test
git add apps/server/src/studio apps/server/src/canvas apps/server/src/provider
git commit -m "feat(server): BYOK resolve with fallback_pending confirmation"
```

---

### Task 6: Web — provider-api + ProviderConfigDialog（四 Tab）

**Files:**
- Create: `apps/web/src/services/provider-api.ts`
- Create: `apps/web/src/composables/useProviderBootstrap.ts`
- Create: `apps/web/src/components/canvas/ProviderConfigDialog.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`（替换 `ModelProviderSettingsDialog`）
- Delete 或停用: `ModelProviderSettingsDialog.vue`、`useModelProviderSettings.ts`（移除 localStorage 明文 key）

**UI 必须包含（对照规格 §6）：**
1. 渠道：提示条、「去模型设置」、拉取全部、新增、每渠道字段、拉取模型、删除
2. 模型：四类可选项 + 四类默认
3. 生成偏好：张数/音色/格式/语速/指令/系统提示词
4. WebDAV：代理模式、地址/目录/用户名/密码、测试、同步

- [ ] **Step 1: provider-api 方法对齐 bootstrap/channels/preferences/webdav**

- [ ] **Step 2: Dialog 挂到 Canvas 配置入口；保存走 API**

- [ ] **Step 3: 手工/组件级冒烟 — 打开四 Tab 可见字段（可截图核对 v0.4.0）**

- [ ] **Step 4: Commit**

```bash
pnpm --filter @lnkpi/web build
git add apps/web
git commit -m "feat(web): replicate v0.4.0 provider config dialog with server APIs"
```

---

### Task 7: Dock 可选项绑定 + 回退确认 UI

**Files:**
- Modify: `apps/web/src/components/canvas/UniversalModelSelector.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`（新建节点默认模型）
- Modify: dock panels：`TextDockPanel` / `ImageDockPanel` / `VideoDockPanel` / `AudioDockPanel` / `PromptDockPanel`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`
- Create: `apps/web/src/components/canvas/ByokFallbackConfirmDialog.vue`

**行为:**
- Selector options = bootstrap.preferences.selectable* 过滤当前 modality
- 标签：`modelName（channelName）`
- 节点字段存完整 `channelId::modelName`
- 生成返回/轮询到 `fallback_pending` → 弹出确认框 → confirm / cancel API
- 停用模型：仍显示当前值 +「已停用」；点生成前若 `!selectable.includes(value)` 则拦截并提示重选

- [ ] **Step 1: useNodeGeneration 测试 — payload model 为 channel:: 格式**

- [ ] **Step 2: fallback_pending 触发确认回调测试（mock api）**

- [ ] **Step 3: Commit**

```bash
pnpm --filter @lnkpi/web test
git add apps/web
git commit -m "feat(web): bind dock models to preferences and BYOK fallback confirm"
```

---

### Task 8: WebDAV 服务端代理

**Files:**
- Modify: `apps/server/src/provider/provider.service.ts`（webdav put/test/sync）
- Create: `apps/server/src/provider/webdav.service.ts`
- Create: `apps/server/src/provider/webdav.service.test.ts`（mock fetch）
- Modify: `ProviderConfigDialog.vue` WebDAV Tab 接线

**行为:**
- 密码加密存储；GET 不回传密码
- `test`：服务端 PROPFIND/OPTIONS 到用户 URL（经 SSRF 校验）
- `sync`：最小可用实现——同步用户 sessions 列表 JSON 到远程目录（规格允许 MVP）；**禁止**把 API Key 写入同步包
- 失败返回清晰错误，不泄漏密码

- [ ] **Step 1: 单测 SSRF 拒绝内网 WebDAV URL**

- [ ] **Step 2: 单测密码加密且 bootstrap 无明文**

- [ ] **Step 3: Commit**

```bash
pnpm --filter @lnkpi/server test -- src/provider/
git add apps/server/src/provider apps/web/src/components/canvas/ProviderConfigDialog.vue
git commit -m "feat(server,web): proxy WebDAV test/sync with encrypted password"
```

---

### Task 9: 文档 + 全仓验收 + PR

**Files:**
- Modify: `docs/DOCK_STUDIO_E2E_TRACKING.md`（新增 BYOK 章节与手测清单）
- Modify: `docs/superpowers/specs/2026-07-19-byok-provider-channels-design.md`（状态 → 已实现 / 待合入）

- [ ] **Step 1: 全量**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm --filter @lnkpi/server exec prisma db push
pnpm build
pnpm test
```

- [ ] **Step 2: 文档提交**

```bash
git add docs
git commit -m "docs: mark BYOK provider channels ready for review"
```

- [ ] **Step 3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(provider): BYOK 渠道加密存储与服务端代理生成" --body "$(cat <<'EOF'
## Summary
- v0.4.0 配置弹窗四 Tab（渠道/模型/生成偏好/WebDAV）
- AES-GCM 密钥加密；Dock 由用户可选模型驱动
- BYOK 失败 fallback_pending + 费用二次确认后回退平台

## Spec
docs/superpowers/specs/2026-07-19-byok-provider-channels-design.md

## Test plan
- [ ] pnpm build && pnpm test
- [ ] 配置用户渠道生成成功
- [ ] 故意错误 Key → 确认弹窗 → 平台重试
- [ ] Dock 仅显示可选项
- [ ] WebDAV test（可用环境）
- [ ] GET bootstrap 无明文 key
EOF
)"
```

---

## Spec coverage

| 规格章节 | Task |
|----------|------|
| §3 架构 / Dock 来源 | 1, 4, 7 |
| §4 数据模型 | 3, 8 |
| §5 API | 3, 5, 8 |
| §6 UI 复刻 | 6, 7 |
| §7 回退 | 5, 7 |
| §8 安全 | 2, 3, 8 |
| §9 Catalog 初始化 | 3 |
| §10 测试 | 各 Task + 9 |
| §11 非目标 | 全局约束 |

## Placeholder scan

无 TBD/TODO；类型名以 Task 1–4 为准。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-19-byok-provider-channels.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每任务新 subagent，任务间评审  
2. **Inline Execution** — 本会话按 executing-plans 批量执行并设检查点  

Which approach?
