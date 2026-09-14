# Account Chrome + Profile IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify homepage and canvas account chrome into one shared component family, and rebuild `/profile` as Account | Billing tabs with matching identity language plus a × close that prefers `router.back()`.

**Architecture:** Extract `AccountPointsPill`, `AccountUserMenu`, and `AccountChrome` under `components/account/`. Wire `AppHeader` and `CanvasAccountChrome` to the shared chrome. Refactor `ProfilePage` into query-synced tabs (`account` | `billing`) without changing billing API semantics.

**Tech Stack:** Vue 3 + Pinia + Vue Router + Tailwind / neo tokens; Vitest + Vue Test Utils.

**Spec:** [docs/superpowers/specs/2026-09-15-account-chrome-profile-ia-design.md](../specs/2026-09-15-account-chrome-profile-ia-design.md)

## Global Constraints

- Shared chrome on **AppHeader** and **canvas** — same pill + avatar menu
- Profile tabs: **账户** | **账单**; default `account`; deep link `?tab=billing`
- Avatar: brand mascot (`BRAND_LOGO_URL`), not letter block
- Points accent: warm amber `--neo-warm` / `#E8A45C`
- Close ×: `router.back()`; fallback `router.replace('/workflow')`
- Canvas points click still opens **MembershipModal** (not billing)
- No nickname edit, invite leaderboard, or profile-as-modal
- Account tab ≤3 blocks: identity / energy / invite
- Commit per task; do not stage unrelated dirty files
- Branch: `feature/account-chrome-profile-ia` (rebase/merge latest `main` before PR if needed)

## File map

| File | Role |
| --- | --- |
| `apps/web/src/components/account/AccountPointsPill.vue` | Points pill UI + click emit |
| `apps/web/src/components/account/AccountUserMenu.vue` | Avatar + popover menu |
| `apps/web/src/components/account/AccountChrome.vue` | Logged-in combo / logged-out login |
| `apps/web/src/components/layout/AppHeader.vue` | Consume AccountChrome |
| `apps/web/src/components/canvas/CanvasAccountChrome.vue` | Thin wrapper around AccountChrome |
| `apps/web/src/pages/ProfilePage.vue` | Tabs + account visual + close + billing shell |
| `apps/web/src/pages/ProfilePage.test.ts` | Tab, close, account copy coverage |

---

### Task 1: AccountPointsPill + AccountUserMenu

**Files:**
- Create: `apps/web/src/components/account/AccountPointsPill.vue`
- Create: `apps/web/src/components/account/AccountUserMenu.vue`

**Interfaces:**
- Produces:
  - `AccountPointsPill` — uses `auth.user?.points`; `emit('click')`
  - `AccountUserMenu` — props `{ compact?: boolean }`; emits `open-membership`; navigates to `/profile?tab=account`; calls `auth.logout()`

- [ ] **Step 1: Implement AccountPointsPill**

Port visual from `CanvasAccountChrome` points button: `neo-chrome`, lightning SVG with `color: var(--neo-warm)`, tabular nums, label「积分」. `@click` → `emit('click')`.

- [ ] **Step 2: Implement AccountUserMenu**

Port popover from canvas: mascot avatar button, `user-card-head` with `--neo-brand-gradient`, membership label helper, recharge row emit `open-membership`, items「个人资料」→ `router.push({ path: '/profile', query: { tab: 'account' } })`,「退出」→ logout. Use `useClickOutside` like canvas. Respect `compact` for slightly tighter padding if useful; otherwise ignore prop with no behavior change.

- [ ] **Step 3: Smoke**

Run: `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false`  
Expected: PASS for these files (or fix type errors introduced)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/account/AccountPointsPill.vue apps/web/src/components/account/AccountUserMenu.vue
git commit -m "feat(web): add shared account points pill and user menu"
```

---

### Task 2: AccountChrome + wire AppHeader and Canvas

**Files:**
- Create: `apps/web/src/components/account/AccountChrome.vue`
- Modify: `apps/web/src/components/layout/AppHeader.vue`
- Modify: `apps/web/src/components/canvas/CanvasAccountChrome.vue`

**Interfaces:**
- Consumes: Pill + UserMenu
- Produces: `AccountChrome` — logged-out login button; logged-in pill+menu; owns or receives membership modal

- [ ] **Step 1: Implement AccountChrome**

```vue
<!-- sketch -->
<template>
  <template v-if="auth.isLoggedIn">
    <div class="flex items-center gap-2" :class="rootClass">
      <AccountPointsPill @click="openMembership" />
      <AccountUserMenu :compact="compact" @open-membership="openMembership" />
    </div>
    <MembershipModal v-if="ownsModal" v-model="showMembership" />
  </template>
  <button v-else type="button" class="..." @click="auth.openLogin()">登录</button>
</template>
```

Prefer **internal** `MembershipModal` + `showMembership` (like current Canvas) so AppHeader can drop its own modal. Props: `compact?: boolean`, `rootClass?: string` (canvas may pass `pointer-events-auto`).

- [ ] **Step 2: Replace AppHeader account cluster**

Remove indigo points button, letter avatar, inline logout. Render `<AccountChrome />`. Remove duplicate `MembershipModal` if Chrome owns it.

- [ ] **Step 3: Slim CanvasAccountChrome**

Keep export path used by `CanvasPage` (`CanvasAccountChrome`). Implementation becomes wrapper:

```vue
<AccountChrome compact class="canvas-account-chrome pointer-events-auto" />
```

Preserve any required CSS class names for layout. Remove duplicated styles that moved into shared components. Drop `v-model:show-membership` if Chrome owns modal — update `CanvasPage.vue` if it still binds `showMembership` only for account chrome (keep page-level membership if other canvas CTAs need it).

Check `CanvasPage` for `showMembership` / `CanvasAccountChrome` props and adjust to compile.

- [ ] **Step 4: vue-tsc**

Run: `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/account/AccountChrome.vue \
  apps/web/src/components/layout/AppHeader.vue \
  apps/web/src/components/canvas/CanvasAccountChrome.vue \
  apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): unify header and canvas account chrome"
```

---

### Task 3: ProfilePage tabs, close ×, account visual

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.vue`
- Modify: `apps/web/src/pages/ProfilePage.test.ts`

**Interfaces:**
- Query: `tab=account|billing`
- Close: back or `/workflow`

- [ ] **Step 1: Expand failing/updated tests first**

Update `ProfilePage.test.ts` mocks:

```ts
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    replace: vi.fn(),
  }),
  useRoute: () => ({ query: {} }),
}))
```

Add cases (adjust mount with Pinia + logged-in user as today):

1. Default shows account copy:「创作能量」or「我的邀请码」, and Tab「账户」
2. When route query `tab=billing` (mock `useRoute` returning `{ query: { tab: 'billing' } }`), shows「积分账单」/ insight labels without requiring account-only exclusive text
3. Close button exists with `aria-label="关闭"`

Keep existing insight assertions scoped to billing tab mock.

- [ ] **Step 2: Run tests — expect FAIL** on new assertions

Run: `pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts`

- [ ] **Step 3: Implement ProfilePage structure**

- `activeTab` computed from `route.query.tab`, normalize to `account` | `billing`
- `setTab(tab)` → `router.replace({ query: { ...route.query, tab } })`
- Header row: title「个人中心」+ × close
- Capsule tabs under header
- `v-show` / `v-if` account vs billing panels
- Account panel: identity (mascot + nickname + phone + membership), energy (points amber + 充值/会员), invite (existing copy UI)
- Billing panel: move existing summary/filters/list markup here; keep script logic
- `closeProfile()`:

```ts
function closeProfile() {
  if (window.history.length > 1) router.back()
  else void router.replace('/workflow')
}
```

(Prefer also checking `history.state.back` if the app sets it elsewhere; length check is the spec fallback.)

- Visual: use `--neo-warm` for points; mascot via `BRAND_LOGO_URL`; max 3 account blocks; no purple letter avatar

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts`  
Also: `pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProfilePage.vue apps/web/src/pages/ProfilePage.test.ts
git commit -m "feat(web): profile account/billing tabs and close control"
```

---

### Task 4: Verify + PR

**Files:** none required

- [ ] **Step 1: Build**

```bash
pnpm --filter @lnkpi/web exec vue-tsc -b --pretty false
pnpm --filter @lnkpi/web exec vitest run src/pages/ProfilePage.test.ts
pnpm build
```

Expected: PASS

- [ ] **Step 2: Manual checklist** (local or preview)

- Header vs canvas chrome look the same
- Profile × returns to previous page
- `?tab=billing` works
- Invite copy still works

- [ ] **Step 3: Push + PR** against `main`

Title: `feat(web): unify account chrome and profile account/billing IA`  
Body: summary + test plan from spec §6

- [ ] **Step 4: CI green → squash merge when user requests**

---

## Spec coverage

| Spec item | Task |
| --- | --- |
| Shared pill + menu | 1–2 |
| AppHeader + Canvas unify | 2 |
| Profile Account \| Billing tabs + deep link | 3 |
| Account ≤3 blocks + amber + mascot | 3 |
| Close × back / workflow | 3 |
| Billing logic preserved | 3 |
| Tests + PR | 3–4 |

## Plan self-review

- Close fallback and tab sync match spec
- Membership owned by Chrome to avoid double modals; CanvasPage binding called out
- No placeholders; points color and mascot explicit
