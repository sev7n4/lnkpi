# Image Prompting Guide Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed OpenAI API《Image prompting》P0 scenes/intents into lnkpi via a dual-track Catalog, Dock pickers, param capability gates, and Agent taxonomy hooks — without wiring Image 2.5 models yet.

**Architecture:** Add `@lnkpi/shared` `imagePromptingGuide` catalog (generation scenes + edit intents + fundamentals). Resolve preferred params against model profile capabilities (`resolveGuideRequest`). Dock applies scaffolds; Refine applies change/preserve templates. Prompt expand optionally overlays scene system fragments. Agent-runtime adds parallel taxonomy that only writes `guideSceneId` / `guideEditIntentId`.

**Tech Stack:** TypeScript (`@lnkpi/shared`, `@lnkpi/agent`), Vitest, Vue 3 Dock/Refine, Python agent-runtime + PyYAML taxonomy, Nest `studio.service` prompt generate path.

**Spec:** [2026-09-11-image-prompting-guide-catalog-design.md](../specs/2026-09-11-image-prompting-guide-catalog-design.md)

## Global Constraints

- Branch: continue `feature/image-prompting-guide-catalog-spec` or rename to `feature/image-prompting-guide-catalog` before code PRs — **禁止直推 main**
- 本期模型仍为 `image2`；不新增 `gpt-image-2.5-*` catalog 条目
- 禁止假透明（棋盘格像素冒充 alpha）；E5 无 capability 时必须 blocked
- 不把 E* / G* 塞进 `PromptModeId` 联合类型
- Agent 钩子只写 guide id，不改变现有自动出图主路径
- 本地验证：`pnpm --filter @lnkpi/shared test`、`pnpm --filter @lnkpi/agent test`、相关 web vitest、`pytest` taxonomy 单测；PR 前 `pnpm build`
- Squash merge；Image 2.5 验证流程只保留在 design 附录，本期不实现模型接线

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/imagePromptingGuide/types.ts` | Guide 类型与 ParamContract / CapabilityGate |
| `packages/shared/src/imagePromptingGuide/fundamentals.ts` | 官方 8 条 fundamentals 文本 |
| `packages/shared/src/imagePromptingGuide/scenes/*.ts` | G3 / G1 资产 |
| `packages/shared/src/imagePromptingGuide/intents/*.ts` | E3 / E4 / E5 资产 |
| `packages/shared/src/imagePromptingGuide/catalog.ts` | 注册表 + getters |
| `packages/shared/src/imagePromptingGuide/resolveGuideRequest.ts` | 参数契约解析 / blocked |
| `packages/shared/src/imagePromptingGuide/index.ts` | 桶导出 |
| `packages/shared/src/imageModelProfiles.ts` | 增加 `capabilities` |
| `packages/shared/src/imageEditProfiles.ts` | 增加 `capabilities` |
| `packages/shared/src/index.ts` | `export * from './imagePromptingGuide'` |
| `packages/agent/src/prompt-modes/generate.ts` | 可选 `guideSceneId` 叠加 system |
| `packages/agent/src/prompt-modes/image-prompting-guide-taxonomy.yaml` | 共享 taxonomy 源 |
| `apps/web/.../guideSceneApply.ts` (+ test) | Dock 选 scene 纯函数 |
| `apps/web/.../PromptDockPanel.vue` | 场景芯片 UI |
| `apps/web/.../ImageDockPanel.vue` | 可选套用场景 |
| `apps/web/.../guideEditIntentApply.ts` (+ test) | Refine intent 纯函数 |
| `apps/web/.../RefineSidePanel.vue` | intent 芯片 + 门禁 |
| `apps/server/src/studio/studio.service.ts` | generatePrompt 透传 guideSceneId |
| `services/agent-runtime/app/tools/guide_taxonomy.py` | resolve_guide_* |
| `services/agent-runtime/skills/atomic-create/assets/image-prompting-guide-taxonomy.yaml` | skill 同步副本 |
| `services/agent-runtime/app/graph/nodes/atomic_parse.py` | 挂 guide id 到结果 |

---

### Task 1: Shared types + fundamentals + empty catalog registry

**Files:**
- Create: `packages/shared/src/imagePromptingGuide/types.ts`
- Create: `packages/shared/src/imagePromptingGuide/fundamentals.ts`
- Create: `packages/shared/src/imagePromptingGuide/catalog.ts`
- Create: `packages/shared/src/imagePromptingGuide/index.ts`
- Create: `packages/shared/src/imagePromptingGuide/catalog.test.ts`
- Modify: `packages/shared/src/index.ts` — add `export * from './imagePromptingGuide'`

**Interfaces:**
- Produces: `GenerationScene`, `EditIntent`, `GuideCapabilities`, `listGenerationScenes()`, `listEditIntents()`, `getGenerationScene(id)`, `getEditIntent(id)`, `FUNDAMENTALS`, `formatFundamentalsBlock(ids?: string[])`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/imagePromptingGuide/catalog.test.ts
import { describe, expect, it } from 'vitest'
import {
  FUNDAMENTALS,
  formatFundamentalsBlock,
  listEditIntents,
  listGenerationScenes,
} from './catalog'

describe('imagePromptingGuide catalog scaffold', () => {
  it('exposes eight fundamentals', () => {
    expect(FUNDAMENTALS).toHaveLength(8)
    expect(FUNDAMENTALS[0]?.id).toBe('define_result')
  })

  it('lists empty P0 registries until scenes/intents land', () => {
    expect(listGenerationScenes()).toEqual([])
    expect(listEditIntents()).toEqual([])
  })

  it('formats fundamentals block', () => {
    const block = formatFundamentalsBlock(['define_result', 'exact_text'])
    expect(block).toContain('Define the result')
    expect(block).toContain('Specify exact text')
  })
})
```

Note: after Task 3, update this test to expect P0 ids instead of empty arrays (or move empty-registry assertions into Task 3). For Task 1 only, keep registries as empty arrays in `catalog.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared test -- src/imagePromptingGuide/catalog.test.ts`  
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```ts
// types.ts (key exports)
export type GuideKind = 'generation_scene' | 'edit_intent'

export interface ParamContract {
  size?: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: 'png' | 'webp' | 'jpeg'
}

export interface CapabilityGate {
  requiresTransparentBackground?: boolean
  minRefImages?: number
  maxRefImages?: number
  requiresSubjectRef?: boolean
}

export interface GuideCapabilities {
  transparentBackground: boolean
  qualityParam: boolean
  maxRefImages: number
}

export interface GenerationScene {
  id: string
  kind: 'generation_scene'
  label: string
  description: string
  fundamentalsRefs: string[]
  promptScaffold: string
  systemOverlay?: string
  fewShot?: { user: string; assistant: string }
  preferredParams: ParamContract
  capability: CapabilityGate
  expandViaPromptMode?: string | null
}

export interface EditIntent {
  id: string
  kind: 'edit_intent'
  label: string
  description: string
  changePreserveTemplate: string
  refRoles: Array<{ role: string; required: boolean; hint: string }>
  preferredParams: ParamContract
  capability: CapabilityGate
}
```

```ts
// fundamentals.ts — 8 entries with id + enTitle + guidance
export const FUNDAMENTALS = [
  { id: 'define_result', enTitle: 'Define the result', guidance: 'Name subject, intended use, composition, and constraints.' },
  { id: 'maintainable_format', enTitle: 'Choose a maintainable format', guidance: 'Prefer skimmable structure over clever syntax.' },
  { id: 'visible_details', enTitle: 'Describe visible details', guidance: 'Materials, lighting, colors, medium; say photorealistic explicitly when needed.' },
  { id: 'people_actions', enTitle: 'Specify people and actions', guidance: 'Body framing, gaze, and interaction with objects.' },
  { id: 'exact_text', enTitle: 'Specify exact text', guidance: 'Quote required wording; forbid extra text; check spelling.' },
  { id: 'separate_changes', enTitle: 'Separate changes from constraints', guidance: 'For edits: change only X; list what must stay.' },
  { id: 'assign_ref_roles', enTitle: 'Assign roles to references', guidance: 'Number each input by purpose: subject, style, clothing, background.' },
  { id: 'iterate', enTitle: 'Iterate deliberately', guidance: 'One change per turn; restate critical preserve constraints.' },
] as const

export function formatFundamentalsBlock(ids?: string[]): string {
  const set = ids?.length ? new Set(ids) : null
  const items = set ? FUNDAMENTALS.filter((f) => set.has(f.id)) : [...FUNDAMENTALS]
  return items.map((f) => `- ${f.enTitle}: ${f.guidance}`).join('\n')
}
```

```ts
// catalog.ts Task 1 — empty registries
import { FUNDAMENTALS, formatFundamentalsBlock } from './fundamentals'
import type { EditIntent, GenerationScene } from './types'

const GENERATION_SCENES: GenerationScene[] = []
const EDIT_INTENTS: EditIntent[] = []

export { FUNDAMENTALS, formatFundamentalsBlock }
export function listGenerationScenes() { return GENERATION_SCENES }
export function listEditIntents() { return EDIT_INTENTS }
export function getGenerationScene(id: string) {
  return GENERATION_SCENES.find((s) => s.id === id)
}
export function getEditIntent(id: string) {
  return EDIT_INTENTS.find((i) => i.id === id)
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/shared test -- src/imagePromptingGuide/catalog.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/imagePromptingGuide packages/shared/src/index.ts
git commit -m "feat(shared): scaffold imagePromptingGuide catalog types"
```

---

### Task 2: `resolveGuideRequest` + profile capabilities

**Files:**
- Create: `packages/shared/src/imagePromptingGuide/resolveGuideRequest.ts`
- Create: `packages/shared/src/imagePromptingGuide/resolveGuideRequest.test.ts`
- Modify: `packages/shared/src/imageModelProfiles.ts` — add optional `capabilities?: GuideCapabilities`
- Modify: `packages/shared/src/imageEditProfiles.ts` — same
- Modify: existing profile tests — assert defaults
- Modify: `packages/shared/src/imagePromptingGuide/index.ts` — export resolver

**Interfaces:**
- Consumes: `GenerationScene | EditIntent`, `GuideCapabilities`
- Produces: `resolveGuideRequest(input)`, `defaultGuideCapabilities()`, `GuideResolveResult`

```ts
export interface GuideResolveInput {
  guide: GenerationScene | EditIntent
  capabilities: GuideCapabilities
  userOverrides?: Partial<ParamContract>
  refImageCount?: number
}

export interface GuideResolveResult {
  params: ParamContract
  applied: string[]
  skipped: string[]
  blocked?: { reason: string }
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { resolveGuideRequest } from './resolveGuideRequest'
import type { EditIntent } from './types'

const e5: EditIntent = {
  id: 'e5_transparent_cutout',
  kind: 'edit_intent',
  label: '透明抠图',
  description: 'x',
  changePreserveTemplate: 'Extract…',
  refRoles: [{ role: 'product', required: true, hint: '产品图' }],
  preferredParams: { background: 'transparent', outputFormat: 'png', quality: 'medium' },
  capability: { requiresTransparentBackground: true, minRefImages: 1 },
}

describe('resolveGuideRequest', () => {
  it('blocks E5 when transparentBackground is false', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.blocked?.reason).toMatch(/transparent/i)
    expect(r.applied).toEqual([])
  })

  it('applies transparent when capability true', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.blocked).toBeUndefined()
    expect(r.params.background).toBe('transparent')
    expect(r.applied).toContain('background')
  })

  it('skips quality when qualityParam false', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: false, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.skipped).toContain('quality')
    expect(r.params.quality).toBeUndefined()
  })

  it('blocks when minRefImages not met', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: true, maxRefImages: 4 },
      refImageCount: 0,
    })
    expect(r.blocked?.reason).toMatch(/ref/i)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/shared test -- src/imagePromptingGuide/resolveGuideRequest.test.ts`

- [ ] **Step 3: Implement resolver + profile defaults**

Logic order:
1. If `requiresTransparentBackground && !capabilities.transparentBackground` → blocked
2. If `minRefImages` and `(refImageCount ?? 0) < minRefImages` → blocked
3. Merge preferredParams; unsupported keys → skipped; else applied
4. `userOverrides` win over preferred for non-blocked keys
5. `defaultGuideCapabilities()` → `{ transparentBackground: false, qualityParam: true, maxRefImages: 4 }`

Add `capabilities?: GuideCapabilities` on `ImageModelProfile` and `ImageEditModelProfile`; wire image2/edit to defaults.

- [ ] **Step 4: Run shared tests — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(shared): resolveGuideRequest and profile capabilities"
```

---

### Task 3: P0 scene + intent assets

**Files:**
- Create: `packages/shared/src/imagePromptingGuide/scenes/g3-exact-text.ts`
- Create: `packages/shared/src/imagePromptingGuide/scenes/g1-style-lighting.ts`
- Create: `packages/shared/src/imagePromptingGuide/intents/e3-identity-clothing.ts`
- Create: `packages/shared/src/imagePromptingGuide/intents/e4-combine-refs.ts`
- Create: `packages/shared/src/imagePromptingGuide/intents/e5-transparent-cutout.ts`
- Modify: `packages/shared/src/imagePromptingGuide/catalog.ts` — register all five
- Modify: `packages/shared/src/imagePromptingGuide/catalog.test.ts` — assert P0 ids (replace empty-registry expectations)

**Interfaces:**
- Stable ids: `g3_exact_text`, `g1_style_lighting`, `e3_identity_clothing`, `e4_combine_refs`, `e5_transparent_cutout`

- [ ] **Step 1: Write failing catalog assertions**

```ts
it('registers P0 generation scenes', () => {
  expect(listGenerationScenes().map((s) => s.id).sort()).toEqual([
    'g1_style_lighting',
    'g3_exact_text',
  ])
})

it('registers P0 edit intents', () => {
  expect(listEditIntents().map((i) => i.id).sort()).toEqual([
    'e3_identity_clothing',
    'e4_combine_refs',
    'e5_transparent_cutout',
  ])
})

it('E5 requires transparent capability', () => {
  expect(getEditIntent('e5_transparent_cutout')?.capability.requiresTransparentBackground).toBe(true)
})
```

- [ ] **Step 2: Run — FAIL on empty registry**

- [ ] **Step 3: Fill assets from official guide patterns**

Required content:
- G3: quoted tagline slot, render exactly once, no extra text
- G1: subject / framing / light / texture / no heavy retouching
- E3: change only clothing; preserve face/identity/pose/background
- E4: place subject from image 2 into scene of image 1; change nothing else
- E5: isolate product; transparent background; no checkerboard/scenery

Set `expandViaPromptMode: 'image_prompt_multi_style'` for G1/G3.  
E3/E4 `minRefImages: 2`; E5 `minRefImages: 1` + `requiresTransparentBackground: true`.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(shared): add P0 image prompting guide scenes and intents"
```

---

### Task 4: Prompt generate overlay for `guideSceneId`

**Files:**
- Modify: `packages/agent/src/prompt-modes/generate.ts`
- Create: `packages/agent/src/prompt-modes/generate-guide-overlay.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts` — pass `guideSceneId` from body/node into generate opts

**Interfaces:**
- Consumes: `getGenerationScene`, `formatFundamentalsBlock`
- Produces: `buildGuideSystemOverlay(guideSceneId?: string): string | null`; `generatePromptContent(..., opts?: { guideSceneId?: string })`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildGuideSystemOverlay } from './generate'

describe('guideScene overlay', () => {
  it('builds G3 overlay with fundamentals', () => {
    const overlay = buildGuideSystemOverlay('g3_exact_text')
    expect(overlay).toBeTruthy()
    expect(overlay!).toMatch(/exact|tagline|文字/i)
    expect(overlay!).toContain('-')
  })

  it('returns null for unknown id', () => {
    expect(buildGuideSystemOverlay('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement**

```ts
export function buildGuideSystemOverlay(guideSceneId?: string): string | null {
  if (!guideSceneId) return null
  const scene = getGenerationScene(guideSceneId)
  if (!scene) return null
  const fundamentals = formatFundamentalsBlock(scene.fundamentalsRefs)
  return [scene.systemOverlay, fundamentals].filter(Boolean).join('\n\n')
}

// messages system:
const overlay = buildGuideSystemOverlay(opts?.guideSceneId)
const system = overlay ? `${def.system}\n\n## Image prompting guide\n${overlay}` : def.system
```

```ts
export async function generatePromptFromUserInput(prompt, opts) {
  const scene = opts?.guideSceneId ? getGenerationScene(opts.guideSceneId) : undefined
  const forced = scene?.expandViaPromptMode
  const mode =
    forced && forced in /* PromptModeId set */ 
      ? (forced as PromptModeId)
      : (await classifyPromptMode(prompt, opts)).mode
  return generatePromptContent(prompt, mode, opts)
}
```

Studio: when calling `generatePromptFromUserInput`, pass `guideSceneId` from request/node.data.

- [ ] **Step 4: `pnpm --filter @lnkpi/agent test` PASS for overlay tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): overlay guide scene rules on prompt generate"
```

---

### Task 5: Dock apply helpers + Prompt/Image Dock UI

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/panels/guideSceneApply.ts`
- Create: `apps/web/src/components/canvas/dock-studio/panels/guideSceneApply.test.ts`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue`
- Modify: `apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue`

**Interfaces:**

```ts
export function applyGuideSceneToPrompt(input: {
  sceneId: string
  currentPrompt: string
}): { prompt: string; guideSceneId: string; didPrefill: boolean; label: string }

export function clearGuideScene(): { guideSceneId: null }
```

- [ ] **Step 1: Failing tests**

```ts
it('prefills when prompt empty', () => {
  const r = applyGuideSceneToPrompt({ sceneId: 'g3_exact_text', currentPrompt: '' })
  expect(r.didPrefill).toBe(true)
  expect(r.prompt.length).toBeGreaterThan(10)
  expect(r.guideSceneId).toBe('g3_exact_text')
})

it('does not overwrite non-empty prompt', () => {
  const r = applyGuideSceneToPrompt({ sceneId: 'g3_exact_text', currentPrompt: 'keep me' })
  expect(r.didPrefill).toBe(false)
  expect(r.prompt).toBe('keep me')
  expect(r.guideSceneId).toBe('g3_exact_text')
})
```

- [ ] **Step 2: Run web vitest — FAIL**

- [ ] **Step 3: Implement helper + chips**

PromptDockPanel / ImageDockPanel:
- Chip row from `listGenerationScenes()`
- Active when `node.data.guideSceneId` matches
- onSelect → helper → `emit('patch', { prompt, guideSceneId })`
- Clear sets `guideSceneId: null` without wiping prompt

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): Prompt/Image Dock guide scene chips"
```

---

### Task 6: Refine edit intent chips + gates

**Files:**
- Create: `apps/web/src/components/canvas/refine/guideEditIntentApply.ts`
- Create: `apps/web/src/components/canvas/refine/guideEditIntentApply.test.ts`
- Modify: `apps/web/src/components/canvas/refine/RefineSidePanel.vue`

**Interfaces:**

```ts
export function editIntentDisabledReason(
  intentId: string,
  capabilities: GuideCapabilities,
): string | null

export function applyGuideEditIntent(input: {
  intentId: string
  capabilities: GuideCapabilities
  refImageCount: number
}): { ok: true; prompt: string; guideEditIntentId: string; label: string }
  | { ok: false; reason: string; disabled: boolean }
```

- [ ] **Step 1: Failing tests**

```ts
it('disables E5 without transparent capability', () => {
  expect(
    editIntentDisabledReason('e5_transparent_cutout', {
      transparentBackground: false,
      qualityParam: true,
      maxRefImages: 4,
    }),
  ).toMatch(/透明|transparent/i)
})

it('fills E3 template when ok', () => {
  const r = applyGuideEditIntent({
    intentId: 'e3_identity_clothing',
    capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
    refImageCount: 2,
  })
  expect(r.ok).toBe(true)
  if (r.ok) expect(r.prompt).toMatch(/clothing|衣服|face|身份/i)
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement beside stain preset**

Use `resolveGuideRequest` + intent templates. Chips for `listEditIntents()`; E5 disabled + tooltip; on click fill prompt like `applyStainPreset`. Guard edit submit if still blocked.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): Refine edit intent chips with capability gates"
```

---

### Task 7: Agent taxonomy hooks

**Files:**
- Create: `packages/agent/src/prompt-modes/image-prompting-guide-taxonomy.yaml`
- Create: `services/agent-runtime/skills/atomic-create/assets/image-prompting-guide-taxonomy.yaml`
- Create: `services/agent-runtime/app/tools/guide_taxonomy.py`
- Create: `services/agent-runtime/tests/test_guide_taxonomy.py`
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`
- Modify: copy path that persists `promptMode` on nodes to also persist `guideSceneId` / `guideEditIntentId` when present (grep `promptMode` / `prompt_mode` in `agent-canvas-tools.service.ts`)

**Interfaces:**
- `resolve_guide_scene(utterance: str) -> str | None`
- `resolve_guide_edit_intent(utterance: str) -> str | None`

- [ ] **Step 1: Failing pytest**

```python
from app.tools.guide_taxonomy import resolve_guide_edit_intent, resolve_guide_scene

def test_g3_exact_text():
    assert resolve_guide_scene("广告图，标语必须精确文字 Yours to Create，不要多余字") == "g3_exact_text"

def test_e5_cutout():
    assert resolve_guide_edit_intent("把产品抠图做成透明底 PNG") == "e5_transparent_cutout"

def test_no_false_positive_on_hello():
    assert resolve_guide_scene("你好") is None
    assert resolve_guide_edit_intent("你好") is None
```

- [ ] **Step 2: Run — FAIL**

Run: `cd services/agent-runtime && python -m pytest tests/test_guide_taxonomy.py -v`

- [ ] **Step 3: Implement yaml + loader + parse hook**

```yaml
version: 1
generation_scenes:
  - id: g3_exact_text
    patterns: [精确文字, 标语必须, tagline, 不要多余字, render text]
  - id: g1_style_lighting
    patterns: [光影, 胶片感, 35mm, candid, 写实摄影]
edit_intents:
  - id: e3_identity_clothing
    patterns: [换装, 只换衣服, 保留脸, 试穿, identity]
  - id: e4_combine_refs
    patterns: [合成到场景, 放到场景, 图1图2, combine reference]
  - id: e5_transparent_cutout
    patterns: [抠图, 透明底, 去背景, cutout]
```

Path candidates mirror `prompt_mode_taxonomy.py`.  
`atomic_parse`: apply guide ids without clearing `prompt_mode`. If both scene and intent match, prefer intent for 换装/抠图/合成.

Wire node persistence wherever `promptMode` is written today.

- [ ] **Step 4: pytest PASS; existing prompt_mode tests green**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(runtime): image prompting guide taxonomy hooks"
```

---

### Task 8: End-to-end verification + PR

- [ ] **Step 1: Verification matrix**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/agent test
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/dock-studio/panels/guideSceneApply.test.ts src/components/canvas/refine/guideEditIntentApply.test.ts
cd services/agent-runtime && python -m pytest tests/test_guide_taxonomy.py -v
pnpm build
```

Expected: all PASS

- [ ] **Step 2: Manual checklist**

- [ ] Prompt Dock G3/G1: empty prefill; non-empty keep text
- [ ] Refine E3/E4 templates; E5 disabled tooltip
- [ ] Stain preset still works
- [ ] Prompt generate works without `guideSceneId`

- [ ] **Step 3: Open PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: Image Prompting Guide Catalog (P0)" --body "$(cat <<'EOF'
## Summary
- Dual-track imagePromptingGuide catalog (G3/G1 + E3/E4/E5) with fundamentals
- resolveGuideRequest + profile capabilities (E5 blocked without transparent)
- Dock scene chips + Refine intent chips
- Agent taxonomy hooks write guide ids only
- Image 2.5 model wiring deferred; see design appendix A

## Spec
- docs/superpowers/specs/2026-09-11-image-prompting-guide-catalog-design.md

## Test plan
- [ ] shared / agent / web guide unit tests
- [ ] pytest test_guide_taxonomy.py
- [ ] pnpm build
- [ ] Manual Dock + Refine checklist
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Catalog + types + fundamentals | T1 |
| Param contract + degradation | T2 |
| P0 G3/G1/E3/E4/E5 | T3 |
| Prompt expand overlay | T4 |
| Dock 可选 scene | T5 |
| Refine intents + E5 disable | T6 |
| Agent taxonomy 钩子 only | T7 |
| Image 2.5 附录不接线 | Global Constraints + T8 |
| 不塞进 PromptModeId | Global Constraints |
| 非空 prompt 不覆盖 | T5 |

No TBD placeholders. Id naming consistent across tasks.
