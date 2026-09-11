# Image Prompting Guide Catalog Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver minimal Dock/Refine scene-icon + searchable dropdown UX and register the remaining 12 official Image Prompting Guide scenes/intents on top of P0 Catalog.

**Architecture:** Extend `@lnkpi/shared` `imagePromptingGuide` with `groupId`/`groupLabel` and full G2/G4–G9 + E1/E2/E6–E8 assets. Add shared `GuidePickerPopover.vue`. Replace `DockToolbarShell` close `×` with a header-end slot used for scene/intent icons; Esc closes dock (nested: close popover first). Prompt/Image use generation mode; Refine uses edit-intent mode while keeping stain/replace chips. Sync taxonomy yaml + Python resolver.

**Tech Stack:** TypeScript (`@lnkpi/shared`), Vue 3 + Vitest (`apps/web`), Python taxonomy (`services/agent-runtime`), Nest unchanged except no new PromptModeId.

**Spec:** [2026-09-11-image-prompting-guide-catalog-fill-design.md](../specs/2026-09-11-image-prompting-guide-catalog-fill-design.md)

## Global Constraints

- Branch: `feature/image-prompting-guide-catalog-fill` — **禁止直推 main**
- 一次做满剩余 12 个 id；下拉搜索为主交互；**场景图标替换 `×`**；关闭仅 **空白 + Esc**
- 仍用 `image2`；G4/E5（及任何 `requiresTransparentBackground`）无透明底时列表禁用
- 不把 G/E 塞进 `PromptModeId`；不接 Image 2.5；不恢复主栏芯片墙
- Refine 保留「去除污渍瑕疵」「替换选区内容」快捷芯片
- 本地：`pnpm --filter @lnkpi/shared test`、相关 web vitest、`pytest tests/test_guide_taxonomy.py`；PR 前 `pnpm build`
- Squash merge

## File map

| File | Role |
|------|------|
| `packages/shared/src/imagePromptingGuide/types.ts` | Add `groupId` / `groupLabel` |
| `packages/shared/src/imagePromptingGuide/scenes/g2-*.ts` … `g9-*.ts` | New generation scenes |
| `packages/shared/src/imagePromptingGuide/intents/e1-*.ts` … | New edit intents |
| `packages/shared/src/imagePromptingGuide/catalog.ts` + `catalog.test.ts` | Register all 9+8 |
| `packages/shared/src/imagePromptingGuide/guideGroups.ts` | Group order + labels helper |
| `apps/web/.../GuidePickerPopover.vue` (+ optional `.test.ts` for filter helper) | Searchable grouped popover |
| `apps/web/.../guidePickerFilter.ts` (+ test) | Pure filter/group logic |
| `apps/web/.../DockToolbarShell.vue` | `headerEnd` slot; optional hide default close |
| `PromptDockPanel.vue` / `ImageDockPanel.vue` | Remove chip row; scene icon + popover |
| `RefineSidePanel.vue` | Edit-intent icon + popover |
| `CanvasPage.vue` (or dock host) | Esc closes selected dock when open |
| `image-prompting-guide-taxonomy.yaml` ×2 | New patterns |
| `guide_taxonomy.py` + `test_guide_taxonomy.py` | New id coverage |
| `deploy/prod-image-prompting-guide-verify.py` | Extend stamp cases |

---

### Task 1: Types + group helper + existing assets annotated

**Files:**
- Modify: `packages/shared/src/imagePromptingGuide/types.ts`
- Create: `packages/shared/src/imagePromptingGuide/guideGroups.ts`
- Create: `packages/shared/src/imagePromptingGuide/guideGroups.test.ts`
- Modify: existing `g1`/`g3`/`e3`/`e4`/`e5` assets to set `groupId`/`groupLabel`

**Interfaces:**
- Produces:

```ts
export type GuideGroupId =
  | 'photo_ad' | 'info_design' | 'brand_ui' | 'narrative'
  | 'local_edit' | 'identity_product' | 'ref_compose'

export const GUIDE_GROUP_ORDER: GuideGroupId[]
export function guideGroupLabel(id: GuideGroupId): string
```

- [ ] **Step 1: Failing test** — `guideGroupLabel('photo_ad') === '摄影/广告'`; order length 7
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement types + guideGroups; annotate P0 assets**
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** `feat(shared): add guide group metadata`

---

### Task 2: Register remaining 12 catalog assets

**Files:**
- Create scenes: `g2-process-infographic.ts`, `g4-reusable-logo.ts`, `g5-historical-context.ts`, `g6-comic-strip.ts`, `g7-interface-preview.ts`, `g8-scientific-visual.ts`, `g9-slides-charts.ts`
- Create intents: `e1-translate-layout.ts`, `e2-style-transfer.ts`, `e6-drawing-to-realistic.ts`, `e7-remove-object.ts`, `e8-insert-person.ts`
- Modify: `catalog.ts`, `catalog.test.ts`

**Interfaces:**
- Stable ids exactly as spec tables
- G4 + E5: `requiresTransparentBackground: true`
- G6: `expandViaPromptMode: 'storyboard'`
- Each asset: non-empty `promptScaffold` or `changePreserveTemplate`, `groupId`, `fundamentalsRefs`

- [ ] **Step 1: Update catalog.test.ts** to expect sorted 9 generation + 8 edit ids; assert G4/E5 transparent gate; G6 expandVia
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement assets + register**
- [ ] **Step 4: `pnpm --filter @lnkpi/shared test` PASS**
- [ ] **Step 5: Commit** `feat(shared): fill remaining image prompting guide catalog`

---

### Task 3: `guidePickerFilter` pure helper

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/shared/guidePickerFilter.ts`
- Create: `apps/web/src/components/canvas/dock-studio/shared/guidePickerFilter.test.ts`

**Interfaces:**

```ts
export function filterGuideItems<T extends { id: string; label: string; description: string; groupId?: string }>(
  items: T[],
  query: string,
): T[]

export function groupGuideItems<T extends { groupId?: string }>(
  items: T[],
  order: string[],
): Array<{ groupId: string; groupLabel: string; items: T[] }>
```

- [ ] **Step 1: Tests** — empty query returns all; query `logo` matches g4; grouping preserves order
- [ ] **Step 2: FAIL → implement → PASS**
- [ ] **Step 5: Commit** `feat(web): guide picker filter helpers`

---

### Task 4: `GuidePickerPopover.vue`

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/shared/GuidePickerPopover.vue`

**Behavior:**
- Props: `mode: 'generation_scene' | 'edit_intent'`, `activeId: string | null`, `capabilities` (for disable), `open`, anchor
- Emits: `select(id)`, `clear`, `close`
- Search input; grouped sections; disabled rows call `editIntentDisabledReason` / scene capability via `resolveGuideRequest` with `refImageCount` optional
- Esc while open emits `close` (popover only)
- 「清除场景」/「清除意图」 when `activeId` set

- [ ] **Step 1: Minimal component + story-less smoke** — if no component test harness, extract disable helper and unit-test it; mount optional
- [ ] **Step 2–4: Implement neo dark styles** matching `neo-chip` / refine dock tokens
- [ ] **Step 5: Commit** `feat(web): GuidePickerPopover searchable dropdown`

---

### Task 5: DockToolbarShell header slot + Esc close

**Files:**
- Modify: `DockToolbarShell.vue` — replace hard-coded close with:

```vue
<slot name="header-end">
  <!-- default empty: no × -->
</slot>
```

- For panels that still need close elsewhere: none for Prompt/Image per spec
- Modify: `CanvasPage.vue` (or wherever dock selection lives) — `keydown Escape` closes dock if open and popover not handling; verify blank-click path still works
- Grep all `DockToolbarShell` usages: Video/Text/etc. must still close — **pass `header-end` close button for non-guide docks** OR keep prop `showClose?: boolean` default true for backward compat, Prompt/Image set `showClose=false` and provide scene slot

**Recommended compat:**

```ts
showClose?: boolean // default true
```

Prompt/Image: `:show-close="false"` + `#header-end` scene button. Other docks unchanged.

- [ ] **Step 1: Test or manual checklist** for Text dock still has ×
- [ ] **Step 2: Implement shell + Esc**
- [ ] **Step 5: Commit** `feat(web): dock header-end slot and Esc close`

---

### Task 6: Wire Prompt + Image Dock

**Files:**
- Modify: `PromptDockPanel.vue` — remove chip `v-for` row; add scene icon in `header-end`; wire popover + existing `applyGuideSceneToPrompt` / clear / toast
- Modify: `ImageDockPanel.vue` — same; keep aspect mapping from Task prior if present

- [ ] **Step 1: Ensure guideSceneApply tests still pass**
- [ ] **Step 2: Implement UI wiring**
- [ ] **Step 5: Commit** `feat(web): Prompt/Image dock scene icon picker`

---

### Task 7: Wire Refine edit-intent picker

**Files:**
- Modify: `RefineSidePanel.vue` — keep stain/replace chips; remove E* from flat chip `v-for` (or keep none of E*); add edit-intent header icon + `GuidePickerPopover` mode=`edit_intent`; selecting calls `applyEditIntent`

- [ ] **Step 1: guideEditIntentApply tests still PASS**
- [ ] **Step 2: Implement**
- [ ] **Step 5: Commit** `feat(web): Refine edit-intent dropdown picker`

---

### Task 8: Taxonomy sync

**Files:**
- Modify: `packages/agent/src/prompt-modes/image-prompting-guide-taxonomy.yaml`
- Modify: `services/agent-runtime/skills/atomic-create/assets/image-prompting-guide-taxonomy.yaml`
- Modify: `services/agent-runtime/tests/test_guide_taxonomy.py` — add cases for e.g. `g6` 漫画分格, `e7` 去掉物体 / 去物体, `g4` logo 透明

- [ ] **Step 1: Failing pytest for new patterns**
- [ ] **Step 2: Update yaml → PASS**
- [ ] **Step 5: Commit** `feat(runtime): expand image prompting guide taxonomy`

---

### Task 9: Verify + PR

- [ ] **Step 1: Matrix**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/dock-studio/shared/guidePickerFilter.test.ts src/components/canvas/dock-studio/panels/guideSceneApply.test.ts src/components/canvas/refine/guideEditIntentApply.test.ts
cd services/agent-runtime && python -m pytest tests/test_guide_taxonomy.py -v
pnpm build
```

- [ ] **Step 2: Extend** `deploy/prod-image-prompting-guide-verify.py` with one new scene + one new intent utterance (atomic `帮我生成…`)
- [ ] **Step 3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "feat: Image Prompting Guide Catalog fill (minimal picker + 12 scenes)" --body "$(cat <<'EOF'
## Summary
- Full catalog G1–G9 + E1–E8 with group metadata
- Minimal dock: scene icon replaces ×; searchable GuidePickerPopover
- Refine: edit-intent dropdown; stain/replace chips kept
- Taxonomy + prod verify extended
- Image 2.5 still deferred

## Spec
- docs/superpowers/specs/2026-09-11-image-prompting-guide-catalog-fill-design.md

## Test plan
- [ ] shared/web/pytest matrix above
- [ ] Manual: Prompt/Image icon picker, Esc/blank close, Refine intent disable E5
- [ ] Prod smoke after deploy
EOF
)"
```

---

## Self-Review (plan vs spec)

| Spec item | Task |
|-----------|------|
| groupId metadata | T1 |
| 12 new assets + full registry | T2 |
| Dropdown search filter | T3–T4 |
| × → scene icon; Esc/blank | T5–T6 |
| Refine intent dropdown; stain chips | T7 |
| Taxonomy | T8 |
| Prod verify extend | T9 |
| No Image 2.5 / no PromptModeId | Global Constraints |

No TBD placeholders. Id list matches spec tables.
