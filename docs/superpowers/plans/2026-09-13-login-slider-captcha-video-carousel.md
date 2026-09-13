# Login Gap-Slider Captcha + 5-Video Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace block-puzzle captcha with GeeTest-style gap slider; replace single login video with five themed stock-loop crossfade carousel.

**Architecture:** Keep fullscreen `LoginDialog` + `send-code` ticket gating. Rewrite `CaptchaService` to issue SVG data-URL puzzles with server-only `targetX`; replace `BlockCaptchaOverlay` with `SliderCaptchaOverlay`; upgrade `LoginVideoPanel` to five loops.

**Tech Stack:** NestJS + Vitest, Vue 3 + Pinia, existing Neo tokens; no new captcha SDKs; no new npm deps (SVG data URLs for puzzles).

**Spec:** [docs/superpowers/specs/2026-09-13-login-slider-captcha-video-carousel-design.md](../specs/2026-09-13-login-slider-captcha-video-carousel-design.md)

## Global Constraints

- 缺口拼图滑块（非积木、非纯「拖到底」进度条）。
- `targetX` 仅存服务端；客户端只提交 `offsetX`。
- 对齐容差 **5px**。
- 文案：「拖动滑块完成验证」；辅助：「将滑块拖动到正确位置」。
- 视频 5 主题：运镜 / 科幻 / 电商 / 护肤 / 微观；公开可商用 + `LICENSE.md`。
- 保留 `AUTH_CAPTCHA_MODE`、`openLogin()`、无 `/login` 路由。
- Commit per task；勿混入无关文件。
- Auth tests: `pnpm --filter @lnkpi/server exec vitest run src/auth/`

## File map

| File | Role |
| --- | --- |
| `apps/server/src/auth/captcha.types.ts` | Slider challenge types |
| `apps/server/src/auth/captcha.service.ts` | SVG puzzle + verify offsetX |
| `apps/server/src/auth/captcha.service.test.ts` | Unit tests |
| `apps/server/src/auth/auth.controller.ts` | Verify DTO → offsetX |
| `apps/server/src/auth/auth.service.test.ts` | Adapt ticket acquisition |
| `apps/web/src/components/auth/captcha-types.ts` | Frontend mirror types |
| `apps/web/src/stores/auth.ts` | verifyCaptcha(challengeId, offsetX) |
| `apps/web/src/components/auth/SliderCaptchaOverlay.vue` | New UI |
| `apps/web/src/components/auth/BlockCaptchaOverlay.vue` | Delete |
| `apps/web/src/components/auth/LoginDialog.vue` | Import slider overlay |
| `apps/web/src/components/auth/LoginVideoPanel.vue` | 5-video carousel |
| `apps/web/public/auth/login-loop-0{1-5}.mp4` | Stock clips |
| `apps/web/public/auth/LICENSE.md` | Per-clip license |

---

### Task 1: CaptchaService slider rewrite (TDD)

**Files:**
- Modify: `apps/server/src/auth/captcha.types.ts`
- Modify: `apps/server/src/auth/captcha.service.ts`
- Modify: `apps/server/src/auth/captcha.service.test.ts`

**Interfaces:**
- Produces:
  - `createChallenge(): SliderCaptchaChallengePublic` → `{ challengeId, bgImage, pieceImage, puzzle: { width, height, pieceSize, y } }` (no `targetX`)
  - `verifySlide(challengeId: string, offsetX: number): { captchaTicket: string; expiresAt: string }`
  - `consumeTicket` unchanged
- Failed `verifySlide` must **not** delete the challenge (allow retries). Success deletes challenge. Tolerance = **5**.

- [ ] **Step 1: Rewrite failing tests**

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { CaptchaService } from './captcha.service'

describe('CaptchaService slider', () => {
  let service: CaptchaService
  const prev = process.env.AUTH_CAPTCHA_SECRET

  beforeEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = 'test-secret'
    service = new CaptchaService()
  })
  afterEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = prev
  })

  it('createChallenge returns images and puzzle meta without targetX', () => {
    const c = service.createChallenge()
    expect(c.challengeId).toMatch(/^ch_/)
    expect(c.bgImage.startsWith('data:image/svg+xml')).toBe(true)
    expect(c.pieceImage.startsWith('data:image/svg+xml')).toBe(true)
    expect(c.puzzle.width).toBeGreaterThan(100)
    expect(c.puzzle.pieceSize).toBeGreaterThan(20)
    expect((c as { targetX?: number }).targetX).toBeUndefined()
  })

  it('verifySlide issues ticket within 5px and rejects far offset', () => {
    const c = service.createChallenge()
    expect(() => service.verifySlide(c.challengeId, -9999)).toThrow()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let ticket: string | null = null
    for (let x = 0; x <= max; x++) {
      try {
        ticket = service.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch {
        /* keep scanning; challenge must survive failures */
      }
    }
    expect(ticket).toMatch(/^cpt_/)
  })

  it('consumeTicket still one-shot', () => {
    const c = service.createChallenge()
    const max = c.puzzle.width - c.puzzle.pieceSize
    let t = ''
    for (let x = 0; x <= max; x++) {
      try {
        t = service.verifySlide(c.challengeId, x).captchaTicket
        break
      } catch { /* */ }
    }
    expect(service.consumeTicket(t)).toBe('ok')
    expect(service.consumeTicket(t)).toBe('invalid')
  })
})
```

- [ ] **Step 2: Run RED**

`pnpm --filter @lnkpi/server exec vitest run src/auth/captcha.service.test.ts`

- [ ] **Step 3: Implement**

Types:

```ts
export type SliderPuzzleMeta = {
  width: number
  height: number
  pieceSize: number
  y: number
}

export type SliderCaptchaChallengePublic = {
  challengeId: string
  bgImage: string
  pieceImage: string
  puzzle: SliderPuzzleMeta
}
```

Service: canvas ~280×160, pieceSize 44; random `targetX` in `[pieceSize, width - 2*pieceSize]`; SVG data URLs for bg (hole) + piece; internal Map holds `targetX`. Remove block/placement APIs (`createChallenge` old shape, `verifyPlacement`).

- [ ] **Step 4: GREEN** — same vitest PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/captcha.types.ts apps/server/src/auth/captcha.service.ts apps/server/src/auth/captcha.service.test.ts
git commit -m "feat(server): replace block captcha with gap-slider challenges"
```

---

### Task 2: Controller + auth.service tests adapt

**Files:**
- Modify: `apps/server/src/auth/auth.controller.ts`
- Modify: `apps/server/src/auth/auth.service.test.ts`

**Interfaces:**
- `CaptchaVerifyDto`: `{ challengeId: string; offsetX: number }` (`@IsNumber()`)
- `verifyCaptcha` → `captchaService.verifySlide(...)`

- [ ] **Step 1: Update DTO + controller**

```ts
import { IsNumber, IsOptional, IsString, Length, Matches } from 'class-validator'

class CaptchaVerifyDto {
  @IsString()
  challengeId!: string

  @IsNumber()
  offsetX!: number
}
```

- [ ] **Step 2: Fix auth.service.test.ts** — obtain ticket via `verifySlide` scan loop (not placements).

- [ ] **Step 3:** `pnpm --filter @lnkpi/server exec vitest run src/auth/` → PASS

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.service.test.ts
git commit -m "feat(server): captcha verify accepts offsetX for slider"
```

---

### Task 3: Web auth store + types

**Files:**
- Modify: `apps/web/src/components/auth/captcha-types.ts`
- Modify: `apps/web/src/stores/auth.ts`

- [ ] **Step 1: Replace captcha-types.ts** with slider mirror of server public shape (no placements).

- [ ] **Step 2: `verifyCaptcha(challengeId, offsetX)` posts `{ challengeId, offsetX }`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/auth/captcha-types.ts apps/web/src/stores/auth.ts
git commit -m "feat(web): auth store verifies slider offsetX"
```

---

### Task 4: SliderCaptchaOverlay + LoginDialog

**Files:**
- Create: `apps/web/src/components/auth/SliderCaptchaOverlay.vue`
- Modify: `apps/web/src/components/auth/LoginDialog.vue`
- Delete: `apps/web/src/components/auth/BlockCaptchaOverlay.vue`

**Interfaces:** Emits `verified` / `close` (same as block overlay).

- [ ] **Step 1: Implement SliderCaptchaOverlay** — bg + piece follow track; pointerup → `verifyCaptcha`; fail reset +「再试一次」;「换一题」;「拖动滑块完成验证」/「将滑块拖动到正确位置」; desktop cover right panel; mobile `h-[60vh]` drawer.

- [ ] **Step 2: LoginDialog** uses `SliderCaptchaOverlay`.

- [ ] **Step 3: Smoke open login → send-code opens slider.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/auth/SliderCaptchaOverlay.vue apps/web/src/components/auth/LoginDialog.vue
git rm apps/web/src/components/auth/BlockCaptchaOverlay.vue
git commit -m "feat(web): gap-slider captcha overlay replaces blocks"
```

---

### Task 5: Five-theme video carousel

**Files:**
- Modify: `apps/web/src/components/auth/LoginVideoPanel.vue`
- Modify: `apps/web/public/auth/LICENSE.md`
- Add: `login-loop-01.mp4` … `05.mp4`

**Labels:** 运镜 / 科幻 / 电商 / 护肤 / 微观

- [ ] **Step 1:** Download five commercial-ok stock clips (Mixkit/Pixabay etc.), ~720p, document LICENSE.

- [ ] **Step 2:** Crossfade carousel on `ended` / timer; caption `超创 · {{ label }}`; reduced-motion → clip 0 only; onerror skip.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/auth/LoginVideoPanel.vue apps/web/public/auth/
git commit -m "feat(web): five themed login video carousel"
```

---

### Task 6: Verification + spec status

- [ ] **Step 1:** `pnpm --filter @lnkpi/server exec vitest run src/auth/` PASS  
- [ ] **Step 2:** Grep — no runtime `BlockCaptcha` / `verifyPlacement` / `placements`  
- [ ] **Step 3:** Spec status →「已实现」  
- [ ] **Step 4: Commit** docs status  

---

## Plan self-review

| Spec item | Task |
| --- | --- |
| Gap slider + 5px | T1–T4 |
| targetX server-only | T1 |
| Copy strings | T4 |
| Five videos + LICENSE | T5 |
| Modes unchanged | T2 |
| Remove block UI | T4 |
