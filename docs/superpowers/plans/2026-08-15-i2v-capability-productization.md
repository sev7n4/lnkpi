# I2V 能力产品化（Capability Productization）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-08-15-i2v-upstream-capability-audit-design.md`

**Goal:** 将审计规格 §9 的 P0–P2 缺口落地为可感知的产品能力——按模型展示 I2V 能力边界、修正假控件、扩展参数选项、增强多 ref 引导，并完善 S8 连续镜工作流。

**Architecture:** 在 `@lnkpi/shared` 新增 **VideoModelCapabilities**（由 `resolveVideoModelProfile` 派生）；Web Dock 消费 capabilities 驱动徽章/禁用/文案；`VideoSettingsSelector` 按 profile 动态选项；RefStrip 增加 ref 角色标注；P2 在 generation 完成路径写回 `lastFrameUrl` 并暴露「接下一段」。Material/VideoStudio 旁路（G-10/G-11）**不在本 plan**。

**Tech Stack:** TypeScript, Vitest, Vue 3, `@lnkpi/shared`, NestJS（仅 P2 API 文档/测试）

## Global Constraints

- 不新增 video provider；不接入 Seedance 2.5
- 能力矩阵 **单一 SSOT**：`packages/shared/src/videoModelCapabilities.ts`；Web 禁止硬编码 Agnes/Seedance 分支
- 视频 poll 超时 **660_000ms** 不变
- canonical SSOT = `refs[]`；`referenceImageUrl` 只读 legacy（PR #247 已停写）
- 每 Task 单独 commit；不 amend 已 push commit
- 提交前 `pnpm build` + 相关 vitest 全绿
- 生产 smoke：`prod-canvas-i2v-video-verify.py` + `prod-agent-i2v-video-verify.py` 回归

---

## File Map

| File | Responsibility |
|---|---|
| `packages/shared/src/videoModelCapabilities.ts` | `VideoModelCapabilities` + `resolveVideoModelCapabilities()` |
| `packages/shared/src/videoModelCapabilities.test.ts` | Agnes / Seedance mini / standard 能力断言 |
| `packages/shared/src/index.ts` | export |
| `apps/web/src/composables/useVideoModelCapabilities.ts` | 由 `videoModel` 解码 → capabilities |
| `apps/web/src/components/canvas/dock-studio/shared/VideoCapabilityBadges.vue` | 能力徽章 UI |
| `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` | 按 capabilities 改 videoMode 文案/可见性 |
| `apps/web/src/components/canvas/VideoSettingsSelector.vue` | 动态 aspect/resolution/audio/crop |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.vue` | ref 角色标签（首帧/末帧/参考） |
| `apps/web/src/composables/useNodeGeneration.ts` | P2：`lastFrameUrl` 写回；纯音频 S7 前置校验 |
| `apps/web/src/composables/useNodeGeneration.test.ts` | 新行为单测 |
| `docs/superpowers/specs/2026-08-15-i2v-upstream-capability-audit-design.md` | §0 状态 → 实施中 |
| `apps/server/src/studio/video-generation.integration.test.ts` | P2：refs × videoMode 矩阵（可选扩展） |

---

### Task 0: VideoModelCapabilities SSOT

**Files:**
- Create: `packages/shared/src/videoModelCapabilities.ts`
- Create: `packages/shared/src/videoModelCapabilities.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `VideoModelCapabilities` — `{ supportsFirstLastFrame, supportsKeyframes, supportsVideoRef, supportsAudioRef, supportsGenerateAudio, supportsReturnLastFrame, supports4K, allowedAspectRatios, allowedResolutions, minDuration, maxImageRefs, maxVideoRefs, maxAudioRefs, firstLastFrameLabel, keyframesLabel }`
  - `resolveVideoModelCapabilities(modelKey: string, gatewayModelId?: string): VideoModelCapabilities`

- [ ] **Step 1: Write failing tests**

```typescript
/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { resolveVideoModelCapabilities } from './videoModelCapabilities'
import { SEEDANCE_20_GATEWAYS } from './videoModelProfiles'

describe('resolveVideoModelCapabilities', () => {
  it('agnes-video: keyframes yes, firstLast strict no, no V/A/audio', () => {
    const c = resolveVideoModelCapabilities('agnes-video-v2.0', 'agnes-video-v2.0')
    expect(c.supportsKeyframes).toBe(true)
    expect(c.supportsFirstLastFrame).toBe(false)
    expect(c.supportsVideoRef).toBe(false)
    expect(c.supportsAudioRef).toBe(false)
    expect(c.supportsGenerateAudio).toBe(false)
    expect(c.firstLastFrameLabel).toBe('关键帧过渡')
  })

  it('seedance standard: firstLast, V/A, audio, 4K', () => {
    const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
    expect(c.supportsFirstLastFrame).toBe(true)
    expect(c.supportsVideoRef).toBe(true)
    expect(c.supportsGenerateAudio).toBe(true)
    expect(c.allowedResolutions).toContain('4k')
    expect(c.firstLastFrameLabel).toBe('严格首尾帧')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared exec vitest run src/videoModelCapabilities.test.ts`

- [ ] **Step 3: Implement resolver**

```typescript
import { resolveVideoModelProfile, type VideoModelProfile } from './videoModelProfiles'

export interface VideoModelCapabilities {
  supportsFirstLastFrame: boolean
  supportsKeyframes: boolean
  supportsVideoRef: boolean
  supportsAudioRef: boolean
  supportsGenerateAudio: boolean
  supportsReturnLastFrame: boolean
  supports4K: boolean
  allowedAspectRatios: string[]
  allowedResolutions: string[]
  minDuration: number
  maxImageRefs: number
  maxVideoRefs: number
  maxAudioRefs: number
  firstLastFrameLabel: string
  keyframesLabel: string
}

export function resolveVideoModelCapabilities(
  modelKey: string,
  gatewayModelId?: string,
): VideoModelCapabilities {
  const profile = resolveVideoModelProfile(modelKey, gatewayModelId ?? modelKey)
  const isAgnes = profile.refWire === 'agnes_single_image' || profile.refWire === 'agnes_keyframes'
  const isSeedance = profile.refWire === 'apimart_multimodal' || profile.refWire === 'apimart_first_last'
  return {
    supportsFirstLastFrame: isSeedance,
    supportsKeyframes: isAgnes || isSeedance,
    supportsVideoRef: profile.maxVideoRefs > 0,
    supportsAudioRef: profile.maxAudioRefs > 0,
    supportsGenerateAudio: profile.defaultGenerateAudio,
    supportsReturnLastFrame: isSeedance,
    supports4K: profile.maxResolution === '4k',
    allowedAspectRatios: profile.allowedAspectRatios,
    allowedResolutions: profile.allowedResolutions,
    minDuration: profile.minDuration,
    maxImageRefs: profile.maxImageRefs,
    maxVideoRefs: profile.maxVideoRefs,
    maxAudioRefs: profile.maxAudioRefs,
    firstLastFrameLabel: isSeedance ? '严格首尾帧' : '关键帧过渡',
    keyframesLabel: isAgnes ? '关键帧过渡' : '多图参考',
  }
}
```

- [ ] **Step 4: Export from index.ts**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/videoModelCapabilities.ts packages/shared/src/videoModelCapabilities.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add VideoModelCapabilities SSOT for I2V productization"
```

---

### Task 1: 能力徽章 + videoMode 文案（P0，G-01）

**Files:**
- Create: `apps/web/src/composables/useVideoModelCapabilities.ts`
- Create: `apps/web/src/components/canvas/dock-studio/shared/VideoCapabilityBadges.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`

**Interfaces:**
- Consumes: `resolveVideoModelCapabilities` from `@lnkpi/shared`
- Produces: `useVideoModelCapabilities(videoModelRef)` → `{ capabilities, badges }`

- [ ] **Step 1: Write composable test**

Create `apps/web/src/composables/useVideoModelCapabilities.test.ts` — mock model id，断言 Agnes 无「原生音频」徽章。

- [ ] **Step 2: Implement `VideoCapabilityBadges.vue`**

渲染 chips：`首尾帧/关键帧` `V*A*` `4K` `连续镜`（按 capabilities 过滤）。

- [ ] **Step 3: Wire VideoDockPanel**

- `UniversalModelSelector` 下方展示 `<VideoCapabilityBadges />`
- 三态 segment 文案：
  - Agnes：`图生视频` / `关键帧过渡`（隐藏或禁用「严格首尾帧」当 `!supportsFirstLastFrame`）
  - Seedance：`图生视频` / `严格首尾帧`
- 当用户选 Agnes 且当前 `videoMode === 'first_last_frame'`，自动降级为 `image_to_video` 并 toast 提示

- [ ] **Step 4: Vitest + manual smoke**

Run: `cd apps/web && pnpm exec vitest run src/composables/useVideoModelCapabilities.test.ts`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): I2V capability badges and model-aware videoMode labels"
```

---

### Task 2: 假控件修正（P0/P1，G-02/G-03）

**Files:**
- Modify: `apps/web/src/components/canvas/VideoSettingsSelector.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`（传入 capabilities）

**Interfaces:**
- Consumes: `VideoModelCapabilities`

- [ ] **Step 1: Write failing test**

Extend `VideoSettingsSelector` 或 Dock 相关 test：`supportsGenerateAudio=false` 时不渲染 audio toggle。

- [ ] **Step 2: Hide generateAudio when `!capabilities.supportsGenerateAudio`**

- [ ] **Step 3: Hide crop when catalog disposition is metadataOnly**

读取 `resolveModelKey('video', modelKey).entry.params.crop !== 'native'` 时隐藏 crop 区块（或显示「当前模型不支持」disabled 态，**不写入节点**）。

- [ ] **Step 4: Agnes minDuration 提示**

当 `capabilities.minDuration > 4` 且用户选 4s，popover 提示「该模型最短 5 秒」（G-13）。

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(web): hide unsupported video settings per model capabilities"
```

---

### Task 3: 扩展 aspectRatio / resolution（P1，G-04/G-05）

**Files:**
- Modify: `packages/shared/src/index.ts` — 新增 `videoAspectRatioOptionsForProfile(profile)` helper
- Modify: `apps/web/src/components/canvas/VideoSettingsSelector.vue`

**Interfaces:**
- Consumes: `VideoModelCapabilities.allowedAspectRatios` / `allowedResolutions`

- [ ] **Step 1: Test helper**

```typescript
it('seedance standard includes 4k and 21:9', () => {
  const c = resolveVideoModelCapabilities('seedance-2.0', SEEDANCE_20_GATEWAYS.standard)
  expect(c.allowedResolutions).toContain('4k')
  expect(c.allowedAspectRatios).toContain('21:9')
})
```

- [ ] **Step 2: VideoSettingsSelector 动态 options**

替换硬编码 `VIDEO_ASPECT_RATIO_OPTIONS` / `VIDEO_RESOLUTION_OPTIONS` 为 profile 过滤后的子集；保留 DEFAULT 回退。

- [ ] **Step 3: 若当前值不在 allowed 集，patch 为最近合法值**

- [ ] **Step 4: `pnpm build`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): profile-driven video aspect ratio and resolution options"
```

---

### Task 4: RefStrip 角色标注 + videoMode 校验（P1，G-09）

**Files:**
- Modify: `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`

**Interfaces:**
- Consumes: `refs: NodeRef[]`, `videoMode`, `capabilities`

- [ ] **Step 1: Write test for ref role labels**

在 `VideoDockPanel` 或 RefStrip test：2 个 image ref + `first_last_frame` → 显示「首帧」「末帧」。

- [ ] **Step 2: Implement role badge logic**

| 条件 | @I1 | @I2 | @V1 | @A1 |
|---|---|---|---|---|
| first_last_frame + 2 images | 首帧 | 末帧 | 运镜 | 音频 |
| image_to_video + N images | 参考 | 参考 | 运镜 | 音频 |

- [ ] **Step 3: Pre-generate validation in VideoDockPanel**

- 选 first_last_frame 但 image ref ≠ 2 → 禁用生成按钮 + tooltip
- 有 V/A ref 但 `!supportsVideoRef` → 警告 banner「当前模型不支持视频/音频参考，请换 Seedance」

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): ref role labels and videoMode validation in video dock"
```

---

### Task 5: 纯音频 S7 友好错误（P1）

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.test.ts`

- [ ] **Step 1: Write failing test**

仅 audio ref、无 image/video → `generateForNode` patch error「需要 Seedance 且至少一张参考图」。

- [ ] **Step 2: Implement client-side guard before `startVideoGeneration`**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(web): block audio-only video refs with clear error message"
```

---

### Task 6: S8 连续镜 — lastFrameUrl 写回 + 「接下一段」（P2，G-08）

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts`（已有 partial lastFrameUrl patch，补全 Seedance path）
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue`

**Interfaces:**
- Consumes: `parseRecordLastFrameUrl`, generation record metadata / Apimart last_frame_url

- [ ] **Step 1: Verify Apimart lastFrameUrl flows to node.data**

Read `useNodeGeneration.ts` resolveStudioRecord path；补 test：completed record 含 lastFrame → `patchNodeData({ lastFrameUrl })`。

- [ ] **Step 2: Add 「接下一段」button**

当 `node.data.lastFrameUrl` 存在且 `capabilities.supportsReturnLastFrame`：
- 点击 → 新建 sibling video 节点（或 patch 当前）with localRefs from lastFrame + prompt 保留
- 可选：自动连 edge from self

- [ ] **Step 3: Manual + prod smoke path1**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): persist lastFrameUrl and add continue-shot action for Seedance"
```

---

### Task 7: 高级选项 seed / negative_prompt（P2，G-06）

**Files:**
- Modify: `packages/shared/src/videoGeneration/types.ts` — optional `seed?`, `negativePrompt?`
- Modify: `apps/server/src/studio/video-generation-request.util.ts`
- Modify: `packages/agent/src/studio/generation-adapter.ts` — pass to providerOptions
- Modify: `apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue` — collapsible「高级」

- [ ] **Step 1: Extend canonical type + DTO**

- [ ] **Step 2: Adapter pass-through when provider supports**

- [ ] **Step 3: UI collapsible（默认折叠）**

- [ ] **Step 4: Server test — seed forwarded to AgnesVideoProvider mock**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat: optional seed and negativePrompt for video generation"
```

---

### Task 8: API 文档 + refs×videoMode 集成测试（P2，G-12）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-i2v-upstream-capability-audit-design.md` — 附录 API 示例
- Create or extend: `apps/server/src/studio/video-generation.integration.test.ts`

- [ ] **Step 1: Add markdown appendix §A — POST /studio/video/start 示例矩阵**

| videoMode | refs | 预期 scenario |
|---|---|---|
| image_to_video | 1×I | S2 |
| first_last_frame | 2×I | S5 (Seedance) |
| image_to_video | 2×I | S4 |
| text_to_video | 1×V | S6 |

- [ ] **Step 2: Integration test — buildVideoProviderOptions for each row**

- [ ] **Step 3: Commit + PR**

```bash
git commit -m "docs(test): I2V API matrix examples and integration coverage"
gh pr create --base main --title "feat: I2V capability productization (P0-P2)" ...
```

---

### Task 9: 规格状态更新 + 生产回归

**Files:**
- Modify: `docs/superpowers/specs/2026-08-15-i2v-upstream-capability-audit-design.md`

- [ ] **Step 1: Update §0 状态 → P0–P2 已完成**

- [ ] **Step 2: Run full validation**

```bash
pnpm verify-u-i2v-phase3
pnpm build
python3 deploy/prod-canvas-i2v-video-verify.py
python3 deploy/prod-agent-i2v-video-verify.py
```

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: mark I2V capability audit spec as implemented"
```

---

## Self-Review（Plan vs Spec §8 Gap Register）

| Gap ID | Task | 覆盖 |
|---|---|:---:|
| G-01 | Task 1 | ✅ |
| G-02 | Task 2 | ✅ |
| G-03 | Task 2 | ✅ |
| G-04 | Task 3 | ✅ |
| G-05 | Task 3 | ✅ |
| G-06 | Task 7 | ✅ |
| G-07 | — | ⏭️ 刻意不做（metadata 无消费者） |
| G-08 | Task 6 | ✅ |
| G-09 | Task 4 | ✅ |
| G-10 | — | ⏭️ C2 Epic，out of scope |
| G-11 | — | ⏭️ out of scope |
| G-12 | Task 8 | ✅ |
| G-13 | Task 2 | ✅ |

**Placeholder scan：** 无 TBD/TODO。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-15-i2v-capability-productization.md`.

**Two execution options:**

1. **Subagent-Driven（推荐）** — 每 Task 派发独立 subagent，Task 间 review（`superpowers:subagent-driven-development`）
2. **Inline Execution** — 本会话按 Task 0→9 顺序执行（`superpowers:executing-plans`）

**Which approach?**
