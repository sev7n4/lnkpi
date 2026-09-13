# Fal H3 Max Video 最小接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dock 可选 `h3-max-turbo` / `h3-max`，经 fal 完成 T2V/I2V（可选首尾帧），平台 `FAL_KEY` 与用户 BYOK 双轨，积分按时长×分辨率系数扣费。

**Architecture:** 扩展 `VideoModelProfile`（`refWire: fal_h3_max`）与 catalog；新增 `FalH3MaxVideoProvider`（`Authorization: Key`，queue 轮询）；`createVideoProvider` 按 fal host / modelKey 路由；`ProviderResolver` 对 platform H3 Max 族解析 `FAL_KEY`；`videoCreditsForModel` 扩展积分；Dock capabilities 自动跟 profile。

**Tech Stack:** NestJS、Vitest、Vue Dock、现有 `VideoProvider` / `ProviderResolver`、fal HTTP queue（无需 `@fal-ai/client` 也可纯 fetch）

**Spec:** [docs/superpowers/specs/2026-09-13-fal-h3-max-video-min-design.md](../specs/2026-09-13-fal-h3-max-video-min-design.md)  
**Follow-up:** 官方 MiniMax H3 全能力 → 另开 plan（规格已批准）

## Global Constraints

- 仅 fal **H3 Max / H3 Max Turbo**；禁止接裸 `minimax/h3/*`、Director、Reference。
- 分辨率仅 **480P / 768P**；时长 **5–15** 整数秒。
- 鉴权：`Authorization: Key ${apiKey}`（与 ESRGAN/SAM 相同）。
- 凭证：`ProviderResolver` 结果优先；platform → `FAL_KEY` + 默认 base `https://fal.run`；BYOK → 通道 apiKey+baseUrl。
- BYOK 计费对齐现网视频 BYOK，不发明第三套。
- 不修改平台默认视频模型（仍可为 agnes/seedance）。
- Commit per task；勿 `git add -A`；PR 前 `pnpm build` + 相关 vitest。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/videoModelProfiles.ts` | `fal_h3_max` refWire + profiles |
| `packages/shared/src/videoModelCapabilities.ts` | caps for fal_h3_max |
| `packages/shared/src/studioModelCatalog.ts` | `h3-max-turbo` / `h3-max` entries |
| `packages/shared/src/platformCredentials.ts`（或新建 `falPlatformCredentials.ts`） | platform FAL 凭证解析 |
| `packages/agent/src/tools/fal-video-queue.ts` | submit + poll helpers |
| `packages/agent/src/tools/fal-h3-max-video-provider.ts` | `FalH3MaxVideoProvider` |
| `packages/agent/src/tools/video-provider.ts` | `createVideoProvider` 路由 |
| `packages/agent/src/index.ts` | exports |
| `apps/server/src/provider/provider-resolver.service.ts` | platform H3 Max → FAL_KEY |
| `apps/server/src/points/video-credits.ts` | `videoCreditsForModel` |
| `apps/server/src/canvas/material.service.ts` / `studio.service.ts` | 调用新 credits；metadata |
| `apps/web` | 通常无改（catalog + capabilities 驱动 Dock）；若模型列表硬编码则补 |
| `.env.example` | `FAL_KEY` / `FAL_BASE_URL` 注释 |

**Endpoint 常量（实现锁定，若 fal 改名以模型页为准并改常量+测）：**

```ts
export const FAL_H3_MAX_ENDPOINTS = {
  'h3-max-turbo': {
    t2v: 'minimax/h3-max-turbo/text-to-video',
    i2v: 'minimax/h3-max-turbo/image-to-video',
  },
  'h3-max': {
    t2v: 'minimax/h3-max/text-to-video',
    i2v: 'minimax/h3-max/image-to-video',
  },
} as const
```

Queue API（与 fal 文档一致）：

1. `POST {queueBase}/queue/{endpointId}` body=input，Header `Authorization: Key …`  
2. 轮询 `GET {status_url}` 直到 `COMPLETED`  
3. 取 `response.video.url`（字段名以实测为准，单测锁定）

`queueBase`：若用户 base 为 `https://fal.run`，queue 常用 `https://queue.fal.run`——实现时写 `resolveFalQueueBase(baseUrl)` 并单测。

---

### Task 1: shared catalog + VideoModelProfile + capabilities

**Files:**
- Modify: `packages/shared/src/videoModelProfiles.ts`
- Modify: `packages/shared/src/videoModelProfiles.test.ts`
- Modify: `packages/shared/src/videoModelCapabilities.ts`
- Modify: `packages/shared/src/videoModelCapabilities.test.ts`
- Modify: `packages/shared/src/studioModelCatalog.ts`
- Modify: `packages/shared/src/studioModelCatalog.test.ts`（若有）

**Interfaces:**
- Produces: `VideoRefWire` 增加 `'fal_h3_max'`
- `resolveVideoModelProfile('h3-max-turbo'|…)` → profile 见规格 §4.1
- capabilities：`supportsFirstLastFrame: true`，`supportsVideoRef/AudioRef: false`，resolutions `480p|768p`，duration 5–15

- [ ] **Step 1: 写失败单测**

```ts
it('resolves h3-max-turbo profile', () => {
  const p = resolveVideoModelProfile('h3-max-turbo', 'minimax/h3-max-turbo')
  expect(p.refWire).toBe('fal_h3_max')
  expect(p.minDuration).toBe(5)
  expect(p.maxDuration).toBe(15)
  expect(p.maxVideoRefs).toBe(0)
  expect(p.allowedResolutions).toEqual(expect.arrayContaining(['480p', '768p']))
})

it('capabilities hide video/audio refs for fal h3 max', () => {
  const c = resolveVideoModelCapabilities('h3-max-turbo')
  expect(c.supportsVideoRef).toBe(false)
  expect(c.supportsFirstLastFrame).toBe(true)
})
```

Run: `pnpm --filter @lnkpi/shared exec vitest run src/videoModelProfiles.test.ts src/videoModelCapabilities.test.ts`  
Expected: FAIL

- [ ] **Step 2: 实现 profile + catalog 两项 + capabilities 分支**

Catalog：

```ts
{
  modelKey: 'h3-max-turbo',
  displayName: 'H3 Max Turbo (fal)',
  gatewayModelId: 'minimax/h3-max-turbo',
  modality: 'video',
  providerBinding: 'fal-http', // 若类型是联合字面量，扩展类型
  params: { ...VIDEO_PARAMS, /* image native */ },
}
// + h3-max 同理
```

若 `providerBinding` 类型过严，扩展为含 `'fal-http'`。

- [ ] **Step 3: 单测 PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(shared): add fal H3 Max video catalog and profiles

EOF
)"
```

---

### Task 2: FalH3MaxVideoProvider + createVideoProvider 路由

**Files:**
- Create: `packages/agent/src/tools/fal-video-queue.ts`
- Create: `packages/agent/src/tools/fal-video-queue.test.ts`
- Create: `packages/agent/src/tools/fal-h3-max-video-provider.ts`
- Create: `packages/agent/src/tools/fal-h3-max-video-provider.test.ts`
- Modify: `packages/agent/src/tools/video-provider.ts`
- Modify: `packages/agent/src/tools/video-provider.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- `FalH3MaxVideoProvider` implements `VideoProvider`
- `isFalVideoModel(model?: string): boolean` — modelKey/gateway 含 `h3-max`
- `isFalBaseUrl(baseUrl?: string): boolean` — host `fal.ai` / `fal.run`
- `createVideoProvider`: 若 apiKey 且 (fal base **或** fal model) → Fal provider

- [ ] **Step 1: queue helper 失败单测**（mock fetch：submit → status COMPLETED → url）

- [ ] **Step 2: 实现 queue helper**

- [ ] **Step 3: Provider 失败单测**

```ts
it('T2V posts to turbo text-to-video endpoint', async () => { /* assert URL path + Key header + body */ })
it('I2V with end image sends image_url and end_image_url', async () => { /* */ })
it('maps TOP_UP 403 to readable Error', async () => { /* */ })
```

- [ ] **Step 4: 实现 Provider**

映射：

- resolution `480p`→`480P`，`768p`→`768P`
- aspectRatio → `aspect_ratio`
- 有 `image` 或 `referenceImages[0]` → I2V endpoint；`referenceImages[1]` 或专用 end 字段 → `end_image_url`
- `prompt_expansion_mode`: 默认不传或 `fast`（省延迟；规格 P1——一期可省略）

- [ ] **Step 5: createVideoProvider 路由 + 单测**

顺序建议：有 apiKey 时先判 fal model / fal base，再 Agnes，再 Apimart。

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): add FalH3MaxVideoProvider with queue polling

EOF
)"
```

---

### Task 3: Platform FAL 凭证解析 + ProviderResolver

**Files:**
- Modify: `packages/shared/src/platformCredentials.ts`（或新建 fal helper）
- Modify: `apps/server/src/provider/provider-resolver.service.ts`
- Modify: `apps/server/src/provider/provider-resolver.service.test.ts`

**Interfaces:**
- `isFalH3MaxPlatformModel(modelName: string): boolean`
- platform 解析：若 H3 Max 族 → `{ apiKey: FAL_KEY, baseUrl: FAL_BASE_URL || 'https://fal.run' }`；缺 Key → 保持现有缺凭证行为（生成层报错）

- [ ] **Step 1: 单测** platform::h3-max-turbo 在设 FAL_KEY 时返回 fal 凭证

- [ ] **Step 2: 实现**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): resolve FAL_KEY for platform H3 Max video models

EOF
)"
```

---

### Task 4: videoCreditsForModel + Nest 接线

**Files:**
- Modify: `apps/server/src/points/video-credits.ts`
- Create: `apps/server/src/points/video-credits.test.ts`（或扩展现有）
- Modify: `apps/server/src/canvas/material.service.ts`（`videoCredits(duration)` → forModel）
- Modify: `apps/server/src/studio/studio.service.ts`（同上）
- 确认 `buildVideoProviderOptions` 对 `fal_h3_max` 传入 image/end refs（改 agent studio adapter 若需要）

**Interfaces:**

```ts
export function videoCreditsForModel(input: {
  duration: number
  modelKey?: string
  resolution?: string
}): number {
  const base = videoCredits(input.duration)
  const key = (input.modelKey || '').toLowerCase()
  const res = (input.resolution || '768p').toLowerCase()
  if (!key.includes('h3-max')) return base
  const isTurbo = key.includes('turbo')
  // spec §5:
  // turbo+480 → ×1.0; turbo+768 → ×1.2; max+480 → ×1.2; max+768 → ×1.5
  let factor = 1.5
  if (isTurbo && res.includes('480')) factor = 1.0
  else if (isTurbo) factor = 1.2
  else if (res.includes('480')) factor = 1.2
  return Math.ceil(base * factor)
}
```

- [ ] **Step 1: 单测系数表**

- [ ] **Step 2: 替换 material/studio 扣点调用；metadata 增加 `providerId: 'fal'`、`falEndpoint`、`credentialSource`（若 resolved 可得）**

- [ ] **Step 3: 确认 `createVideoProvider(providerOpts(resolved))` 已传入 BYOK apiKey/baseUrl**（读 `providerOpts`）；缺则补

- [ ] **Step 4: adapter** — `buildVideoProviderOptions`：当 `refWire===fal_h3_max`，把首帧/尾帧填进 `image` / `referenceImages`

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(server): bill fal H3 Max video with resolution credit factors

EOF
)"
```

---

### Task 5: 验收、env 文档、PR

- [ ] **Step 1: 跑测**

```bash
pnpm --filter @lnkpi/shared exec vitest run src/videoModelProfiles.test.ts src/videoModelCapabilities.test.ts src/studioModelCatalog.test.ts
pnpm --filter @lnkpi/agent exec vitest run src/tools/fal-h3-max-video-provider.test.ts src/tools/fal-video-queue.test.ts src/tools/video-provider.test.ts
pnpm --filter @lnkpi/server exec vitest run src/points/video-credits.test.ts src/provider/provider-resolver.service.test.ts
pnpm build
```

- [ ] **Step 2: `.env.example` 注明 FAL_KEY 亦用于 H3 Max 视频；BYOK 可在通道填 fal Key + `https://fal.run`**

- [ ] **Step 3: 开 PR** `feature/fal-h3-max-video-min`

Title: `feat: fal H3 Max / Turbo video in Dock (T2V/I2V)`  
Body：链规格；Test plan 含平台 Key + BYOK 各一条；说明非官网 H3、非 Director。

- [ ] **Step 4: 更新规格状态勾选成功标准（可选同 PR）**

---

## Spec coverage

| Spec § | Task |
|--------|------|
| catalog / profile / caps | T1 |
| FalH3MaxVideoProvider / endpoints | T2 |
| BYOK + platform FAL_KEY | T3–T4 |
| credits 系数 | T4 |
| Dock 模式 | T1 capabilities（无硬编码时可 0 前端改动） |
| 非目标 | 全计划禁止项 |

## Self-review notes

- Endpoint 字符串若与 fal 线上不一致：以模型页为准改常量，不改架构。  
- `providerBinding: 'fal-http'` 若破坏现有类型，允许先用注释 + `gateway-openai-compat` **仅当** resolver 不依赖该字段路由；优先扩展类型。  
- MiniMax 官网全能力 **不在本 plan**。
