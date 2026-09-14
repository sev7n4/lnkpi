# Login / Register / Invite / Legal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align fullscreen auth with neo-tv (full-bleed video, login/register tabs, optional invite on register), ship personal invite codes with bilateral +200 points, and publish `/terms` + `/privacy` for lnk π超创平台.

**Architecture:** Split `POST /auth/login` (existing users only) and `POST /auth/register` (new users + optional invite). `InviteService` owns code generation, validation, redemption, daily inviter cap, and points via `PointsService.refund` with `kind: 'grant'`. Frontend tabs call the matching endpoint; Profile shows invite code + invitee count; legal routes are public Vue pages.

**Tech Stack:** NestJS + Prisma (SQLite) + Vitest; Vue 3 + Pinia + Vue Router; existing neo tokens / Tailwind.

**Spec:** [docs/superpowers/specs/2026-09-14-login-register-invite-legal-design.md](../specs/2026-09-14-login-register-invite-legal-design.md)

## Global Constraints

- Platform name: **lnk π超创平台** (`BRAND_NAME`)
- Legal entity: **墨鱼π科技技术有限公司**; email: **sev7nseason@outlook.com**; ICP: **ICP备案号申请中**
- Invite reward: invitee **+200**, inviter **+200**; inviter Shanghai-day cap **20** (bind still, skip inviter points)
- Invite code: `XC` + 8 chars from alphabet excluding `0OIL1`; unique; lazy backfill for legacy users
- Login ignores invite; register empty invite OK; invalid invite → 400
- Existing phone on register → 409; missing user on login → 400「账号不存在，请先注册」
- Captcha → send-code path unchanged
- Legal links open in **new tab**
- Commit per task; do not stage `deploy/prod-workflow-exchange-verify.py` or unrelated dirty files
- Branch: `feature/login-register-invite-legal`

## File map

| File | Role |
| --- | --- |
| `apps/web/src/constants/brand.ts` | Brand + legal constants |
| `apps/web/src/pages/TermsPage.vue` | User agreement |
| `apps/web/src/pages/PrivacyPage.vue` | Privacy policy |
| `apps/web/src/router/index.ts` | `/terms`, `/privacy` |
| `apps/server/prisma/schema.prisma` | User invite fields + `InviteRedemption` |
| `apps/server/prisma/migrations/20260914120000_user_invite/` | SQL migration |
| `apps/server/src/auth/invite-code.ts` | Generate / alphabet helpers |
| `apps/server/src/auth/invite.service.ts` | Ensure code, redeem, daily cap |
| `apps/server/src/auth/invite.service.test.ts` | Invite unit tests |
| `apps/server/src/auth/auth.service.ts` | login / register / profile |
| `apps/server/src/auth/auth.controller.ts` | Register DTO + route |
| `apps/server/src/auth/auth.module.ts` | Import PointsModule; provide InviteService |
| `apps/server/src/auth/auth.service.test.ts` | Auth mode + register/login cases |
| `apps/server/src/points/reason-map.ts` | Map invite reasons → grant |
| `packages/shared/src/index.ts` | Extend `User` |
| `apps/web/src/stores/auth.ts` | `register()` |
| `apps/web/src/components/auth/LoginVideoPanel.vue` | Full-bleed |
| `apps/web/src/components/auth/LoginFormPanel.vue` | Tabs + invite + legal |
| `apps/web/src/pages/ProfilePage.vue` | Invite card |

---

### Task 1: Brand constants + legal pages + routes

**Files:**
- Modify: `apps/web/src/constants/brand.ts`
- Create: `apps/web/src/pages/TermsPage.vue`
- Create: `apps/web/src/pages/PrivacyPage.vue`
- Modify: `apps/web/src/router/index.ts`

**Interfaces:**
- Produces: `BRAND_NAME`, `LEGAL_ENTITY`, `SUPPORT_EMAIL`, `ICP_TEXT`, `TERMS_TITLE`, `PRIVACY_TITLE`, `TERMS_PATH` (`/terms`), `PRIVACY_PATH` (`/privacy`)

- [ ] **Step 1: Update brand constants**

```ts
export const BRAND_NAME = 'lnk π超创平台'
export const BRAND_LOGO_URL = '/brand/mascot-logo.png'
export const LEGAL_ENTITY = '墨鱼π科技技术有限公司'
export const SUPPORT_EMAIL = 'sev7nseason@outlook.com'
export const ICP_TEXT = 'ICP备案号申请中'
export const TERMS_TITLE = 'lnk π超创平台用户协议'
export const PRIVACY_TITLE = 'lnk π超创平台隐私政策'
export const TERMS_PATH = '/terms'
export const PRIVACY_PATH = '/privacy'
```

- [ ] **Step 2: Add TermsPage and PrivacyPage**

Deep-theme document layout: top brand link home, `h1` title, 更新日期/生效日期 `2026-09-14`, numbered sections adapted from neo-tv skeleton with platform/entity/email substitutions (minors: 不面向 18 岁以下). Footer: entity, mailto support, `ICP_TEXT`. Keep copy concise structured Chinese — not a verbatim NeoWOW dump.

- [ ] **Step 3: Register routes**

```ts
{ path: '/terms', name: 'terms', component: () => import('../pages/TermsPage.vue') },
{ path: '/privacy', name: 'privacy', component: () => import('../pages/PrivacyPage.vue') },
```

- [ ] **Step 4: Smoke build web types**

Run: `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false`
Expected: PASS (or only pre-existing unrelated errors — fix any from these files)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/constants/brand.ts apps/web/src/pages/TermsPage.vue apps/web/src/pages/PrivacyPage.vue apps/web/src/router/index.ts
git commit -m "feat(web): add lnk π legal pages and brand constants"
```

---

### Task 2: Prisma invite schema + migration

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260914120000_user_invite/migration.sql`

**Interfaces:**
- Produces: `User.inviteCode`, `User.invitedByUserId`, `InviteRedemption` model

- [ ] **Step 1: Extend User and add InviteRedemption**

```prisma
model User {
  // ...existing fields...
  inviteCode       String?  @unique
  invitedByUserId  String?
  invitedBy        User?    @relation("UserInvites", fields: [invitedByUserId], references: [id])
  invitees         User[]   @relation("UserInvites")
  inviteRedemptionsAsInvitee InviteRedemption? @relation("RedemptionInvitee")
  inviteRedemptionsAsInviter InviteRedemption[] @relation("RedemptionInviter")
}

model InviteRedemption {
  id                         String   @id @default(cuid())
  inviteeId                  String   @unique
  invitee                    User     @relation("RedemptionInvitee", fields: [inviteeId], references: [id], onDelete: Cascade)
  inviterId                  String
  inviter                    User     @relation("RedemptionInviter", fields: [inviterId], references: [id], onDelete: Cascade)
  inviteCode                 String
  inviteePoints              Int
  inviterPoints              Int
  inviterRewardSkippedReason String?
  createdAt                  DateTime @default(now())

  @@index([inviterId, createdAt])
}
```

Note: `inviteCode` nullable initially so migration can add column without backfilling all rows in SQL; app lazy-fills. After backfill in app, treat as required in logic.

- [ ] **Step 2: Write migration SQL**

```sql
-- AlterTable
ALTER TABLE "User" ADD COLUMN "inviteCode" TEXT;
ALTER TABLE "User" ADD COLUMN "invitedByUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_inviteCode_key" ON "User"("inviteCode");

-- CreateTable
CREATE TABLE "InviteRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inviteeId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "inviteePoints" INTEGER NOT NULL,
    "inviterPoints" INTEGER NOT NULL,
    "inviterRewardSkippedReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InviteRedemption_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InviteRedemption_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InviteRedemption_inviteeId_key" ON "InviteRedemption"("inviteeId");
CREATE INDEX "InviteRedemption_inviterId_createdAt_idx" ON "InviteRedemption"("inviterId", "createdAt");
```

- [ ] **Step 3: Generate client**

Run: `pnpm --filter @lnkpi/server exec prisma generate`
Expected: success

- [ ] **Step 4: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations/20260914120000_user_invite
git commit -m "feat(server): add user inviteCode and InviteRedemption"
```

---

### Task 3: Invite code helper + InviteService (TDD)

**Files:**
- Create: `apps/server/src/auth/invite-code.ts`
- Create: `apps/server/src/auth/invite.service.ts`
- Create: `apps/server/src/auth/invite.service.test.ts`
- Modify: `apps/server/src/auth/auth.module.ts` (wire later in Task 4 if preferred — wire here with PointsModule)
- Modify: `apps/server/src/points/reason-map.ts` — map `邀请奖励` → grant

**Interfaces:**
- Produces:
  - `generateInviteCode(): string` → `XC` + 8 chars
  - `InviteService.ensureInviteCode(userId: string): Promise<string>`
  - `InviteService.findInviterByCode(code: string): Promise<{ id: string; inviteCode: string } | null>`
  - `InviteService.countInviterRedemptionsToday(inviterId: string, now?: Date): Promise<number>`
  - `InviteService.redeemOnRegister(params: { inviteeId: string; inviteCode: string | null | undefined }): Promise<{ bound: boolean; inviteePoints: number; inviterPoints: number }>`
- Constants: `INVITE_REWARD_POINTS = 200`, `INVITER_DAILY_CAP = 20`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { InviteService } from './invite.service'
import { generateInviteCode } from './invite-code'

describe('generateInviteCode', () => {
  it('starts with XC and has length 10', () => {
    const c = generateInviteCode()
    expect(c).toMatch(/^XC[A-HJ-NP-Z2-9]{8}$/)
  })
})

describe('InviteService', () => {
  const prisma = {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    inviteRedemption: { count: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  }
  const points = { refund: vi.fn(async () => undefined) }
  let svc: InviteService

  beforeEach(() => {
    vi.clearAllMocks()
    svc = new InviteService(prisma as any, points as any)
  })

  it('rejects unknown invite code', async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null) // by code
    await expect(svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCBADCODE' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('no-ops when invite code empty', async () => {
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: '  ' })
    expect(r).toEqual({ bound: false, inviteePoints: 0, inviterPoints: 0 })
    expect(points.refund).not.toHaveBeenCalled()
  })

  it('credits both when under daily cap', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', inviteCode: 'XCABCDEFGH' })
    prisma.inviteRedemption.count.mockResolvedValueOnce(0)
    prisma.user.update.mockResolvedValueOnce({})
    prisma.inviteRedemption.create.mockResolvedValueOnce({})
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCABCDEFGH' })
    expect(r.bound).toBe(true)
    expect(r.inviteePoints).toBe(200)
    expect(r.inviterPoints).toBe(200)
    expect(points.refund).toHaveBeenCalledTimes(2)
  })

  it('binds but skips inviter points at daily cap', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', inviteCode: 'XCABCDEFGH' })
    prisma.inviteRedemption.count.mockResolvedValueOnce(20)
    prisma.user.update.mockResolvedValueOnce({})
    prisma.inviteRedemption.create.mockResolvedValueOnce({})
    const r = await svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCABCDEFGH' })
    expect(r.inviterPoints).toBe(0)
    expect(points.refund).toHaveBeenCalledTimes(1) // invitee only
  })

  it('rejects self-invite', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({ id: 'u2', inviteCode: 'XCSELFCODE' })
    await expect(svc.redeemOnRegister({ inviteeId: 'u2', inviteCode: 'XCSELFCODE' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/invite.service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `invite-code.ts` and `invite.service.ts`**

```ts
// invite-code.ts
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0 O I L 1
export function generateInviteCode(): string {
  let body = ''
  for (let i = 0; i < 8; i++) body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]!
  return `XC${body}`
}
```

`InviteService`:
- `ensureInviteCode`: if user has code return it; else generate with collision retry (≤8), `update` where `inviteCode: null`
- `redeemOnRegister`: trim code; empty → no-op; find inviter by `inviteCode`; missing → `BadRequestException('邀请码无效')`; `inviter.id === inviteeId` → same; count today's redemptions for inviter (Shanghai day bounds: UTC+8); set `invitedByUserId`; create redemption; `points.refund(invitee, 200, '邀请奖励-新用户', { kind:'grant', category:'other', status:null })`; if under cap same for inviter with `'邀请奖励-邀请人'`
- Prefer single `$transaction` for user update + redemption create; points refund can run after commit (acceptable) **or** inline prisma increments inside the same transaction if `PointsService` cannot share tx — document choice: call `points.refund` after successful tx for simplicity, and if refund fails log + do not leave unbound (order: create user in auth first, then redeem; if redeem fails after user create, auth should roll back user create in same outer transaction — see Task 4)

- [ ] **Step 4: Extend reason-map for invite grants**

```ts
if (reason.startsWith('邀请奖励')) {
  return { kind: 'grant', category: 'other', status: null }
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/invite.service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/invite-code.ts apps/server/src/auth/invite.service.ts apps/server/src/auth/invite.service.test.ts apps/server/src/points/reason-map.ts
git commit -m "feat(server): invite code generation and redemption service"
```

---

### Task 4: Auth login/register split + profile fields

**Files:**
- Modify: `apps/server/src/auth/auth.service.ts`
- Modify: `apps/server/src/auth/auth.controller.ts`
- Modify: `apps/server/src/auth/auth.module.ts`
- Modify: `apps/server/src/auth/auth.service.test.ts`
- Modify: `packages/shared/src/index.ts` (`User` type)

**Interfaces:**
- Consumes: `InviteService`
- Produces:
  - `login(phone, code)` — existing user only
  - `register(phone, code, inviteCode?)` — new user + optional redeem
  - `getProfile` → includes `inviteCode`, `invitedByUserId?`, `inviteeCount`

- [ ] **Step 1: Extend failing auth tests**

Add cases (mock prisma + invite + jwt as needed):

1. `login` when user missing → Unauthorized/BadRequest with message containing `请先注册`
2. `register` when user exists → ConflictException / message `请直接登录`
3. `register` new user without invite → creates user, ensures invite code, no redeem bound
4. `register` with invite → calls `invite.redeemOnRegister`

Keep existing captcha mode tests green.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/auth.service.test.ts`
Expected: FAIL on new cases

- [ ] **Step 3: Implement AuthService changes**

```ts
async login(phone: string, code: string) {
  await this.assertValidCode(phone, code)
  let user = await this.prisma.user.findUnique({ where: { phone } })
  if (!user) throw new BadRequestException('账号不存在，请先注册')
  await this.invite.ensureInviteCode(user.id)
  user = (await this.prisma.user.findUnique({ where: { id: user.id } }))!
  return this.issueSession(user)
}

async register(phone: string, code: string, inviteCode?: string) {
  await this.assertValidCode(phone, code)
  const existing = await this.prisma.user.findUnique({ where: { phone } })
  if (existing) throw new ConflictException('账号已存在，请直接登录')

  // Optional: pre-validate invite before create to avoid orphan users
  const trimmed = inviteCode?.trim()
  if (trimmed) {
    const inviter = await this.invite.findInviterByCode(trimmed)
    if (!inviter) throw new BadRequestException('邀请码无效')
  }

  let user = await this.prisma.user.create({
    data: { phone, nickname: `用户${phone.slice(-4)}`, inviteCode: generateInviteCode() /* retry on unique fail */ },
  })
  // On unique collision for inviteCode, regenerate via ensureInviteCode pattern

  if (trimmed) {
    await this.invite.redeemOnRegister({ inviteeId: user.id, inviteCode: trimmed })
    user = (await this.prisma.user.findUnique({ where: { id: user.id } }))!
  } else {
    await this.invite.ensureInviteCode(user.id)
  }
  return this.issueSession(user)
}

async getProfile(userId: string) {
  await this.invite.ensureInviteCode(userId)
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: { _count: { select: { invitees: true } } },
  })
  if (!user) throw new UnauthorizedException()
  return {
    id: user.id,
    phone: user.phone,
    nickname: user.nickname,
    avatar: user.avatar ?? undefined,
    points: user.points,
    membership: user.membership,
    createdAt: user.createdAt.toISOString(),
    inviteCode: user.inviteCode!,
    invitedByUserId: user.invitedByUserId ?? undefined,
    inviteeCount: user._count.invitees,
  }
}
```

Extract shared `assertValidCode` from current login verify logic. `issueSession` returns `{ token, user }` with profile-shaped user (include invite fields on register/login response).

- [ ] **Step 4: Controller**

```ts
class RegisterDto {
  @IsString() @Matches(/^1\d{10}$/) phone!: string
  @IsString() @Length(4, 6) code!: string
  @IsOptional() @IsString() @MaxLength(32) inviteCode?: string
}

@Post('register')
@HttpCode(200)
async register(@Body() dto: RegisterDto) {
  const data = await this.authService.register(dto.phone, dto.code, dto.inviteCode)
  return { code: 0, message: 'ok', data }
}
```

Import `PointsModule` + provide `InviteService` in `AuthModule`.

- [ ] **Step 5: Extend shared User**

```ts
export interface User {
  // existing...
  inviteCode?: string
  invitedByUserId?: string
  inviteeCount?: number
}
```

- [ ] **Step 6: Run auth + invite tests**

Run: `pnpm --filter @lnkpi/server exec vitest run src/auth/`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/auth packages/shared/src/index.ts
git commit -m "feat(auth): split login/register and return invite profile fields"
```

---

### Task 5: Web auth store `register` + form tabs + legal line + video bleed

**Files:**
- Modify: `apps/web/src/stores/auth.ts`
- Modify: `apps/web/src/components/auth/LoginFormPanel.vue`
- Modify: `apps/web/src/components/auth/LoginVideoPanel.vue`
- Modify: `apps/web/src/components/auth/LoginDialog.vue` (aria-label if needed)

**Interfaces:**
- Consumes: `/auth/register`, brand legal paths
- Produces: `auth.register(phone, code, inviteCode?)`

- [ ] **Step 1: Add `register` to auth store** (mirror `login`, POST `/auth/register` with optional `inviteCode`)

- [ ] **Step 2: LoginFormPanel UI**

- `mode = ref<'login' | 'register'>('login')`
- Capsule tab buttons
- Titles/subcopy/button labels per spec
- Invite field only when `mode === 'register'`
- Submit calls `auth.login` or `auth.register`
- Map API errors to Chinese short messages (409 / 邀请码无效 / 请先注册)
- Agreement row with `target="_blank"` links to `TERMS_PATH` / `PRIVACY_PATH`
- Footer `ICP_TEXT`
- Caption brand: optional `lnk π · ${label}`

- [ ] **Step 3: LoginVideoPanel full-bleed**

Replace root classes:

```html
<div class="relative h-full w-full overflow-hidden bg-black">
  <div class="video-stage relative h-full w-full overflow-hidden">
```

Remove padding, rounded corners, border, shadow.

- [ ] **Step 4: Manual checklist** (local server if available) or `vue-tsc`

Run: `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/stores/auth.ts apps/web/src/components/auth/LoginFormPanel.vue apps/web/src/components/auth/LoginVideoPanel.vue apps/web/src/components/auth/LoginDialog.vue
git commit -m "feat(web): login/register tabs, invite field, full-bleed video"
```

---

### Task 6: Profile invite card

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`

**Interfaces:**
- Consumes: `profile.inviteCode`, `profile.inviteeCount` from `/auth/profile`

- [ ] **Step 1: After points card, add invite section**

```html
<div class="mt-4 rounded-xl border border-white/8 bg-[#242424] p-5">
  <p class="text-xs text-white/40">我的邀请码</p>
  <div class="mt-2 flex items-center gap-3">
    <code class="text-lg tracking-widest text-white">{{ profile.inviteCode ?? '—' }}</code>
    <button type="button" class="..." @click="copyInvite">复制</button>
  </div>
  <p class="mt-3 text-sm text-white/50">已邀请 {{ profile.inviteeCount ?? 0 }} 人</p>
</div>
```

`copyInvite`: `navigator.clipboard.writeText(profile.inviteCode)`; brief「已复制」state.

Ensure profile load uses `/auth/profile` (already) so new fields arrive; update local `profile` typing via `User`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue
git commit -m "feat(web): show invite code and invitee count on profile"
```

---

### Task 7: Full verify + PR

**Files:** none new

- [ ] **Step 1: Run**

```bash
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm --filter @lnkpi/server exec vitest run src/auth/
```

Expected: build PASS; auth tests PASS

- [ ] **Step 2: Push and open PR** against `main` with summary + test plan from spec §5

- [ ] **Step 3: Watch CI; squash merge after green; retest prod register/login/invite/legal**

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| Full-bleed left video | 5 |
| Login/register tabs + copy | 5 |
| Optional invite on register | 4–5 |
| Invalid invite rejects | 3–4 |
| Personal invite codes + lazy backfill | 3–4 |
| +200/+200 + daily cap 20 | 3 |
| Profile code + copy + N | 6 |
| `/terms` `/privacy` + brand info | 1 |
| Split login/register APIs | 4 |
| Captcha send-code unchanged | 4 (no change) |

## Plan self-review

- No TBD placeholders; points use existing `PointsService.refund` + grant meta
- `inviteCode` nullable in DB for safe migrate; app always ensures before return
- Pre-validate invite before `user.create` to avoid orphans on bad codes
- Types aligned: `inviteeCount`, `INVITE_REWARD_POINTS = 200`
