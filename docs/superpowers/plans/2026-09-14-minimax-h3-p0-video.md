# MiniMax H3 P0 Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock 可选 `minimax-h3`（官网 MiniMax-H3），经官方 Open Platform 完成 T2V / I2V / 首尾帧；平台 `MINIMAX_API_KEY` 与用户 BYOK 双轨；积分按 768P/2K 系数扣「视频生成」。

**Architecture:** 扩展 `VideoModelProfile`（`refWire: minimax_h3_content`）与 catalog；新增 `MiniMaxH3VideoProvider`（`Authorization: Bearer`，`POST /v2/video_generation` + 轮询 query）；`createVideoProvider` 按 MiniMax host / `minimax-h3` 路由（**必须排在 fal `h3-max*` 之后、Agnes 之前**）；`ProviderResolver` 对 platform `minimax-h3` 解析 `MINIMAX_API_KEY`；`videoCreditsForModel` 增加官网 H3 系数；adapter 把首/尾帧填进 `image` / `imageWithRoles`。P0 **不做** Reference / Context-IR / Regeneration / 官网 H3-Max。

**Tech Stack:** NestJS、Vitest、现有 `VideoProvider` / `ProviderResolver` / Dock capabilities、纯 fetch（无需 MiniMax SDK）

**Spec:** [docs/superpowers/specs/2026-09-13-minimax-h3-full-video-design.md](../specs/2026-09-13-minimax-h3-full-video-design.md) §P0  
**Follow-up plans (not this file):** M2 Reference、M3 IR+Regen、M4 官网 `minimax-h3-max`

## Global Constraints

- 仅官网 **MiniMax-H3** P0：T2V / I2V / 首尾帧。禁止 fal 端点、Director、Reference、Context-IR、Regeneration、`MiniMax-H3-Max`。
- 分辨率仅 **768P / 2K**；时长 **4–15** 整数秒。T2V 的 `ratio` 必填且不可 `adaptive`。
- 鉴权：`Authorization: Bearer ${apiKey}`（官方 Open Platform，**不是** fal 的 `Key`）。
- 凭证：`ProviderResolver` 结果优先；platform → `MINIMAX_API_KEY` + 默认 base `https://api.minimax.io`；BYOK → 通道 apiKey+baseUrl。
- BYOK 计费对齐现网视频 BYOK，不发明第三套。
- 不修改平台默认视频模型（仍可为 agnes/seedance）。
- **路由冲突：** 现网 `isFalVideoModel` / `isFalH3MaxPlatformModel` 用 `/h3-max/i`。P0 catalog 必须用 `minimax-h3`（不含 `h3-max`）。禁止在本 plan 加入 `minimax-h3-max`。
- Queue/API：`POST {base}/v2/video_generation`，轮询 `GET {base}/v2/query/video_generation/{task_id}`；`pollIntervalMs` 10_000，`maxPollMs` ≥ 15min。
- Commit per task；勿 `git add -A`；PR 前 `pnpm build` + 相关 vitest。
- **禁止**与 fal H3 Max 绑成同一大 PR。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/videoModelProfiles.ts` | `minimax_h3_content` refWire + profile |
| `packages/shared/src/videoModelCapabilities.ts` | caps：首尾帧开、无 V/A ref（P0）、无 4K、2K 在 allowedResolutions |
| `packages/shared/src/studioModelCatalog.ts` | `minimax-h3` 一项，`providerBinding: 'minimax-http'` |
| `packages/shared/src/videoSettingsOptions.ts` | 若 `2k` 未出现在 extras，补 label `2K` |
| `packages/shared/src/index.ts` | `VideoResolution` 联合如缺 `'2k'` 则补 |
| `packages/shared/src/platformCredentials.ts` | `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` |
| `packages/agent/src/tools/minimax-h3-video-provider.ts` | `MiniMaxH3VideoProvider` + `normalizeMiniMaxBaseUrl` |
| `packages/agent/src/tools/video-provider.ts` | 路由 |
| `packages/agent/src/index.ts` | exports |
| `packages/agent/src/studio/generation-adapter.ts` | `refWire===minimax_h3_content` 首尾帧 |
| `apps/server/src/provider/provider-resolver.service.ts` | platform MiniMax 凭证 |
| `apps/server/src/points/video-credits.ts` | 官网 H3 系数 |
| `apps/server/src/canvas/material.service.ts` / `studio.service.ts` | 已走 forModel + createVideoProvider(model)；确认 metadata |
| `.env.example` | `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` |

---

### Task 1: shared catalog + VideoModelProfile + capabilities

**Files:**
- Modify: `packages/shared/src/videoModelProfiles.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/shared/src/videoModelCapabilities.ts`
- Modify: `packages/shared/src/videoModelCapabilities.test.ts`
- Modify: `packages/shared/src/studioModelCatalog.ts`
- Modify: `packages/shared/src/studioModelCatalog.test.ts`
- Modify: `packages/shared/src/index.ts`（仅当 `VideoResolution` 无 `'2k'`）
- Modify: `packages/shared/src/videoSettingsOptions.ts`（2K label）
- Test: `packages/shared/src/videoSettingsOptions.test.ts`（若有）

**Interfaces:**
- Produces: `VideoRefWire` 增加 `'minimax_h3_content'`
- `resolveVideoModelProfile('minimax-h3', 'MiniMax-H3')` → 见下
- capabilities：`supportsFirstLastFrame: true`，`supportsVideoRef/AudioRef: false`（P0），`supports4K: false`，resolutions `768p|2k`，duration 4–15

- [ ] **Step 1: 写失败单测**

```ts
it('resolves minimax-h3 profile', () => {
  const p = resolveVideoModelProfile('minimax-h3', 'MiniMax-H3')
  expect(p.refWire).toBe('minimax_h3_content')
  expect(p.minDuration).toBe(4)
  expect(p.maxDuration).toBe(15)
  expect(p.maxVideoRefs).toBe(0)
  expect(p.allowedResolutions).toEqual(['768p', '2k'])
  expect(p.gatewayModelId).toBe('MiniMax-H3')
})

it('capabilities hide video/audio refs for official H3 P0', () => {
  const c = resolveVideoModelCapabilities('minimax-h3')
  expect(c.supportsVideoRef).toBe(false)
  expect(c.supportsFirstLastFrame).toBe(true)
  expect(c.supports4K).toBe(false)
  expect(c.allowedResolutions).toEqual(['768p', '2k'])
})
```

Run: `pnpm --filter @lnkpi/shared exec vitest run src/videoModelProfiles.test.ts src/videoModelCapabilities.test.ts src/studioModelCatalog.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现**

Profile（检测 `modelKey`/`gateway` 匹配 `/^minimax-h3$/i` 或 `/^MiniMax-H3$/`，**不要**用 `/h3-max/`）：

```ts
{
  refWire: 'minimax_h3_content',
  sizeWire: 'ratio_duration',
  responseMode: 'async_task',
  gatewayModelId: 'MiniMax-H3',
  maxImageRefs: 2,
  maxVideoRefs: 0,
  maxAudioRefs: 0,
  minDuration: 4,
  maxDuration: 15,
  allowedAspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  allowedResolutions: ['768p', '2k'],
  maxResolution: undefined, // 2k 不在 RESOLUTION_RANK 的 4k；clamp 必须尊重 allowedResolutions（已有吸附）
  defaultGenerateAudio: true,
  pollIntervalMs: 10_000,
  maxPollMs: 1_200_000,
}
```

把 `'2k'` 加入 `VideoResolutionTier` 且 `RESOLUTION_RANK['2k']` 高于 `768p`、低于或等于 `4k`（建议 4，把现网 `1080p` 让到 5、`4k` 到 6 **仅当** 不破坏 Seedance 1080 降档测试；若改 rank 导致 Seedance 测红，则 2k 只走 `allowedResolutions` 吸附、不进 rank）。

Catalog：

```ts
{
  modelKey: 'minimax-h3',
  displayName: 'MiniMax H3',
  gatewayModelId: 'MiniMax-H3',
  modality: 'video',
  providerBinding: 'minimax-http',
  params: VIDEO_PARAMS,
}
```

`StudioModelEntry.providerBinding` 扩为 `'gateway-openai-compat' | 'fal-http' | 'minimax-http'`。  
更新 `listModels('video')` 长度断言（现网 fal 落地后为 9，本任务 → 10）。默认视频模型断言仍为 `agnes-video-v2.0`。

- [ ] **Step 3: 单测 PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(shared): add official MiniMax H3 video catalog and profile

EOF
)"
```

---

### Task 2: MiniMaxH3VideoProvider + createVideoProvider 路由

**Files:**
- Create: `packages/agent/src/tools/minimax-h3-video-provider.ts`
- Create: `packages/agent/src/tools/minimax-h3-video-provider.test.ts`
- Modify: `packages/agent/src/tools/video-provider.ts`
- Modify: `packages/agent/src/tools/video-provider.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- `MiniMaxH3VideoProvider` implements `VideoProvider`
- `isMiniMaxH3Model(model?: string): boolean` — `/^minimax-h3$/i` 或 `/^minimax-h3$/i.test` of catalog key **或** gateway `MiniMax-H3`（精确，避免匹配 fal `h3-max`）
- `isMiniMaxBaseUrl(baseUrl?: string): boolean` — host `api.minimax.io`（及 `.minimax.chat` 若文档出现；负例 `minimax.io.attacker.example`）
- `normalizeMiniMaxBaseUrl(baseUrl?: string): string` — 默认 `https://api.minimax.io`；去尾 `/`；若已以 `/v2` 结尾则保留，提交路径不再重复 `/v2`
- `createVideoProvider`：有 apiKey 且 (MiniMax model **或** MiniMax base) → MiniMax provider；顺序：fal → **minimax** → Agnes → Apimart。无 apiKey 且 MiniMax model/base → throw `Error('未配置 MiniMax API Key')`（在 OPENAI fallback 之前）

- [ ] **Step 1: normalize + T2V 失败单测**（mock fetch）

```ts
it('normalizes base without duplicating /v2', () => {
  expect(normalizeMiniMaxBaseUrl('https://api.minimax.io')).toBe('https://api.minimax.io')
  expect(normalizeMiniMaxBaseUrl('https://api.minimax.io/')).toBe('https://api.minimax.io')
  expect(normalizeMiniMaxBaseUrl('https://api.minimax.io/v2')).toBe('https://api.minimax.io/v2')
})

it('T2V posts content text and required ratio', async () => {
  // mock POST .../v2/video_generation → { task_id: 't1' }
  // mock GET  .../v2/query/video_generation/t1 → { status: 'succeeded', content: { url: 'https://cdn/v.mp4' } }
  const p = new MiniMaxH3VideoProvider('mm-key', 'https://api.minimax.io', 'minimax-h3')
  const r = await p.generate('a cat walks', { duration: 5, aspectRatio: '16:9', resolution: '768p' })
  expect(r.url).toBe('https://cdn/v.mp4')
  // assert POST url, Authorization: Bearer mm-key, body.model === 'MiniMax-H3'
  // body.content === [{ type: 'text', text: 'a cat walks' }]
  // body.ratio === '16:9' (not adaptive)
  // body.resolution === '768P'
})
```

- [ ] **Step 2: 实现 Provider**

提交：

```ts
POST {base}/v2/video_generation
Authorization: Bearer ${apiKey}
Content-Type: application/json
{
  model: 'MiniMax-H3',
  content: [ /* 见映射 */ ],
  duration: integer,
  resolution: '768P' | '2K',
  ratio?: string // T2V required; I2V/first_last omit or adaptive per spec
}
```

映射：

- resolution `768p`→`768P`，`2k`/`2K`→`2K`
- T2V：无 image → content `[{type:'text', text}]`，`ratio` 必填（缺省 `16:9`）
- I2V：`image` 或 `referenceImages[0]` → 加 `{ type:'image_url', image_url:{ url }, role:'first_frame' }`，**不要**传非 adaptive 的冲突 ratio（按规格 ratio 由图像决定：省略 `ratio` 或显式不传）
- 首尾帧：第二张图或 `imageWithRoles` last/end → `role:'last_frame'`
- 轮询：每 10s GET `{base}/v2/query/video_generation/{task_id}` 直到 `succeeded`；从 `content.url` 或 `file.file_url` 取值（单测锁定 `content.url`，实现可兼容 file url）
- `failed`/`cancelled` → throw Error 含 status
- HTTP 401/403 余额类 → 可读错误「视频服务账户异常，请稍后重试或联系管理员」（与 fal TOP_UP 文案可共用，避免产品两套）

- [ ] **Step 3: I2V / 首尾帧 / 缺 Key 路由单测 + 实现 createVideoProvider**

```ts
it('I2V sends first_frame and omits ratio', async () => { /* */ })
it('first last sends first_frame and last_frame', async () => { /* */ })
it('createVideoProvider routes MiniMax-H3 with Bearer provider before Agnes', () => { /* */ })
it('refuses MiniMax model without apiKey even if OPENAI_API_KEY set', () => {
  process.env.OPENAI_API_KEY = 'sk-openai'
  expect(() => createVideoProvider({ model: 'minimax-h3', baseUrl: 'https://api.minimax.io' }))
    .toThrow('未配置 MiniMax API Key')
})
```

fal 的 `h3-max-turbo` 路由测试不得变红。

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): add MiniMaxH3VideoProvider with official poll API

EOF
)"
```

---

### Task 3: Platform MINIMAX 凭证解析

**Files:**
- Modify: `packages/shared/src/platformCredentials.ts`
- Modify: `packages/shared/src/platformCredentials.test.ts`
- Modify: `apps/server/src/provider/provider-resolver.service.ts`
- Modify: `apps/server/src/provider/provider-resolver.service.test.ts`

**Interfaces:**
- `DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.io'`
- `isMiniMaxH3PlatformModel(modelName: string): boolean` — `/^minimax-h3$/i` 或 `/^minimax-h3$/i` on decoded name **或** gateway `MiniMax-H3`。**禁止** `/h3-max/`。
- `resolveMiniMaxH3PlatformCredentials(modelName, env?)` → `{ apiKey: MINIMAX_API_KEY (may be empty), baseUrl: MINIMAX_BASE_URL || default } | null`
- 缺 Key：**不要**回落 `OPENAI_API_KEY`；仍返回 MiniMax baseUrl（与 fal H3 同一模式）
- Resolver platform 分支：在 fal swap **之后**（或并列 if），若 MiniMax H3 则覆盖为 MiniMax 凭证。User BYOK 分支不改。

- [ ] **Step 1: 失败单测** `platform::minimax-h3` + `MINIMAX_API_KEY` → bearer 凭证；缺 key 不是 OPENAI；`h3-max-turbo` 仍走 FAL_KEY 不是 MiniMax

- [ ] **Step 2: 实现 + env restore in afterEach**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): resolve MINIMAX_API_KEY for platform MiniMax H3

EOF
)"
```

---

### Task 4: credits + adapter + Nest metadata

**Files:**
- Modify: `apps/server/src/points/video-credits.ts`
- Modify: `apps/server/src/points/video-credits.test.ts`
- Modify: `packages/agent/src/studio/generation-adapter.ts`
- Modify: `packages/agent/src/studio/generation-adapter.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts` / `material.service.ts`（metadata `providerId: 'minimax'`；确认 `createVideoProvider({ ...providerOpts(resolved), model })` 已存在）
- Modify: `apps/server/src/canvas/scene-composer.service.ts`（已用 `videoCreditsForModel`，系数进 forModel 即可覆盖导演台）

**Interfaces:**

扩展 `videoCreditsForModel`（**在现有 fal `h3-max` 分支之后**）：

```ts
const key = (input.modelKey || '').toLowerCase()
const res = (input.resolution || '768p').toLowerCase()
if (key.includes('h3-max')) { /* 现网 fal 系数，勿改 */ }
const isOfficialH3 =
  key === 'minimax-h3' || (key.includes('minimax-h3') && !key.includes('h3-max'))
if (isOfficialH3) {
  const factor = res.includes('2k') ? 1.8 : 1.2 // 768P default
  return Math.ceil(base * factor)
}
return base
```

- [ ] **Step 1: 系数单测**

```ts
expect(videoCreditsForModel({ duration: 5, modelKey: 'minimax-h3', resolution: '768p' })).toBe(36) // 30*1.2
expect(videoCreditsForModel({ duration: 5, modelKey: 'minimax-h3', resolution: '2k' })).toBe(54) // 30*1.8
expect(videoCreditsForModel({ duration: 5, modelKey: 'h3-max-turbo', resolution: '768p' })).toBe(36) // fal 不变
```

- [ ] **Step 2: adapter** `profile.refWire === 'minimax_h3_content'`：与 fal 相同，首图 `image` + `referenceImages`（最多 2）；两张 → `imageWithRoles` first_frame/last_frame；不写 prompt suffix。

- [ ] **Step 3: metadata** 官方 H3 记录：`providerId: 'minimax'`、`credentialSource`、`minimaxModel: 'MiniMax-H3'`。非该族不要写 providerId minimax。

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): bill official MiniMax H3 with 768P/2K credit factors

EOF
)"
```

---

### Task 5: env 文档 + 验收 + PR

- [ ] **Step 1: 跑测**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/videoModelProfiles.test.ts src/videoModelCapabilities.test.ts src/studioModelCatalog.test.ts
pnpm --filter @lnkpi/agent exec vitest run src/tools/minimax-h3-video-provider.test.ts src/tools/video-provider.test.ts src/studio/generation-adapter.test.ts
pnpm --filter @lnkpi/server exec vitest run src/points/video-credits.test.ts src/provider/provider-resolver.service.test.ts src/canvas/scene-composer.service.test.ts
pnpm build
```

- [ ] **Step 2: `.env.example`**

```
# MiniMax Open Platform — official MiniMax-H3 video (P0 T2V/I2V/first-last).
# BYOK: channel apiKey + https://api.minimax.io (Bearer). Not the fal H3 Max Key.
MINIMAX_API_KEY=""
# MINIMAX_BASE_URL="https://api.minimax.io"
```

- [ ] **Step 3: PR** `feature/minimax-h3-p0-video`

Title: `feat: official MiniMax H3 video in Dock (T2V/I2V/first-last)`  
Body：链规格；说明 **不是 fal H3 Max**、无 Reference/IR/Regen；Test plan 含平台 Key + BYOK 各一条。

- [ ] **Step 4: 规格状态** 勾选 P0 成功标准中可用单测证明的项；live 出片不勾或注明未打。

---

## Spec coverage (P0)

| Spec § | Task |
|--------|------|
| catalog / profile / caps P0 | T1 |
| Provider + `/v2/video_generation` + poll | T2 |
| BYOK + platform MINIMAX_* | T3–T4 |
| credits 768P ×1.2 / 2K ×1.8 | T4 |
| Dock 三模式 | T1 capabilities（无硬编码时可 0 前端改动） |
| P1 Reference / P2 IR / Regen / P3 官网 Max | **不在本 plan** |

## Self-review notes

- fal `/h3-max/i` 不得误伤 `minimax-h3`；P3 若加 `minimax-h3-max` 必须先收紧 fal 检测。  
- T2V `ratio` 不可 adaptive。  
- `2k` 的 clamp/rank 以不破坏 Seedance 1080p 降档为准。  
- 导演台已走 `videoCreditsForModel`，T4 系数会自动覆盖。
