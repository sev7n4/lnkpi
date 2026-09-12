# Fullscreen Login + Block Captcha Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有小弹窗登录升级为 Seko 风格全屏浮层（左视频 / 右表单），并在「发送验证码」前完成自研积木拼图；后端预留 captcha ticket 与 `AUTH_CAPTCHA_MODE`。

**Architecture:** 保留 `auth.openLogin()` / `showLoginDialog`。`LoginDialog` 改为全屏壳，拆出 `LoginVideoPanel`、`LoginFormPanel`、`BlockCaptchaOverlay`。服务端新增 challenge/verify，扩展 `send-code`；前端始终走积木 UI，严格度由环境开关控制。

**Tech Stack:** Vue 3 + Pinia + Tailwind、NestJS + class-validator、Vitest、现有 Neo tokens

**Spec:** [docs/superpowers/specs/2026-09-13-login-fullscreen-block-captcha-design.md](../specs/2026-09-13-login-fullscreen-block-captcha-design.md)

## Global Constraints

- 不新增 `/login` 路由；不改微信/密码/企业登录。
- 积木验证只挡「发送验证码」，不挡 `login`。
- `AUTH_CAPTCHA_MODE`：`off` | `soft` | `strict`；首发建议默认 `soft`，本地可 `off`。
- 视频须公开可商用且无侵权；放入 `apps/web/public/auth/` 并写许可说明。
- 文案固定：「欢迎回来」「用手机号继续创作」「开始创作」。
- Esc：积木开着先关积木，否则关全屏登录。
- Commit per task；勿混入无关文件。
- 改动后按仓库习惯跑相关测试；涉及 server 时 `pnpm --filter @lnkpi/server test` 相关文件。

## File map

| File | Role |
| --- | --- |
| `apps/server/src/auth/captcha.types.ts` | Challenge / placement / ticket 类型 |
| `apps/server/src/auth/captcha.service.ts` | 出题、校验、签发/核销 ticket |
| `apps/server/src/auth/captcha.service.test.ts` | 单测 |
| `apps/server/src/auth/auth.service.ts` | `sendCode` 接 ticket + mode |
| `apps/server/src/auth/auth.service.test.ts` | sendCode mode 单测 |
| `apps/server/src/auth/auth.controller.ts` | 新路由 + DTO |
| `apps/server/src/auth/auth.module.ts` | 注册 CaptchaService |
| `apps/web/src/stores/auth.ts` | captcha API + sendCode 带 ticket |
| `apps/web/src/components/auth/LoginDialog.vue` | 全屏壳 |
| `apps/web/src/components/auth/LoginVideoPanel.vue` | 左视频 |
| `apps/web/src/components/auth/LoginFormPanel.vue` | 右表单 |
| `apps/web/src/components/auth/BlockCaptchaOverlay.vue` | 积木层 |
| `apps/web/public/auth/login-loop.mp4` | 占位循环视频 |
| `apps/web/public/auth/LICENSE.md` | 素材来源与许可 |

---

### Task 1: CaptchaService + 单测

**Files:**
- Create: `apps/server/src/auth/captcha.types.ts`
- Create: `apps/server/src/auth/captcha.service.ts`
- Create: `apps/server/src/auth/captcha.service.test.ts`

**Interfaces:**
- Produces:
  - `createChallenge(): CaptchaChallenge`
  - `verifyPlacement(challengeId: string, placements: CaptchaPlacement[]): { captchaTicket: string; expiresAt: string }`
  - `consumeTicket(ticket: string | undefined | null): 'ok' | 'missing' | 'invalid'`
  - Types: `CaptchaBlockShape = 'rect' | 'l'`；`CaptchaChallenge` 含 `challengeId`、`blocks[]`（`id`/`shape`/`home`）、`slots[]`（`id`/`x`/`y`/`shape`）、`canvas: { w: number; h: number }`
  - `CaptchaPlacement`: `{ blockId: string; slotId: string }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/auth/captcha.service.test.ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { CaptchaService } from './captcha.service'

describe('CaptchaService', () => {
  let service: CaptchaService
  const prevSecret = process.env.AUTH_CAPTCHA_SECRET

  beforeEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = 'test-secret'
    service = new CaptchaService()
  })

  afterEach(() => {
    process.env.AUTH_CAPTCHA_SECRET = prevSecret
  })

  it('createChallenge returns 3–4 blocks matching slot shapes', () => {
    const c = service.createChallenge()
    expect(c.challengeId).toBeTruthy()
    expect(c.blocks.length).toBeGreaterThanOrEqual(3)
    expect(c.blocks.length).toBeLessThanOrEqual(4)
    expect(c.slots).toHaveLength(c.blocks.length)
    for (const slot of c.slots) {
      expect(c.blocks.some((b) => b.shape === slot.shape)).toBe(true)
    }
  })

  it('verifyPlacement issues ticket only when each block maps to a matching-shape slot once', () => {
    const c = service.createChallenge()
    expect(() => service.verifyPlacement(c.challengeId, [])).toThrow()

    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const out = service.verifyPlacement(c.challengeId, placements)
    expect(out.captchaTicket).toMatch(/^cpt_/)
    expect(Date.parse(out.expiresAt)).toBeGreaterThan(Date.now())
  })

  it('consumeTicket validates once then invalidates', () => {
    const c = service.createChallenge()
    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const { captchaTicket } = service.verifyPlacement(c.challengeId, placements)
    expect(service.consumeTicket(captchaTicket)).toBe('ok')
    expect(service.consumeTicket(captchaTicket)).toBe('invalid')
    expect(service.consumeTicket(null)).toBe('missing')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/captcha.service.test.ts`

Expected: FAIL — module / class not found

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/server/src/auth/captcha.types.ts
export type CaptchaBlockShape = 'rect' | 'l'

export type CaptchaPoint = { x: number; y: number }

export type CaptchaBlock = {
  id: string
  shape: CaptchaBlockShape
  home: CaptchaPoint
}

export type CaptchaSlot = {
  id: string
  shape: CaptchaBlockShape
  x: number
  y: number
}

export type CaptchaChallenge = {
  challengeId: string
  canvas: { w: number; h: number }
  blocks: CaptchaBlock[]
  slots: CaptchaSlot[]
}

export type CaptchaPlacement = {
  blockId: string
  slotId: string
}
```

```ts
// apps/server/src/auth/captcha.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import type {
  CaptchaBlockShape,
  CaptchaChallenge,
  CaptchaPlacement,
} from './captcha.types'

type TicketRecord = { expiresAt: number; consumed: boolean }

@Injectable()
export class CaptchaService {
  private readonly challenges = new Map<string, CaptchaChallenge>()
  private readonly tickets = new Map<string, TicketRecord>()
  private readonly ttlMs = 5 * 60 * 1000

  private get secret(): string {
    return process.env.AUTH_CAPTCHA_SECRET?.trim() || 'dev-captcha-secret'
  }

  createChallenge(): CaptchaChallenge {
    const shapes: CaptchaBlockShape[] = ['rect', 'l', 'rect', 'l']
    const n = 3 + (randomBytes(1)[0]! % 2) // 3 or 4
    const chosen = shapes.slice(0, n)
    const challengeId = `ch_${randomBytes(8).toString('hex')}`
    const canvas = { w: 280, h: 200 }
    const slots = chosen.map((shape, i) => ({
      id: `slot_${i}`,
      shape,
      x: 40 + (i % 2) * 120,
      y: 40 + Math.floor(i / 2) * 80,
    }))
    const blocks = chosen.map((shape, i) => ({
      id: `blk_${i}`,
      shape,
      home: {
        x: 20 + i * 48,
        y: 160,
      },
    }))
    // shuffle block order for home scatter only (ids stay)
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = randomBytes(1)[0]! % (i + 1)
      const tmp = blocks[i]!.home
      blocks[i]!.home = blocks[j]!.home
      blocks[j]!.home = tmp
    }
    const challenge: CaptchaChallenge = { challengeId, canvas, blocks, slots }
    this.challenges.set(challengeId, challenge)
    return challenge
  }

  verifyPlacement(challengeId: string, placements: CaptchaPlacement[]) {
    const challenge = this.challenges.get(challengeId)
    if (!challenge) throw new UnauthorizedException('验证已过期，请重试')
    if (placements.length !== challenge.slots.length) {
      throw new UnauthorizedException('拼图不正确')
    }
    const usedBlocks = new Set<string>()
    const usedSlots = new Set<string>()
    for (const p of placements) {
      const block = challenge.blocks.find((b) => b.id === p.blockId)
      const slot = challenge.slots.find((s) => s.id === p.slotId)
      if (!block || !slot || block.shape !== slot.shape) {
        throw new UnauthorizedException('拼图不正确')
      }
      if (usedBlocks.has(p.blockId) || usedSlots.has(p.slotId)) {
        throw new UnauthorizedException('拼图不正确')
      }
      usedBlocks.add(p.blockId)
      usedSlots.add(p.slotId)
    }
    this.challenges.delete(challengeId)
    const expiresAt = Date.now() + this.ttlMs
    const captchaTicket = this.signTicket(challengeId, expiresAt)
    this.tickets.set(captchaTicket, { expiresAt, consumed: false })
    return { captchaTicket, expiresAt: new Date(expiresAt).toISOString() }
  }

  consumeTicket(ticket: string | undefined | null): 'ok' | 'missing' | 'invalid' {
    if (!ticket) return 'missing'
    if (!this.verifySignature(ticket)) return 'invalid'
    const rec = this.tickets.get(ticket)
    if (!rec || rec.consumed || rec.expiresAt < Date.now()) return 'invalid'
    rec.consumed = true
    return 'ok'
  }

  private signTicket(challengeId: string, expiresAt: number): string {
    const payload = `${challengeId}.${expiresAt}.${randomBytes(4).toString('hex')}`
    const sig = createHmac('sha256', this.secret).update(payload).digest('hex').slice(0, 24)
    return `cpt_${Buffer.from(`${payload}.${sig}`).toString('base64url')}`
  }

  private verifySignature(ticket: string): boolean {
    if (!ticket.startsWith('cpt_')) return false
    try {
      const raw = Buffer.from(ticket.slice(4), 'base64url').toString('utf8')
      const parts = raw.split('.')
      if (parts.length !== 4) return false
      const [challengeId, exp, nonce, sig] = parts as [string, string, string, string]
      const payload = `${challengeId}.${exp}.${nonce}`
      const expect = createHmac('sha256', this.secret).update(payload).digest('hex').slice(0, 24)
      const a = Buffer.from(sig)
      const b = Buffer.from(expect)
      return a.length === b.length && timingSafeEqual(a, b)
    } catch {
      return false
    }
  }
}
```

精简测试里无用的 `good`/`bad` 死变量，保持上面三个 `it` 可跑通即可。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/captcha.service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/captcha.types.ts apps/server/src/auth/captcha.service.ts apps/server/src/auth/captcha.service.test.ts
git commit -m "feat(server): add captcha challenge and ticket service"
```

---

### Task 2: Auth send-code 接 ticket + HTTP 路由

**Files:**
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Modify: `apps/server/src/auth/auth.module.ts`
- Create: `apps/server/src/auth/auth.service.test.ts`

**Interfaces:**
- Consumes: `CaptchaService.consumeTicket`
- Produces:
  - `AuthService.sendCode(phone: string, captchaTicket?: string)`
  - `GET` unchanged; `POST /auth/captcha/challenge`; `POST /auth/captcha/verify`; `POST /auth/send-code` body `{ phone, captchaTicket? }`
  - `getPublicConfig()` 可附带 `captchaMode`（可选，便于前端调试）

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/src/auth/auth.service.test.ts
import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnauthorizedException } from '@nestjs/common'
import { AuthService } from './auth.service'
import { CaptchaService } from './captcha.service'
import { PrismaService } from '../prisma/prisma.service'
import { JwtService } from '@nestjs/jwt'

describe('AuthService.sendCode captcha modes', () => {
  let auth: AuthService
  let captcha: CaptchaService
  const create = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AUTH_SMS_MODE = 'fixed'
    captcha = new CaptchaService()
    auth = new AuthService(
      { verificationCode: { create } } as unknown as PrismaService,
      {} as JwtService,
      captcha,
    )
  })

  it('strict mode rejects missing ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'strict'
    await expect(auth.sendCode('13800138000')).rejects.toBeInstanceOf(UnauthorizedException)
    expect(create).not.toHaveBeenCalled()
  })

  it('soft mode allows missing ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'soft'
    await auth.sendCode('13800138000')
    expect(create).toHaveBeenCalled()
  })

  it('strict mode accepts valid ticket', async () => {
    process.env.AUTH_CAPTCHA_MODE = 'strict'
    const c = captcha.createChallenge()
    const used = new Set<string>()
    const placements = c.slots.map((slot) => {
      const block = c.blocks.find((b) => b.shape === slot.shape && !used.has(b.id))!
      used.add(block.id)
      return { blockId: block.id, slotId: slot.id }
    })
    const { captchaTicket } = captcha.verifyPlacement(c.challengeId, placements)
    await auth.sendCode('13800138000', captchaTicket)
    expect(create).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/auth.service.test.ts`

Expected: FAIL — `AuthService` constructor arity / `sendCode` 签名不匹配

- [ ] **Step 3: Implement service + controller wiring**

在 `AuthService` 构造注入 `CaptchaService`：

```ts
constructor(
  @Inject(PrismaService) private readonly prisma: PrismaService,
  @Inject(JwtService) private readonly jwt: JwtService,
  @Inject(CaptchaService) private readonly captcha: CaptchaService,
) {}

private get captchaMode(): 'off' | 'soft' | 'strict' {
  const m = process.env.AUTH_CAPTCHA_MODE
  return m === 'strict' || m === 'off' ? m : 'soft'
}

async sendCode(phone: string, captchaTicket?: string) {
  const mode = this.captchaMode
  if (mode !== 'off') {
    const result = this.captcha.consumeTicket(captchaTicket)
    if (mode === 'strict' && result !== 'ok') {
      throw new UnauthorizedException('请先完成安全验证')
    }
    if (mode === 'soft' && result !== 'ok') {
      console.warn(`[AUTH:captcha:soft] send-code without valid ticket phone=${phone} result=${result}`)
    }
  }
  // ... existing fixed/real SMS body unchanged
}
```

Controller DTO / routes：

```ts
class SendCodeDto {
  @IsString()
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone!: string

  @IsOptional()
  @IsString()
  captchaTicket?: string
}

class CaptchaVerifyDto {
  @IsString()
  challengeId!: string

  @IsArray()
  placements!: { blockId: string; slotId: string }[]
}

@Post('captcha/challenge')
@HttpCode(200)
createCaptcha() {
  return { code: 0, message: 'ok', data: this.captchaService.createChallenge() }
}

@Post('captcha/verify')
@HttpCode(200)
verifyCaptcha(@Body() dto: CaptchaVerifyDto) {
  const data = this.captchaService.verifyPlacement(dto.challengeId, dto.placements)
  return { code: 0, message: 'ok', data }
}

@Post('send-code')
@HttpCode(200)
async sendCode(@Body() dto: SendCodeDto) {
  const data = await this.authService.sendCode(dto.phone, dto.captchaTicket)
  return { code: 0, message: 'ok', data }
}
```

`auth.module.ts` providers 增加 `CaptchaService`；controller 注入 `CaptchaService`。

需要 `IsOptional` / `IsArray` from `class-validator`。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/auth.service.test.ts src/auth/captcha.service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/auth.service.ts apps/server/src/auth/auth.controller.ts apps/server/src/auth/auth.module.ts apps/server/src/auth/auth.service.test.ts
git commit -m "feat(server): gate send-code with captcha ticket modes"
```

---

### Task 3: Auth store + API 客户端

**Files:**
- Modify: `apps/web/src/stores/auth.ts`

**Interfaces:**
- Consumes: `/auth/captcha/challenge`, `/auth/captcha/verify`, `/auth/send-code`
- Produces:
  - `fetchCaptchaChallenge(): Promise<CaptchaChallenge>`
  - `verifyCaptcha(challengeId: string, placements: CaptchaPlacement[]): Promise<{ captchaTicket: string; expiresAt: string }>`
  - `sendCode(phone: string, captchaTicket?: string)`
  - `captchaTicket` ref（发码成功后清空）

- [ ] **Step 1: Extend store methods**

将 shared 类型可放在 `apps/web/src/components/auth/captcha-types.ts`（前端镜像，不必进 shared 包）：

```ts
export type CaptchaBlockShape = 'rect' | 'l'
export type CaptchaChallenge = {
  challengeId: string
  canvas: { w: number; h: number }
  blocks: { id: string; shape: CaptchaBlockShape; home: { x: number; y: number } }[]
  slots: { id: string; shape: CaptchaBlockShape; x: number; y: number }[]
}
export type CaptchaPlacement = { blockId: string; slotId: string }
```

`auth.ts`：

```ts
const captchaTicket = ref<string | null>(null)

async function fetchCaptchaChallenge() {
  const { data } = await withAuthRetry(() =>
    api.post<{ data: CaptchaChallenge }>('/auth/captcha/challenge', {}, { timeout: AUTH_TIMEOUT_MS }),
  )
  return data.data
}

async function verifyCaptcha(challengeId: string, placements: CaptchaPlacement[]) {
  const { data } = await withAuthRetry(() =>
    api.post<{ data: { captchaTicket: string; expiresAt: string } }>(
      '/auth/captcha/verify',
      { challengeId, placements },
      { timeout: AUTH_TIMEOUT_MS },
    ),
  )
  captchaTicket.value = data.data.captchaTicket
  return data.data
}

async function sendCode(phone: string, ticket?: string) {
  const captchaTicketToSend = ticket ?? captchaTicket.value ?? undefined
  await withAuthRetry(() =>
    api.post('/auth/send-code', { phone, captchaTicket: captchaTicketToSend }, { timeout: AUTH_TIMEOUT_MS }),
  )
  captchaTicket.value = null
}
```

导出新方法。

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lnkpi/web exec vue-tsc --noEmit`  
（若仓库惯用其他命令，用 `pnpm --filter @lnkpi/web build` 的类型阶段亦可）

Expected: 无新增类型错误（或仅与本改动无关的既有问题）

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/stores/auth.ts apps/web/src/components/auth/captcha-types.ts
git commit -m "feat(web): wire auth store to captcha APIs"
```

---

### Task 4: 全屏登录壳 + 视频 + 表单

**Files:**
- Modify: `apps/web/src/components/auth/LoginDialog.vue`
- Create: `apps/web/src/components/auth/LoginVideoPanel.vue`
- Create: `apps/web/src/components/auth/LoginFormPanel.vue`
- Create: `apps/web/public/auth/LICENSE.md`
- Create: `apps/web/public/auth/login-loop.mp4`（下载 Pixabay Content License 循环片，或临时用短静帧 + 文档注明待替换；**禁止**热链外站不稳定 URL 作为唯一源）

**Interfaces:**
- Consumes: `auth.showLoginDialog`、`sendCode`/`login`/`fetchAuthConfig`（表单侧）；积木事件留给 Task 5
- Produces: `LoginFormPanel` emits `request-send-code`（父级决定是否先开积木）；本 Task 可先在 Form 内用占位：`emit('request-send-code')`，父级暂时直接调积木开关 ref（Task 5 接好）

- [ ] **Step 1: Add LICENSE + video asset**

`apps/web/public/auth/LICENSE.md` 写明：来源站点、作品 ID/链接、Pixabay Content License、下载日期。将 mp4 存为 `login-loop.mp4`（体积尽量 < 8MB；可压制成 720p）。

- [ ] **Step 2: Implement LoginVideoPanel**

```vue
<!-- LoginVideoPanel.vue -->
<script setup lang="ts">
const src = '/auth/login-loop.mp4'
</script>
<template>
  <div class="relative h-full w-full overflow-hidden bg-[var(--neo-bg)]">
    <video
      class="absolute inset-0 h-full w-full object-cover"
      :src="src"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
    />
    <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-[var(--neo-bg)]/40" />
    <p class="absolute bottom-6 left-1/2 -translate-x-1/2 text-xs text-white/50">超创 · 创作瞬间</p>
  </div>
</template>
```

- [ ] **Step 3: Implement LoginFormPanel（无积木 UI，发码经 emit）**

表单字段与现网一致；文案按 spec。`handleSendCode`：`emit('request-send-code', phone)`。`handleLogin` 仍调 `auth.login`。

- [ ] **Step 4: Rewrite LoginDialog 为全屏壳**

去掉 `el-dialog` 标题条；用 `Teleport` + fixed inset-0：

```vue
<Teleport to="body">
  <div
    v-if="visible"
    class="fixed inset-0 z-[100] flex flex-col bg-black md:flex-row"
    role="dialog"
    aria-modal="true"
    @keydown.esc.prevent="onEsc"
  >
    <div class="h-[28vh] w-full shrink-0 md:h-auto md:w-[55vw]">
      <LoginVideoPanel />
    </div>
    <div class="relative flex flex-1 items-start justify-center overflow-y-auto px-6 py-10 md:items-center">
      <button type="button" class="absolute right-5 top-5 ..." aria-label="关闭" @click="visible = false">×</button>
      <LoginFormPanel
        class="w-full max-w-[360px]"
        @request-send-code="onRequestSendCode"
      />
    </div>
  </div>
</Teleport>
```

本 Task 的 `onRequestSendCode` 可暂时：`await auth.sendCode(phone)`（无 ticket），Task 5 改为先开积木。

`onEsc`：先关积木（Task 5），否则 `visible = false`。

- [ ] **Step 5: Manual smoke**

Run web dev server，点顶栏登录：应全屏左右分栏；能发码（soft/off）并登录。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/auth/LoginDialog.vue \
  apps/web/src/components/auth/LoginVideoPanel.vue \
  apps/web/src/components/auth/LoginFormPanel.vue \
  apps/web/public/auth/
git commit -m "feat(web): fullscreen login shell with video panel"
```

---

### Task 5: BlockCaptchaOverlay 接入发送前流程

**Files:**
- Create: `apps/web/src/components/auth/BlockCaptchaOverlay.vue`
- Modify: `apps/web/src/components/auth/LoginDialog.vue`
- Modify: `apps/web/src/components/auth/LoginFormPanel.vue`（若需禁用态）

**Interfaces:**
- Consumes: `auth.fetchCaptchaChallenge`、`auth.verifyCaptcha`、`auth.sendCode`
- Produces: 拼图成功后父级持有 ticket 并 `sendCode(phone, ticket)`

- [ ] **Step 1: Implement overlay**

行为：
1. `open` 时 `fetchCaptchaChallenge`
2. 渲染 slots 剪影 + absolute 可拖 blocks（pointer events）
3. 松手时若中心距 slot 中心 ≤ 12px 且 shape 匹配且 slot 空闲 → 吸附
4. 全部吸附后调 `verifyCaptcha`，`emit('verified', ticket)`
5. 「换一题」重新 challenge；关闭 `emit('close')`
6. 桌面：覆盖右栏；`md` 以下：`fixed bottom` 抽屉高度约 60vh
7. `prefers-reduced-motion: reduce` 时去掉落下动画

拖拽可用简单实现（无需第三方库）：

```ts
type DragState = { blockId: string; ox: number; oy: number; x: number; y: number }
const positions = ref<Record<string, { x: number; y: number }>>({})
const snapped = ref<Record<string, string>>({}) // blockId -> slotId
```

- [ ] **Step 2: Wire LoginDialog**

```ts
const showCaptcha = ref(false)
const pendingPhone = ref('')

async function onRequestSendCode(phone: string) {
  pendingPhone.value = phone
  showCaptcha.value = true
}

async function onCaptchaVerified(ticket: string) {
  showCaptcha.value = false
  try {
    await auth.sendCode(pendingPhone.value, ticket)
    // 通知 FormPanel 启动倒计时：可用 provide/inject 或 emit 回 Form
  } catch {
    // 错误展示在 Form
  }
}

function onEsc() {
  if (showCaptcha.value) {
    showCaptcha.value = false
    return
  }
  visible.value = false
}
```

Form 倒计时：成功发码后由 Dialog `emit`/`ref` 调 `formRef.startCountdown()`，或把 countdown 状态提到 Dialog。选一种写清，避免双计时。

- [ ] **Step 3: Manual QA checklist**

- 非法手机号无法打开积木  
- 未拼完关层不发短信  
- 拼完发短信；strict 下无 ticket 失败  
- Esc 分层关闭  
- 窄屏抽屉可用  

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/auth/BlockCaptchaOverlay.vue \
  apps/web/src/components/auth/LoginDialog.vue \
  apps/web/src/components/auth/LoginFormPanel.vue
git commit -m "feat(web): block captcha before send-code"
```

---

### Task 6: 收尾验证

**Files:** none required beyond fixes

- [ ] **Step 1: Server tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/`

Expected: PASS

- [ ] **Step 2: Build**

Run: `pnpm --filter @lnkpi/server build && pnpm --filter @lnkpi/web build`

Expected: SUCCESS（或仅记录与本改动无关的既有失败）

- [ ] **Step 3: Update spec status**

将 design spec 顶部状态改为「实现中 / 已实现」与实际一致。

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-13-login-fullscreen-block-captcha-design.md
git commit -m "docs: mark login captcha design implemented"
```

（若尚未全部完成，可跳过本 step 或改文案为「实现中」。）

---

## Plan self-review

| Spec 要求 | Task |
| --- | --- |
| 全屏浮层左视频右表单 | Task 4 |
| 移动上视频下表单 | Task 4 |
| 发送前积木 | Task 5 |
| challenge/verify/ticket | Task 1–2 |
| AUTH_CAPTCHA_MODE | Task 2 |
| 公开视频 + LICENSE | Task 4 |
| Esc 分层 | Task 5 |
| 不新增 /login、不接商业验证码 | Global Constraints |
| openLogin 语义保留 | Task 4（仍绑 showLoginDialog） |

无 TBD 占位；类型名跨 Task 一致（`CaptchaChallenge` / `CaptchaPlacement` / `cpt_` ticket）。
