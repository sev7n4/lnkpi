# 节点任务状态反馈（布局 C）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 文本生成不覆盖 Dock 提示词；Dock/卡片可取消；节点标题徽章显示生成中耗时/失败/完成，角标提供取消与重试。

**Architecture:** 共享 `NodeTaskChrome`（徽章挂 `NeoBaseNode` 标题行，角标叠在卡片内容右上）。`CanvasPage` 通过 `provide` 注入 `cancelGeneration` / `retryGeneration`。`useNodeGeneration` 在开始任务时写入 `generationStartedAt`，完成只写 `content` 不改 `prompt`。

**Tech Stack:** Vue 3、Vitest、现有 `NeoBaseNode` / `useNodeGeneration` / `canvasNodeActions` provide 模式

**Spec:** `docs/superpowers/specs/2026-07-20-node-task-status-feedback-design.md`

## Global Constraints

- 布局锁定 **C**：标题徽章 + 角标操作；不做底部条 / 全卡遮罩
- 进度仅 **已用时 m:ss**；无假百分比
- 取消 = 客户端 abort + 停轮询；**不清空**已有 `url`/`content`；无上游 cancel API
- 覆盖节点：`text` / `image` / `video` / `audio` / `shot`
- 分支：`fix/text-prompt-result-separation`（已有部分改动，勿另开无关分支）
- 提交前相关单测绿；最终 `pnpm --filter @lnkpi/web exec vitest run` 与 `pnpm build` 通过
- 不把 `.superpowers/` 加入 commit

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `apps/web/src/composables/useNodeGeneration.ts` | prompt/content 分离；`generationStartedAt`；cancel 保留结果 |
| `apps/web/src/composables/useNodeGeneration.test.ts` | 文本/耗时/取消断言 |
| `apps/web/src/components/canvas/dock-studio/panels/TextDockPanel.vue` | Dock 只绑定 `prompt` |
| `apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue` | 停止图标可取消 |
| `apps/web/src/pages/CanvasPage.vue` | flush 前取消；provide cancel/retry |
| `apps/web/src/styles/neo-node.css` | 生成按钮可点；徽章/角标样式 |
| `apps/web/src/composables/canvasNodeActions.ts` | 新增 InjectionKey |
| `apps/web/src/components/canvas/nodeTaskChrome.ts` | 徽章文案 / 角标模式 / 耗时格式纯函数 |
| `apps/web/src/components/canvas/nodeTaskChrome.test.ts` | 纯函数单测 |
| `apps/web/src/components/canvas/NodeTaskBadge.vue` | 标题徽章（含 tick 刷新） |
| `apps/web/src/components/canvas/NodeTaskCornerActions.vue` | 角标取消/重试 |
| `apps/web/src/components/canvas/NeoBaseNode.vue` | 标题行挂徽章 slot/prop |
| `apps/web/src/components/canvas/CanvasNode{Text,Image,Video,Audio,Shot}.vue` | 挂角标 + 错误摘要 |
| `apps/web/src/components/canvas/CanvasNodeText.vue` | 双击编辑 content（对齐 Prompt 节点） |

---

### Task 1: 固化文本 prompt/content 分离 + Dock 取消（分支已有改动）

**Files:**
- Modify（若未完成则补齐）: `useNodeGeneration.ts`、`TextDockPanel.vue`、`DockGenerateButton.vue`、`CanvasPage.vue`、`neo-node.css`、各 Dock `DockGenerateButton` `:disabled`
- Test: `useNodeGeneration.test.ts`

**Interfaces:**
- Produces: 文本完成 patch **不含** `prompt`；生成中 patch **不含** `content`；`cancelGeneration(nodeId)`；`isNodeBusy(nodeId)`

- [ ] **Step 1: 确认失败测试存在并失败于旧行为（若已绿则跳到 Step 3）**

已有用例名：`text generate writes result to content without overwriting prompt`

Run:

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeGeneration.test.ts -t "text generate writes"
```

Expected: PASS（分支已实现）或 FAIL 指出仍写入 `prompt`/`content` 混用

- [ ] **Step 2: 若 FAIL，最小修复**

`applyStudioRecord` 文本完成分支：

```ts
} else {
  const content = parseRecordText(record)
  patch.content = content
  // do NOT set patch.prompt
}
```

文本开始：

```ts
deps.patchNodeData(node.id, { status: NODE_GENERATION_STATUS.generating, prompt: local })
```

`TextDockPanel`：本地 `prompt` ref，只 watch `node.id` / `data.prompt` / `data.textModel`，勿 deep-watch 整个 node。

- [ ] **Step 3: 跑相关测试**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeGeneration.test.ts
```

Expected: 全部 PASS（含 parallel / cancel）

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/useNodeGeneration.ts \
  apps/web/src/composables/useNodeGeneration.test.ts \
  apps/web/src/components/canvas/dock-studio/panels/TextDockPanel.vue \
  apps/web/src/components/canvas/dock-studio/shared/DockGenerateButton.vue \
  apps/web/src/components/canvas/dock-studio/panels/ImageDockPanel.vue \
  apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue \
  apps/web/src/components/canvas/dock-studio/panels/AudioDockPanel.vue \
  apps/web/src/components/canvas/dock-studio/panels/PromptDockPanel.vue \
  apps/web/src/components/canvas/dock-studio/panels/ShotDockPanel.vue \
  apps/web/src/pages/CanvasPage.vue \
  apps/web/src/styles/neo-node.css
git commit -m "$(cat <<'EOF'
fix(web): 文本结果与 Dock 提示词分离，生成中可取消

EOF
)"
```

---

### Task 2: `generationStartedAt` 写入与取消保留结果

**Files:**
- Modify: `apps/web/src/composables/useNodeGeneration.ts`
- Test: `apps/web/src/composables/useNodeGeneration.test.ts`

**Interfaces:**
- Consumes: `beginNodeWork` / `patchNodeData`
- Produces: 进入 generating 时 patch 含 `generationStartedAt: string`（ISO）；`cancelGeneration` 不删除 `url`/`content`

- [ ] **Step 1: 写失败测试**

```ts
it('writes generationStartedAt when generation begins', async () => {
  const node = createNode('image', { prompt: 'cat' }, 'img-1')
  let resolveHang!: (v: unknown) => void
  const hang = new Promise((r) => { resolveHang = r })
  vi.mocked(studioApi.generateImage).mockImplementationOnce(() => hang as never)
  const { api, deps } = createDeps([node])
  const pending = api.generateForNode(node)
  await Promise.resolve()
  expect(deps.patchNodeData).toHaveBeenCalledWith(
    'img-1',
    expect.objectContaining({
      status: NODE_GENERATION_STATUS.generating,
      generationStartedAt: expect.stringMatching(/^\d{4}-/),
    }),
  )
  resolveHang(mockAxiosResponse({ data: completedRecord }))
  await pending
})

it('cancel keeps existing content and url', async () => {
  const node = createNode('image', {
    prompt: 'x',
    url: 'https://example.com/keep.png',
    content: 'keep-me',
    status: NODE_GENERATION_STATUS.generating,
  }, 'img-keep')
  // make busy then cancel
  let rejectHang!: (e: unknown) => void
  const hang = new Promise((_r, j) => { rejectHang = j })
  vi.mocked(studioApi.generateImage).mockImplementation((_a, _b, _c, _d, _e, _f, _g, signal?: AbortSignal) => {
    signal?.addEventListener('abort', () => {
      const err = new Error('canceled')
      ;(err as { code?: string }).code = 'ERR_CANCELED'
      rejectHang(err)
    })
    return hang as never
  })
  const { api, deps } = createDeps([node])
  const pending = api.generateForNode(node)
  await Promise.resolve()
  await api.generateForNode(node) // cancel
  await pending
  const draftPatch = deps.patchNodeData.mock.calls.find(
    (c) => c[1]?.status === NODE_GENERATION_STATUS.draft,
  )?.[1] as Record<string, unknown>
  expect(draftPatch).toBeTruthy()
  expect(draftPatch).not.toHaveProperty('url')
  expect(draftPatch).not.toHaveProperty('content')
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter @lnkpi/web exec vitest run src/composables/useNodeGeneration.test.ts -t "generationStartedAt|cancel keeps"
```

- [ ] **Step 3: 实现**

在首次进入 generating 的 patch（text/image/video/audio/shot 及 `beginNodeWork` 后的统一辅助）合并：

```ts
function startedAtPatch(): Record<string, unknown> {
  return { generationStartedAt: new Date().toISOString() }
}
```

`cancelGeneration` 仅：

```ts
deps.patchNodeData(nodeId, {
  status: NODE_GENERATION_STATUS.draft,
  errorMessage: null,
})
```

不要 patch `url`/`content` 为 null。

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useNodeGeneration.ts apps/web/src/composables/useNodeGeneration.test.ts
git commit -m "feat(web): record generationStartedAt and preserve results on cancel"
```

---

### Task 3: `nodeTaskChrome` 纯函数

**Files:**
- Create: `apps/web/src/components/canvas/nodeTaskChrome.ts`
- Create: `apps/web/src/components/canvas/nodeTaskChrome.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TaskCornerAction = 'cancel' | 'retry' | null
  export function formatElapsed(startedAt: string | undefined, nowMs: number): string // "0:42"
  export function resolveTaskBadge(input: {
    status: unknown
    startedAt?: string
    nowMs: number
    completedFlash?: boolean
  }): { text: string; tone: 'running' | 'error' | 'success' | 'pending' } | null
  export function resolveCornerAction(status: unknown): TaskCornerAction
  export function truncateError(message: string | undefined, max = 40): string
  ```

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  resolveTaskBadge,
  resolveCornerAction,
  truncateError,
} from './nodeTaskChrome'
import { NODE_GENERATION_STATUS } from '@/constants/dockStudio'

describe('nodeTaskChrome', () => {
  it('formats elapsed as m:ss', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    expect(formatElapsed(start, Date.parse('2026-07-20T00:00:42.000Z'))).toBe('0:42')
    expect(formatElapsed(start, Date.parse('2026-07-20T00:03:05.000Z'))).toBe('3:05')
  })

  it('badge for generating includes elapsed', () => {
    const start = new Date('2026-07-20T00:00:00.000Z').toISOString()
    const b = resolveTaskBadge({
      status: NODE_GENERATION_STATUS.generating,
      startedAt: start,
      nowMs: Date.parse('2026-07-20T00:00:12.000Z'),
    })
    expect(b).toEqual({ text: '生成中 · 0:12', tone: 'running' })
  })

  it('corner cancel/retry mapping', () => {
    expect(resolveCornerAction(NODE_GENERATION_STATUS.generating)).toBe('cancel')
    expect(resolveCornerAction(NODE_GENERATION_STATUS.error)).toBe('retry')
    expect(resolveCornerAction(NODE_GENERATION_STATUS.fallback_pending)).toBeNull()
    expect(resolveCornerAction(NODE_GENERATION_STATUS.completed)).toBeNull()
  })

  it('truncates error', () => {
    expect(truncateError('x'.repeat(50)).length).toBeLessThanOrEqual(40)
  })
})
```

- [ ] **Step 2: Run — expect FAIL（module missing）**

```bash
pnpm --filter @lnkpi/web exec vitest run src/components/canvas/nodeTaskChrome.test.ts
```

- [ ] **Step 3: 实现纯函数**（`formatElapsed`：缺 `startedAt` 时用 `0:00`）

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/nodeTaskChrome.ts apps/web/src/components/canvas/nodeTaskChrome.test.ts
git commit -m "feat(web): add nodeTaskChrome badge and corner helpers"
```

---

### Task 4: InjectionKey + CanvasPage provide cancel/retry

**Files:**
- Modify: `apps/web/src/composables/canvasNodeActions.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Produces:
  ```ts
  export type CanvasNodeCancelFn = (nodeId: string) => void
  export type CanvasNodeRetryFn = (nodeId: string) => void | Promise<void>
  export const CANVAS_NODE_CANCEL_KEY: InjectionKey<CanvasNodeCancelFn>
  export const CANVAS_NODE_RETRY_KEY: InjectionKey<CanvasNodeRetryFn>
  ```
- `retryGeneration(nodeId)`：找节点 → 若无 prompt（`prompt`/`content` 按类型）则 `patchNodeData` 短暂错误或 no-op；否则 `generateForNode(node)`

- [ ] **Step 1: 扩展 keys**

```ts
// canvasNodeActions.ts — append
export type CanvasNodeCancelFn = (nodeId: string) => void
export type CanvasNodeRetryFn = (nodeId: string) => void | Promise<void>
export const CANVAS_NODE_CANCEL_KEY: InjectionKey<CanvasNodeCancelFn> = Symbol('canvasNodeCancel')
export const CANVAS_NODE_RETRY_KEY: InjectionKey<CanvasNodeRetryFn> = Symbol('canvasNodeRetry')
```

- [ ] **Step 2: CanvasPage provide**

在已有 `cancelGeneration` / `generateForNode` / `nodes` 处：

```ts
function retryNodeGeneration(nodeId: string) {
  const node = nodes.value.find((n) => n.id === nodeId)
  if (!node) return
  const data = node.data ?? {}
  const prompt = String(data.prompt ?? '').trim()
  if (!prompt && String(node.type) !== 'sceneComposer') {
    patchNodeData(nodeId, {
      status: NODE_GENERATION_STATUS.error,
      errorMessage: '请先填写提示词',
    })
    return
  }
  patchNodeData(nodeId, { errorMessage: null })
  return generateForNode(node as EditableFlowNode)
}

provide(CANVAS_NODE_CANCEL_KEY, (id) => cancelGeneration(id))
provide(CANVAS_NODE_RETRY_KEY, (id) => { void retryNodeGeneration(id) })
```

- [ ] **Step 3: 手动类型检查**

```bash
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
```

Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/composables/canvasNodeActions.ts apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): provide canvas node cancel and retry actions"
```

---

### Task 5: `NodeTaskBadge` + `NeoBaseNode` 标题徽章

**Files:**
- Create: `apps/web/src/components/canvas/NodeTaskBadge.vue`
- Modify: `apps/web/src/components/canvas/NeoBaseNode.vue`
- Modify: `apps/web/src/styles/neo-node.css`

**Interfaces:**
- Consumes: `resolveTaskBadge` / `formatElapsed`
- `NeoBaseNode` 增加从 `data.status` / `data.generationStartedAt` 自动渲染徽章（默认开启）；`completed` 进入后本地 `flash` 2s

- [ ] **Step 1: 实现 `NodeTaskBadge.vue`**

```vue
<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { resolveTaskBadge } from '@/components/canvas/nodeTaskChrome'

const props = defineProps<{
  status?: unknown
  startedAt?: string
}>()

const nowMs = ref(Date.now())
const completedFlash = ref(false)
let tick: ReturnType<typeof setInterval> | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.status,
  (s, prev) => {
    if (s === 'completed' && prev && prev !== 'completed') {
      completedFlash.value = true
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => { completedFlash.value = false }, 2000)
    }
  },
)

watch(
  () => props.status,
  (s) => {
    clearInterval(tick)
    if (s === 'generating' || s === 'pending') {
      nowMs.value = Date.now()
      tick = setInterval(() => { nowMs.value = Date.now() }, 1000)
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  clearInterval(tick)
  clearTimeout(flashTimer)
})

const badge = computed(() =>
  resolveTaskBadge({
    status: props.status,
    startedAt: props.startedAt,
    nowMs: nowMs.value,
    completedFlash: completedFlash.value,
  }),
)
</script>

<template>
  <span v-if="badge" class="neo-task-badge" :class="`is-${badge.tone}`">{{ badge.text }}</span>
</template>
```

`resolveTaskBadge` 对 `completedFlash===true` 返回 `{ text: '已完成', tone: 'success' }`；否则 completed 返回 `null`。

- [ ] **Step 2: NeoBaseNode 标题行插入徽章**

在 `neo-node-title` 与 `neo-node-status` 之间：

```vue
<NodeTaskBadge
  :status="data?.status"
  :started-at="typeof data?.generationStartedAt === 'string' ? data.generationStartedAt : undefined"
/>
```

- [ ] **Step 3: CSS**

```css
.neo-task-badge {
  margin-left: 6px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 999px;
  padding: 1px 7px;
  font-size: 10px;
  font-weight: 600;
}
.neo-task-badge.is-running { background: rgba(59,130,246,0.2); color: #93c5fd; }
.neo-task-badge.is-error { background: rgba(239,68,68,0.2); color: #fca5a5; }
.neo-task-badge.is-success { background: rgba(34,197,94,0.2); color: #86efac; }
.neo-task-badge.is-pending { background: rgba(245,158,11,0.2); color: #fcd34d; }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/NodeTaskBadge.vue \
  apps/web/src/components/canvas/NeoBaseNode.vue \
  apps/web/src/components/canvas/nodeTaskChrome.ts \
  apps/web/src/styles/neo-node.css
git commit -m "feat(web): show generation status badge on NeoBaseNode title"
```

---

### Task 6: `NodeTaskCornerActions` + 五类节点接入

**Files:**
- Create: `apps/web/src/components/canvas/NodeTaskCornerActions.vue`
- Modify: `CanvasNodeText.vue`、`CanvasNodeImage.vue`、`CanvasNodeVideo.vue`、`CanvasNodeAudio.vue`、`CanvasNodeShot.vue`
- Modify: `neo-node.css`

**Interfaces:**
- Consumes: `CANVAS_NODE_CANCEL_KEY` / `CANVAS_NODE_RETRY_KEY` / `resolveCornerAction` / `truncateError`
- Props: `status`、`errorMessage?`

- [ ] **Step 1: Corner 组件**

```vue
<script setup lang="ts">
import { computed, inject } from 'vue'
import { useNodeId } from '@vue-flow/core'
import { resolveCornerAction, truncateError } from '@/components/canvas/nodeTaskChrome'
import { CANVAS_NODE_CANCEL_KEY, CANVAS_NODE_RETRY_KEY } from '@/composables/canvasNodeActions'

const props = defineProps<{ status?: unknown; errorMessage?: string }>()
const nodeId = useNodeId()
const cancel = inject(CANVAS_NODE_CANCEL_KEY, null)
const retry = inject(CANVAS_NODE_RETRY_KEY, null)
const action = computed(() => resolveCornerAction(props.status))
const err = computed(() => truncateError(props.errorMessage))

function onAction(e: Event) {
  e.stopPropagation()
  e.preventDefault()
  if (!nodeId) return
  if (action.value === 'cancel') cancel?.(nodeId)
  if (action.value === 'retry') void retry?.(nodeId)
}
</script>

<template>
  <div class="neo-task-corner nodrag nopan" @pointerdown.stop @mousedown.stop @click.stop>
    <p v-if="err && (status === 'error' || status === 'failed')" class="neo-task-error">{{ err }}</p>
    <button
      v-if="action"
      type="button"
      class="neo-task-corner-btn"
      :class="action === 'retry' ? 'is-retry' : 'is-cancel'"
      @click="onAction"
    >
      {{ action === 'retry' ? '重试' : '取消' }}
    </button>
  </div>
</template>
```

- [ ] **Step 2: 各 CanvasNode 在卡片根内加入**

```vue
<NodeTaskCornerActions :status="data.status" :error-message="data.errorMessage as string | undefined" />
```

父级需 `position: relative`（`neo-gen-card` / `neo-text-card` 已有或补上）。

- [ ] **Step 3: Text 节点双击编辑 content（对齐 Prompt）** — 可选同 Task：用现有 `PromptMarkdownEditor` 或简单 textarea；最小实现：双击打开编辑 `content`，不改 `prompt`。

- [ ] **Step 4: CSS 角标**

```css
.neo-task-corner {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 70%;
}
.neo-task-corner-btn {
  border: none;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.35);
}
.neo-task-corner-btn.is-cancel { background: #fff; color: #111; }
.neo-task-corner-btn.is-retry { background: #ef4444; color: #fff; }
.neo-task-error {
  margin: 0;
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(0,0,0,0.65);
  color: #fca5a5;
  font-size: 10px;
  line-height: 1.3;
  text-align: right;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/NodeTaskCornerActions.vue \
  apps/web/src/components/canvas/CanvasNodeText.vue \
  apps/web/src/components/canvas/CanvasNodeImage.vue \
  apps/web/src/components/canvas/CanvasNodeVideo.vue \
  apps/web/src/components/canvas/CanvasNodeAudio.vue \
  apps/web/src/components/canvas/CanvasNodeShot.vue \
  apps/web/src/styles/neo-node.css
git commit -m "feat(web): add corner cancel/retry actions on generation nodes"
```

---

### Task 7: 验收与 PR

**Files:** 无新文件；验证 + 开 PR

- [ ] **Step 1: 测试**

```bash
pnpm --filter @lnkpi/web exec vitest run \
  src/composables/useNodeGeneration.test.ts \
  src/components/canvas/nodeTaskChrome.test.ts
pnpm --filter @lnkpi/web exec vue-tsc --noEmit
pnpm build
```

Expected: 全绿

- [ ] **Step 2: 手测清单（本地或 Preview）**

按 spec §6.2 勾选 text + image

- [ ] **Step 3: Push + PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "fix(web): 节点任务状态反馈与文本提示词分离" --body "$(cat <<'EOF'
## Summary
- 文本 Dock 提示词与生成结果分离
- Dock / 卡片可取消生成；标题徽章显示耗时；角标取消/重试
- 覆盖 text/image/video/audio/shot

## Spec
docs/superpowers/specs/2026-07-20-node-task-status-feedback-design.md

## Test plan
- [ ] text：生成后 Dock 提示词不变
- [ ] 生成中徽章「生成中 · m:ss」，角标可取消
- [ ] 失败摘要 + 重试
- [ ] pnpm build / vitest 相关套件

EOF
)"
```

---

## Spec Coverage Checklist

| Spec 项 | Task |
|---------|------|
| 文本 prompt/content 分离 | T1 |
| Dock 可取消 | T1 |
| `generationStartedAt` | T2 |
| 取消保留结果 | T2 |
| 徽章文案/耗时/完成闪 | T3 + T5 |
| 角标取消/重试映射 | T3 + T6 |
| provide 注入 | T4 |
| 五类节点 | T6 |
| 失败摘要截断 | T3 + T6 |
| fallback_pending 无角标 | T3 |
| PR / 验收 | T7 |

## Placeholder Scan

无 TBD /「类似 Task N」占位；函数名与 InjectionKey 在全文一致。
