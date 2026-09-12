# Wave A · A1 PR2 图像 Upscale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 独立 `UpscaleProvider` + Nest `UpscaleService` + `POST /agent/canvas/material/upscale-image`；选中浮层「放大|编辑」与右键同步；Agent tool 同路径；capabilities `imageUpscale`；规格接入清单填实。

**Architecture:** `packages/agent` 定义 `UpscaleProvider`；优先探测/实现 Agnes；否则在现有通道能接尽接。Nest 扣点、调 provider、写 `image_upscale` record。前端浮层与右键调同一 API，成功新建 image 节点 + 源边。依赖 PR1 已合并非硬依赖（放大吃可访问 URL）。

**Tech Stack:** NestJS、Vitest、Vue 3、现有 Points / Session / canvas harness 模式、`@lnkpi/agent` provider 工厂

**Spec:** [docs/superpowers/specs/2026-09-12-wave-a-a1-sts-upscale-design.md](../specs/2026-09-12-wave-a-a1-sts-upscale-design.md) §5–§8  
**Prerequisite plan:** [2026-09-12-wave-a-a1-sts-direct-upload.md](./2026-09-12-wave-a-a1-sts-direct-upload.md)（建议先合 PR1）

## Global Constraints

- **禁止**用文生图 + 提示词「放大」冒充超分。
- UI 固定 `scale=2`；API 允许 `2|4`；无 4× 实现 → **400/501**，禁止静默降为 2。
- Agnes 能满足 → **只接 Agnes**；否则能接尽接；规格 §5.3 接入清单必须与注册表一致。
- 结果：**新节点 + 边**；不覆盖源 `data.url`。
- Dock **不**加放大主入口；浮层不出现 backlog 假按钮。
- `chargeReason: '图像放大'`；`reason-map` 归入 `image`。
- 人机同路径：UI / Agent 同一 `UpscaleService`。
- Commit per task；勿混入无关文件。

## File map

| File | Role |
| --- | --- |
| `packages/agent/src/tools/upscale-provider.ts` | 接口 + 工厂 + Agnes（或其它）实现 |
| `packages/agent/src/tools/upscale-provider.test.ts` | Provider 单测 |
| `packages/agent/src/index.ts` | export |
| `apps/server/src/studio/upscale.service.ts`（或 `canvas/upscale.service.ts`） | 扣点、归属、调 provider、写 record |
| `apps/server/src/studio/upscale.service.test.ts` | Service 单测 |
| `apps/server/src/canvas/canvas.controller.ts` | `POST material/upscale-image` |
| `apps/server/src/points/reason-map.ts` | `图像放大` → image |
| `apps/server/src/points/reason-map.test.ts` | 断言 |
| `apps/server/src/agent/agent.service.ts` | `imageUpscale` capability |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `upscaleImage` tool 方法 |
| `apps/server/src/agent/agent-canvas-tools.controller.ts` | 路由（若工具走 HTTP） |
| `apps/web/src/utils/refineSession.ts` 或新建 `upscaleNode.ts` | `canUpscaleNode`（= `canOpenRefineForNode`） |
| `apps/web/src/composables/useImageUpscale.ts` | 调 API + 建节点/边 |
| `apps/web/src/composables/useImageUpscale.test.ts` | 单测 |
| `apps/web/src/components/canvas/SelectionActionBar.vue`（新建） | 浮层两钮 |
| `apps/web/src/components/canvas/CanvasContextMenu.vue` | 「放大」 |
| `apps/web/src/pages` 或画布根组件 | 挂载浮层 |
| `docs/superpowers/specs/2026-09-12-wave-a-a1-sts-upscale-design.md` | §5.3 接入清单填实 |
| `docs/DOCK_STUDIO_E2E_TRACKING.md` | B-2 / I-7 更新 |

---

### Task 1: UpscaleProvider 抽象 + Agnes 探测实现

**Files:**
- Create: `packages/agent/src/tools/upscale-provider.ts`
- Create: `packages/agent/src/tools/upscale-provider.test.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Produces:
```ts
export interface UpscaleInput {
  imageUrl: string
  scale: 2 | 4
}
export interface UpscaleResult {
  url: string
  providerId: string
  modelId?: string
}
export interface UpscaleProvider {
  readonly id: string
  /** 该实现是否支持给定 scale；不支持则 service 层返回 400/501 */
  supportsScale(scale: 2 | 4): boolean
  upscale(input: UpscaleInput): Promise<UpscaleResult>
}
export function createUpscaleProviders(opts: {
  agnesApiKey?: string
  agnesBaseUrl?: string
  // 仅当 Agnes 不可用时追加其它通道字段
}): UpscaleProvider[]
```

- [ ] **Step 1: 探测 Agnes（实现前手工/脚本）**

用现有 platform `OPENAI_*` / Agnes 文档与一次真实或 staging 请求确认：是否存在「输入图 + 2× → 更高分辨率」API。  
将结论写入规格 §5.3（满足 → 只实现 Agnes；不满足 → 本 Task 改为实现备选通道，仍禁止文生图冒充）。

- [ ] **Step 2: 写失败单测（以 Agnes 满足为例）**

```ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createUpscaleProviders } from './upscale-provider'

describe('createUpscaleProviders', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns empty without credentials', () => {
    expect(createUpscaleProviders({})).toEqual([])
  })

  it('agnes upscales 2x via upstream API', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      // 按实际 Agnes 路径断言 method/body；返回 { url: 'https://out/hi.png' }
      return new Response(JSON.stringify({ data: [{ url: 'https://out/hi.png' }] }), { status: 200 })
    }))
    const providers = createUpscaleProviders({
      agnesApiKey: 'k',
      agnesBaseUrl: 'https://api.agnes-ai.com/v1',
    })
    expect(providers.map((p) => p.id)).toEqual(['agnes'])
    expect(providers[0].supportsScale(2)).toBe(true)
    expect(providers[0].supportsScale(4)).toBe(false) // 若 Agnes 仅 2×；若支持 4 则改 true
    const out = await providers[0].upscale({
      imageUrl: 'https://in/a.png',
      scale: 2,
    })
    expect(out).toEqual({
      url: 'https://out/hi.png',
      providerId: 'agnes',
      modelId: expect.any(String),
    })
  })
})
```

（若 Agnes 不满足：改为 APIMart/其它真实超分端点的等价测试，`id` 写入清单。）

Run: `pnpm --filter @lnkpi/agent exec vitest run src/tools/upscale-provider.test.ts`  
Expected: FAIL

- [ ] **Step 3: 实现最小 provider + 工厂；单测 PASS**

- [ ] **Step 4: 更新规格 §5.3 接入清单为「已接入」行**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(agent): add UpscaleProvider with Agnes-first wiring

EOF
)"
```

---

### Task 2: reason-map + UpscaleService

**Files:**
- Modify: `apps/server/src/points/reason-map.ts`
- Modify: `apps/server/src/points/reason-map.test.ts`
- Create: `apps/server/src/studio/upscale.service.ts`（若 canvas 更合适则放 `canvas/`，与 `MaterialService` 并列并在 module 注册）
- Create: `apps/server/src/studio/upscale.service.test.ts`

**Interfaces:**
- Produces:
```ts
// UpscaleService
upscale(input: {
  userId: string
  sessionId: string
  nodeId?: string
  imageUrl?: string
  scale?: 2 | 4
  providerId?: string
}): Promise<{ url: string; scale: 2 | 4; providerId: string; recordId: string }>
```
- 常量：`UPSCALE_POINT_COST` = 与单次图像生成同档（查现网 `图像生成` consume 金额，复制为命名常量，禁止魔法散落）。
- `chargeReason = '图像放大'`

- [ ] **Step 1: reason-map**

```ts
{ match: /图像生成|图像变体|图像精修|图像放大/, category: 'image' },
```

测试：`mapReasonToPointFields('图像放大', -10).category === 'image'`。

- [ ] **Step 2: UpscaleService 失败单测**

覆盖：无 provider → 抛可映射 501；`scale=4` 且 `!supportsScale(4)` → BadRequest；积分不足；成功路径 mock provider + points.consume + prisma record。

归属：`sessionId` 必须属于 `userId`；若有 `nodeId`，从 `Session.canvasData` 解析节点 URL（复用现有 agent-canvas-tools 读节点 helper，禁止复制 SSRF 宽松逻辑）。

- [ ] **Step 3: 实现 — 先 consume，失败 refund（对齐 `studio.service` 精修模式）**

- [ ] **Step 4: 单测 PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(studio): add UpscaleService with points and image_upscale records

EOF
)"
```

---

### Task 3: HTTP + Agent tool + capabilities

**Files:**
- Modify: `apps/server/src/canvas/canvas.controller.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`（+ controller 若需要）
- Modify: `apps/server/src/agent/agent.service.ts`
- Tests: controller/service 级

**Interfaces:**
- `POST /agent/canvas/material/upscale-image` body: `{ sessionId, nodeId?, imageUrl?, scale?, provider? }`
- Agent: `upscaleImage(...)` 调同一 `UpscaleService`
- `getCapabilities().imageUpscale` = 注册表非空

- [ ] **Step 1: 写测 — capabilities false when no providers；route 调 service**

- [ ] **Step 2: 接线实现**

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(canvas): expose upscale-image API and Agent tool

EOF
)"
```

---

### Task 4: 前端 composable + 浮层 + 右键

**Files:**
- Create: `apps/web/src/composables/useImageUpscale.ts`
- Create: `apps/web/src/composables/useImageUpscale.test.ts`
- Create: `apps/web/src/components/canvas/SelectionActionBar.vue`
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`
- Modify: 画布根（挂载浮层；查 `CanvasView` / `StudioCanvas` 等现有挂载 `CanvasContextMenu` 处）
- Optional: `apps/web/src/utils/upscaleNode.ts` 导出 `canUpscaleNode = canOpenRefineForNode`

**Interfaces:**
- `useImageUpscale().runUpscale({ sessionId, nodeId, imageUrl })` → API → 调用方传入的 `onSuccess({ url })` 建节点
- 浮层：单选 + `canUpscaleNode` 时显示；按钮「放大」「编辑」
- `imageUpscale===false` → 放大 **disabled + title tooltip**
- 编辑 → 现有 `edit-image` / open Refine 同路径

- [ ] **Step 1: composable 单测**（mock api；断言 POST path 与 loading）

- [ ] **Step 2: SelectionActionBar — 两钮；loading；disabled**

挂载方式参考 `NodeEditorToolbarOverlay`（节点坐标系），或屏幕坐标贴选中节点 bbox；**二选一写死在实现注释**，优先节点坐标系避免缩放错位。

- [ ] **Step 3: 成功后建节点**

在现有 add-node helper 中：

```ts
// 伪代码 — 对齐仓库现有 addNode / addEdge API
const newId = addImageNode({ url: result.url, position: offsetFrom(source) })
addEdge({ source: sourceNodeId, target: newId })
```

- [ ] **Step 4: ContextMenu 增加「放大」**（`showEditImage` 同条件；顺序：放大 → 编辑图像）

- [ ] **Step 5: 相关 vitest PASS + Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): selection bar and context menu for image upscale

EOF
)"
```

---

### Task 5: 注册表 ↔ 规格清单断言 + tracking + PR

- [ ] **Step 1: 单测**

```ts
it('registered provider ids are listed as connected in spec checklist constant', () => {
  const ids = createUpscaleProviders(testCreds).map((p) => p.id)
  expect(SPEC_CONNECTED_UPSCALE_PROVIDERS).toEqual(expect.arrayContaining(ids))
})
```

将「已接入」id 数组放在 `packages/agent` 或 `shared` 常量，与规格表同步（改清单必须改常量）。

- [ ] **Step 2: 更新 `DOCK_STUDIO_E2E_TRACKING.md` B-2 / I-7**

- [ ] **Step 3: 验证**

```bash
pnpm --filter @lnkpi/agent exec vitest run src/tools/upscale-provider.test.ts
pnpm --filter @lnkpi/server exec vitest run src/studio/upscale.service.test.ts src/points/reason-map.test.ts
pnpm --filter @lnkpi/web exec vitest run src/composables/useImageUpscale.test.ts
pnpm build
```

- [ ] **Step 4: PR** `feature/a1-image-upscale`，引用规格 §5–§8；Test plan：浮层放大出新节点；无 provider disabled；积分流水。

---

## Spec coverage (PR2)

| Spec § | Task |
|--------|------|
| 5.1–5.3 Provider + 清单 | T1, T5 |
| 5.4 API | T3 |
| 5.5 计费 | T2 |
| 5.6 落点 | T4 |
| 5.7 Agent | T3 |
| 5.8 capabilities | T3 |
| 6 UI | T4 |
| 7 错误 | T2–T4 |
| 8 测试 | 各 Task |
| 直传 | **不在本计划** |
