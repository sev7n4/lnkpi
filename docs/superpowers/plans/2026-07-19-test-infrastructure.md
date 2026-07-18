# 测试基础设施 T0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立全仓 Vitest 测试地基（shared/agent 进 CI、server 集成、web composable），根脚本 `pnpm test` 一次跑齐。

**Architecture:** Server 用 `@nestjs/testing` + mock Prisma/Provider，测 Studio Controller→Service→Adapter→mock Provider；Web 用 Vitest + Vue Test Utils + jsdom，测 `useNodeGeneration` 请求组装；CI 在 build 后跑 `pnpm test`。

**Tech Stack:** Vitest 3、@nestjs/testing、unplugin-swc（或等价）、@vue/test-utils、jsdom、pnpm workspace

**Spec:** `docs/superpowers/specs/2026-07-19-test-infrastructure-design.md`

## Global Constraints

- 范围仅 **T0**：单元 + Server 集成；无 Playwright、无真库
- 全仓 **Vitest**；Prisma **mock**；Provider **mock**
- Web：**composable 为主**，少量组件冒烟即可
- 独立分支 `chore/test-infrastructure-t0`（从 main）；**不要**往 #25 分支继续堆代码
- C1 PR #25 暂停合并，待本 PR 合入后再 rebase
- 提交前：`pnpm test` 与 `pnpm build` 全绿

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `package.json` | `"test": "pnpm -r --if-present test"` |
| `.github/workflows/ci.yml` | build 后 `pnpm test` |
| `apps/server/package.json` | test 脚本 + vitest / @nestjs/testing / unplugin-swc 等 |
| `apps/server/vitest.config.ts` | Nest + SWC |
| `apps/server/src/studio/studio.integration.test.ts` | Studio 集成 |
| `apps/server/src/studio/studio.test-utils.ts`（可选） | mock Prisma / 模块工厂 |
| `apps/web/package.json` | test + vitest / @vue/test-utils / jsdom |
| `apps/web/vitest.config.ts` | Vue + jsdom |
| `apps/web/src/composables/useNodeGeneration.test.ts` | 生成 payload |
| `docs/superpowers/plans/2026-07-19-test-infrastructure.md` | 本计划 |

---

### Task 1: 根脚本 + CI 跑 shared + agent

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: 根命令 `pnpm test` 递归调用各包 `test`（`--if-present` 过渡；本计划结束时四包皆有）

- [ ] **Step 1: 改根 package.json**

在 `scripts` 中增加：

```json
"test": "pnpm -r --if-present test"
```

- [ ] **Step 2: 改 CI**

将 `Agent tests` 步骤替换为：

```yaml
      - name: Unit and integration tests
        run: pnpm test
```

- [ ] **Step 3: 本地验证**

```bash
pnpm --filter @lnkpi/shared test
pnpm --filter @lnkpi/agent test
pnpm test
```

Expected: shared + agent 绿；server/web 若尚无 script 则被 `--if-present` 跳过。

- [ ] **Step 4: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "chore(ci): run workspace pnpm test after build"
```

---

### Task 2: Server Vitest + Nest 装饰器配置

**Files:**
- Modify: `apps/server/package.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/src/studio/studio.smoke.test.ts`

**Interfaces:**
- Produces: `pnpm --filter @lnkpi/server test` 可执行

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @lnkpi/server add -D vitest @nestjs/testing @swc/core unplugin-swc
```

- [ ] **Step 2: vitest.config.ts + scripts**

```ts
import { defineConfig } from 'vitest/config'
import swc from 'unplugin-swc'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.integration.test.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
})
```

`package.json` 增加 `"test": "vitest run"`。

- [ ] **Step 3: 最小 smoke（证明 DI 可跑）**

```ts
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { StudioService } from './studio.service'
import { PrismaService } from '../prisma/prisma.service'

describe('studio nest harness', () => {
  it('boots StudioService with mocked Prisma', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PrismaService,
          useValue: {
            user: { findUnique: async () => ({ id: 'u1', points: 9999 }) },
            generationRecord: {
              create: async (args: { data: Record<string, unknown> }) => ({ id: 'g1', ...args.data }),
              update: async () => ({}),
              findFirst: async () => null,
              findMany: async () => [],
            },
            // 按 StudioService.consumePoints 实际表名补齐
          },
        },
      ],
    }).compile()

    expect(moduleRef.get(StudioService)).toBeDefined()
  })
})
```

打开 `studio.service.ts` 确认 `consumePoints` / Prisma 调用点，补全 mock。

- [ ] **Step 4: Run**

```bash
pnpm --filter @lnkpi/server test
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json apps/server/vitest.config.ts apps/server/src/studio/studio.smoke.test.ts pnpm-lock.yaml
git commit -m "chore(server): add vitest and nest testing harness"
```

---

### Task 3: Studio 集成测试（mock Provider + 参数断言）

**Files:**
- Create: `apps/server/src/studio/studio.integration.test.ts`
- Create: `apps/server/src/studio/studio.test-utils.ts`（可选）
- 可用 `vi.mock('@lnkpi/agent', ...)` mock `createImageProvider` / `createVideoProvider` / `createAudioProvider` / `createTextProvider` / `generateTextWithImages` / `mergeRefsToPrompt`

**Interfaces:**
- Consumes: `StudioService.generateImage|Video|Audio|Text`
- Produces: 断言 mock provider 收到的 options

- [ ] **Step 1: 写 Image 失败测试**

```ts
it('passes modelId size n to image provider', async () => {
  const generate = vi.fn(async () => ({ url: 'https://example.com/a.png', urls: ['https://example.com/a.png'] }))
  // mock createImageProvider → { generate }
  // mock mergeRefsToPrompt → { mergedText: 'a prompt', skippedMerge: true }
  await svc.generateImage('u1', 'a prompt', 'seedream-5.0-pro', '16:9', [], [], '1K', 2)
  expect(generate).toHaveBeenCalled()
  const opts = generate.mock.calls[0][1]
  expect(opts.modelId).toBeTruthy()
  expect(opts.n).toBe(2)
  expect(opts.size).toBeTruthy()
})
```

- [ ] **Step 2: Video / Audio / Text 同文件追加**

- Video：refs 含 image url → `generate` 第二参含 `image` 等于该 url  
- Audio：options 含 model、voice、speed、volume、pitch  
- Text：gatewayModelId 来自 `resolveModelKey('text', model)`  

- [ ] **Step 3: Run**

```bash
pnpm --filter @lnkpi/server test
```

Expected: PASS；无外网。

- [ ] **Step 4: Commit**

```bash
git commit -am "test(server): studio integration tests for model param passthrough"
```

---

### Task 4: Web Vitest + useNodeGeneration 测试

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Consumes: `useNodeGeneration(deps)`
- Produces: 断言 `studioApi.generate*` mock 参数

- [ ] **Step 1: 依赖 + config**

```bash
pnpm --filter @lnkpi/web add -D vitest @vue/test-utils jsdom
```

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
```

`"test": "vitest run"`

- [ ] **Step 2: Mock studio-api 并写用例**

1. audio：`generateAudio` 收到 model / volume / pitch  
2. image：`generateImage` 收到 model / resolution / count  
3. `blob:` referenceImageUrl → 不调用 API，patch error  

构造最小 `deps`（`ref` nodes/edges、`requireLogin: () => true`、stub patch/save/polling）。

- [ ] **Step 3: Run + Commit**

```bash
pnpm --filter @lnkpi/web test
git add apps/web && git commit -m "test(web): useNodeGeneration payload and blob guard tests"
```

---

### Task 5: 全仓验收 + PR

**Files:**
- Modify（可选）: `docs/superpowers/specs/2026-07-19-test-infrastructure-design.md` 状态栏

- [ ] **Step 1: 全量**

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm test
```

Expected: all green

- [ ] **Step 2: 可选更新规格状态 + Commit**

```bash
git commit -am "docs(spec): mark T0 test infrastructure implemented"
```

- [ ] **Step 3: Push + 独立 PR**

标题：`chore(test): T0 测试基础设施（Vitest + Server 集成 + CI）`  
Body：引用规格 §6；注明合入后需 rebase #25。

---

## Spec coverage

| 规格要求 | Task |
|----------|------|
| 根 `pnpm test` + CI | T1 |
| Server Vitest + Nest harness | T2 |
| Studio 集成四模态 | T3 |
| Web composable 测试 | T4 |
| 无 E2E / 无真库 | Global |
| 验收 build+test + PR | T5 |

## Self-review

- 无 TBD；Provider 用 `vi.mock('@lnkpi/agent')`  
- Task 1 `--if-present` 过渡，T2–T4 补齐后 CI 四包全跑  
- 分支：`chore/test-infrastructure-t0` from main；规格 commit 从 #25 分支 cherry-pick 过来  
