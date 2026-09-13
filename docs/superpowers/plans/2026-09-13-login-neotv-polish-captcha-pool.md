# Login Neo-TV Polish + Captcha Image Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish fullscreen login to neo-tv feel (65/35, playable video + left dots) and replace SVG purple captcha with server-side image-pool gap cutting (≥3 shapes, ≤10 local images).

**Architecture:** Keep ticket gating. Extend `CaptchaService` to load local backgrounds, cut holes with `sharp` + SVG masks (`rect|circle|puzzle`), return PNG data URLs. Refresh `SliderCaptchaOverlay` glass UI. Update `LoginDialog`/`LoginVideoPanel` for layout and playback.

**Tech Stack:** NestJS + Vitest + sharp; Vue 3 + existing neo tokens; no new npm deps.

**Spec:** [docs/superpowers/specs/2026-09-13-login-neotv-polish-captcha-pool-design.md](../specs/2026-09-13-login-neotv-polish-captcha-pool-design.md)

## Global Constraints

- Desktop split: video **65%** / form **35%**
- Captcha assets: local only, **≤10** images, **≥3** shapes
- `targetX` server-only; tolerance **5px**
- Copy:「拖动滑块完成验证」/「将滑块拖动到正确位置」
- Do not change `AUTH_CAPTCHA_MODE` semantics
- Commit per task; do not stage unrelated dirty files

## File map

| File | Role |
| --- | --- |
| `apps/server/assets/captcha/bg-0N.jpg` | ≤10 local backgrounds |
| `apps/server/assets/captcha/LICENSE.md` | Asset licenses |
| `apps/server/src/auth/captcha.types.ts` | Add optional `shape` |
| `apps/server/src/auth/captcha.shapes.ts` | SVG mask path builders |
| `apps/server/src/auth/captcha.service.ts` | Pool + sharp cut |
| `apps/server/src/auth/captcha.service.test.ts` | TDD |
| `apps/web/.../captcha-types.ts` | Mirror `shape?` |
| `apps/web/.../SliderCaptchaOverlay.vue` | Scheme A UI |
| `apps/web/.../LoginVideoPanel.vue` | autoplay + left dots |
| `apps/web/.../LoginDialog.vue` | 65/35 shell |

---

### Task 1: Captcha types + shape masks + image pool assets

**Files:**
- Create: `apps/server/src/auth/captcha.shapes.ts`
- Create: `apps/server/assets/captcha/bg-01.jpg` … (6–8 files, ≤10)
- Create: `apps/server/assets/captcha/LICENSE.md`
- Modify: `apps/server/src/auth/captcha.types.ts`

**Interfaces:**
- Produces: `CaptchaShapeId = 'rect' | 'circle' | 'puzzle'`
- Produces: `buildShapeMaskSvg(shape, pieceSize): string` — white shape on transparent for sharp mask
- Produces: `SliderPuzzleMeta.shape?: CaptchaShapeId`

- [ ] **Step 1: Extend types**

```ts
export type CaptchaShapeId = 'rect' | 'circle' | 'puzzle'

export type SliderPuzzleMeta = {
  width: number
  height: number
  pieceSize: number
  y: number
  shape?: CaptchaShapeId
}
```

- [ ] **Step 2: Implement shape SVG masks** (rect rx=8, circle, puzzle with one top tab + right tab)

- [ ] **Step 3: Seed ≤10 dark cinematic JPEGs** into `apps/server/assets/captcha/` via a one-shot `sharp` script (or Mixkit/Pexels stills). Document in LICENSE.md. Prefer generating 6 muted cinematic stills with sharp if downloads blocked.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/auth/captcha.types.ts apps/server/src/auth/captcha.shapes.ts apps/server/assets/captcha/
git commit -m "feat(server): captcha shape masks and local image pool"
```

---

### Task 2: CaptchaService sharp cutting (TDD)

**Files:**
- Modify: `apps/server/src/auth/captcha.service.ts`
- Modify: `apps/server/src/auth/captcha.service.test.ts`

**Interfaces:**
- Consumes: assets dir + `buildShapeMaskSvg`
- Produces: `createChallenge()` with PNG/WebP data URLs, random image+shape; fallback procedural if pool empty
- `verifySlide` unchanged semantics (5px, keep on fail)

- [ ] **Step 1: Rewrite tests** for raster URLs, shape diversity (≥3 across many calls), verifySlide scan

- [ ] **Step 2: RED** — `pnpm --filter @lnkpi/server exec vitest run src/auth/captcha.service.test.ts`

- [ ] **Step 3: Implement** — load pool from `apps/server/assets/captcha`; resize 280×160; composite hole; extract piece with padding for puzzle tabs; fallback if sharp/pool fails

- [ ] **Step 4: GREEN** — captcha + full `src/auth/` PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/captcha.service.ts apps/server/src/auth/captcha.service.test.ts
git commit -m "feat(server): cut captcha gaps from local image pool with sharp"
```

---

### Task 3: SliderCaptchaOverlay scheme A UI

**Files:**
- Modify: `apps/web/src/components/auth/captcha-types.ts`
- Modify: `apps/web/src/components/auth/SliderCaptchaOverlay.vue`

- [ ] **Step 1: Mirror optional `shape` on web types**
- [ ] **Step 2: Restyle overlay** to glass card (scheme A): dark elevated + blur, light thumb, no purple board chrome
- [ ] **Step 3: Commit** `feat(web): scheme A glass UI for slider captcha`

---

### Task 4: LoginVideoPanel playback + left dots

**Files:**
- Modify: `apps/web/src/components/auth/LoginVideoPanel.vue`

- [ ] **Step 1: `autoplay` + play on `loadeddata`/`canplay`; retry once**
- [ ] **Step 2: Left vertical dots**; click switches + plays; keep caption/crossfade; reduced-motion keeps clip 0 (dots still work)
- [ ] **Step 3: Slight inset + rounded stage**
- [ ] **Step 4: Commit** `feat(web): login video autoplay and left theme dots`

---

### Task 5: LoginDialog 65/35 + spec status

**Files:**
- Modify: `apps/web/src/components/auth/LoginDialog.vue`
- Modify: `docs/superpowers/specs/2026-09-13-login-neotv-polish-captcha-pool-design.md`

- [ ] **Step 1: Desktop video `w-[65%]` / form ~35%**
- [ ] **Step 2: Spec status → 已实现**
- [ ] **Step 3: `pnpm --filter @lnkpi/server exec vitest run src/auth/` PASS**
- [ ] **Step 4: Commit** `feat(web): login shell 65/35 split and mark spec implemented`

---

## Plan self-review

| Spec item | Task |
| --- | --- |
| 65/35 | T5 |
| Left dots + autoplay | T4 |
| ≤10 images, local | T1 |
| ≥3 shapes + sharp cut | T1–T2 |
| Scheme A UI | T3 |
| Modes unchanged | untouched |
