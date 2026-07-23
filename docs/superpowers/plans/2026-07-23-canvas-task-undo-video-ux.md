# 画布任务面板 / Undo / 视频交互 / 时长滑轨 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按节点聚合任务历史（可复制任务 ID、详情手风琴、失败诊断不溢出、可重试）、修复节点与左栏状态同步、视频节点拖/播双模式、5–15s 时长滑轨，以及画布图操作+参数 Undo/Redo。

**Architecture:** 纯逻辑抽到 `utils`/`composables`（聚合、poll 写入门闩、undo 栈、时长 clamp/计费）先用 Vitest 锁行为；UI 改 `CanvasTaskHistoryPanel`、`CanvasNodeVideo`、`VideoSettingsSelector`、`CanvasPage`。重试继续走现有 `retryNodeGeneration` → `generateForNode`（新建 GenerationRecord）。

**Tech Stack:** Vue 3、Vue Flow、Vitest、`@lnkpi/shared`、现有 `studioApi.listGenerations` 轮询

**Spec:** `docs/superpowers/specs/2026-07-23-canvas-task-undo-video-ux-design.md`

## Global Constraints

- 重试 = **新建** GenerationRecord；不新增 `/retry` API
- 列表：**一节点一行**（最新状态 +「第 N 次」）；详情：该节点全部尝试 **新→旧**，手风琴默认展开最新
- 视频：默认 **drag**；双击/▶ → **play**；Esc/失选 → drag
- 时长：整数秒 **5–15**，默认 5；计费档 `<10→30` / `≥10→50` / `≥15→70`
- Undo：图操作 + 提示词/参数；**不**回滚生成结果字段；输入框焦点不拦截文本撤销
- TDD：每个 Task 先写失败测试再实现；提交用 `feat:` / `fix:` / `test:` 前缀
- 工作流：feature 分支 + PR，禁止直接 push main（见 `.cursor/skills/mydev-github-workflow`）

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/utils/taskHistoryGrouping.ts` | 按 `nodeId` 聚合 GenerationRecord |
| `apps/web/src/utils/taskHistoryGrouping.test.ts` | 聚合单测 |
| `apps/web/src/utils/generationPollGate.ts` | poll 终态是否可写节点 |
| `apps/web/src/utils/generationPollGate.test.ts` | 门闩单测 |
| `apps/web/src/constants/credits.ts` | `estimateVideoCredits` 跟档 |
| `packages/shared/src/index.ts` | `VideoSettings.duration: number` + clamp 辅助 |
| `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue` | 列表聚合、详情历史、Teleport 诊断、重试 |
| `apps/web/src/components/canvas/NodeDiagnosticPopover.vue` | 保持；由面板 Teleport 承载 |
| `apps/web/src/components/canvas/CanvasNodeVideo.vue` | drag/play 双模式 |
| `apps/web/src/components/canvas/VideoSettingsSelector.vue` | 时长滑轨 |
| `apps/web/src/composables/useCanvasUndoStack.ts` | undo/redo 栈 |
| `apps/web/src/composables/useCanvasUndoStack.test.ts` | 栈单测 |
| `apps/web/src/pages/CanvasPage.vue` | 接入 poll 门闩、undo 快捷键、locate by nodeId、任务面板 retry |
| `apps/web/src/composables/useNodeGeneration.ts` | 终态写入门闩与 poll 对齐 |

---

### Task 1: 任务聚合纯函数 + 时长/计费工具

**Files:**
- Create: `apps/web/src/utils/taskHistoryGrouping.ts`
- Create: `apps/web/src/utils/taskHistoryGrouping.test.ts`
- Modify: `apps/web/src/constants/credits.ts`
- Modify: `packages/shared/src/index.ts`（`VideoSettings.duration` 与 `clampVideoDuration`）
- Create 或 Modify: `apps/web/src/constants/credits.test.ts`（若尚无则创建）
- Test: 上述 `*.test.ts`

**Interfaces:**
- Produces:
  - `export type TaskAttemptGroup = { nodeId: string | null; attempts: GenerationRecordLike[]; latest: GenerationRecordLike; attemptCount: number }`
  - `export function groupRecordsByNodeId(records: GenerationRecordLike[]): TaskAttemptGroup[]` — 组内 attempts **新→旧**；组间按 latest.createdAt **新→旧**；`nodeId` 空串/缺失 → `nodeId: null`（各自成组，不合并）
  - `export function clampVideoDuration(n: unknown): number` — `Math.round` 后限制到 `[5,15]`，非法回退 `5`
  - `estimateVideoCredits(durationSec)` 与服务端档位一致

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/utils/taskHistoryGrouping.test.ts
import { describe, expect, it } from 'vitest'
import { groupRecordsByNodeId } from './taskHistoryGrouping'

const r = (id: string, nodeId: string | null, createdAt: string, status = 'completed') =>
  ({ id, nodeId, createdAt, status, type: 'video', prompt: '' })

describe('groupRecordsByNodeId', () => {
  it('groups by nodeId, newest attempt first, marks attemptCount', () => {
    const groups = groupRecordsByNodeId([
      r('a', 'n1', '2026-07-23T10:00:00Z', 'failed'),
      r('b', 'n1', '2026-07-23T11:00:00Z', 'completed'),
      r('c', 'n2', '2026-07-23T09:00:00Z'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0].nodeId).toBe('n1')
    expect(groups[0].attemptCount).toBe(2)
    expect(groups[0].latest.id).toBe('b')
    expect(groups[0].attempts.map((x) => x.id)).toEqual(['b', 'a'])
    expect(groups[1].nodeId).toBe('n2')
  })

  it('keeps orphan records as separate groups', () => {
    const groups = groupRecordsByNodeId([
      r('x', null, '2026-07-23T12:00:00Z'),
      r('y', '', '2026-07-23T11:00:00Z'),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.nodeId === null)).toBe(true)
  })
})
```

```ts
// apps/web/src/constants/credits.test.ts（片段）
import { describe, expect, it } from 'vitest'
import { estimateVideoCredits } from './credits'
import { clampVideoDuration } from '@lnkpi/shared'

describe('estimateVideoCredits tiers', () => {
  it('matches server tiers for intermediate seconds', () => {
    expect(estimateVideoCredits(5)).toBe(30)
    expect(estimateVideoCredits(7)).toBe(30)
    expect(estimateVideoCredits(10)).toBe(50)
    expect(estimateVideoCredits(12)).toBe(50)
    expect(estimateVideoCredits(15)).toBe(70)
  })
})

describe('clampVideoDuration', () => {
  it('clamps and rounds', () => {
    expect(clampVideoDuration(7.4)).toBe(7)
    expect(clampVideoDuration(3)).toBe(5)
    expect(clampVideoDuration(99)).toBe(15)
    expect(clampVideoDuration('x')).toBe(5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/taskHistoryGrouping.test.ts src/constants/credits.test.ts`  
Expected: FAIL（模块/导出不存在或旧计费 map 断言失败）

- [ ] **Step 3: Implement**

`taskHistoryGrouping.ts`：用 `Map` 按有效 `nodeId` 分组；无效 `nodeId` 每条独立 key（如 `__orphan:${id}`），输出时 `nodeId: null`。

`packages/shared/src/index.ts`：

```ts
export interface VideoSettings {
  aspectRatio: VideoAspectRatio
  duration: number // 5–15 整数秒
  crop: VideoCropMode
  resolution: VideoResolution
}

export function clampVideoDuration(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 5
  return Math.min(15, Math.max(5, Math.round(v)))
}
```

同步放宽 `sceneComposer.ts` 中 `duration?: 5|10|15` 为 `duration?: number`（若有引用编译报错）。

`credits.ts`：

```ts
export function estimateVideoCredits(durationSec = 5): number {
  const d = Number(durationSec)
  if (!Number.isFinite(d)) return BASE_GENERATION_CREDITS.video
  if (d >= 15) return 70
  if (d >= 10) return 50
  return 30
}
```

可删除仅精确匹配的 `VIDEO_DURATION_CREDITS` map，或保留作文档但函数走档位逻辑。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同 Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/taskHistoryGrouping.ts apps/web/src/utils/taskHistoryGrouping.test.ts \
  apps/web/src/constants/credits.ts apps/web/src/constants/credits.test.ts \
  packages/shared/src/index.ts packages/shared/src/sceneComposer.ts
git commit -m "feat(web): 任务按节点聚合与视频时长计费档位工具"
```

---

### Task 2: Poll 终态写入门闩修复

**Files:**
- Create: `apps/web/src/utils/generationPollGate.ts`
- Create: `apps/web/src/utils/generationPollGate.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`（`acceptsPollWrite` / generationPolling 回调）
- Modify: `apps/web/src/composables/useNodeGeneration.ts`（`acceptsGenerationWrite` 与 resolve 路径）
- Test: `generationPollGate.test.ts`；必要时补 `useNodeGeneration.test.ts` 一条

**Interfaces:**
- Produces:
  - `export function shouldApplyGenerationPoll(opts: { nodeStatus: unknown; nodeRecordId: unknown; incomingRecordId: string; incomingStatus: string }): boolean`
  - 规则：
    1. 若 `nodeRecordId` 有值且 `!== incomingRecordId` → **false**（旧任务迟到）
    2. 若节点仍在 generating/pending/fallback_pending → **true**
    3. 若 `incomingStatus` 为终态（`completed|failed|error|fallback_pending`）且 `nodeRecordId === incomingRecordId` → **true**（覆盖节点已是 error 仍写回）
    4. 若节点为 `draft`（用户取消）→ **false**，除非需要保留现有 cancel 语义（取消后忽略迟到结果）

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { shouldApplyGenerationPoll } from './generationPollGate'

describe('shouldApplyGenerationPoll', () => {
  it('applies terminal result when node already error but same recordId', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'error',
        nodeRecordId: 'rec-1',
        incomingRecordId: 'rec-1',
        incomingStatus: 'failed',
      }),
    ).toBe(true)
  })

  it('ignores stale record when node tracks a newer id', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'generating',
        nodeRecordId: 'rec-2',
        incomingRecordId: 'rec-1',
        incomingStatus: 'completed',
      }),
    ).toBe(false)
  })

  it('ignores writes after cancel to draft', () => {
    expect(
      shouldApplyGenerationPoll({
        nodeStatus: 'draft',
        nodeRecordId: 'rec-1',
        incomingRecordId: 'rec-1',
        incomingStatus: 'completed',
      }),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationPollGate.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement gate + wire CanvasPage / useNodeGeneration**

实现 `shouldApplyGenerationPoll`。在 `CanvasPage` 的 `generationPolling` 回调中，将：

```ts
if (!acceptsPollWrite(node?.data?.status)) continue
```

改为基于 gate（传入 `node.data.generationRecordId` 与 `record.id/status`）。`acceptsPollWrite` 可保留给 shot/material 路径，或同样逐步迁移；**本期至少修复 studio generation 路径**。

`useNodeGeneration` 的 `acceptsGenerationWrite`：对「同一 `generationRecordId` 的终态 resolve」放宽，与 gate 一致（抽共享函数，避免双份逻辑）。

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/web exec vitest run src/utils/generationPollGate.test.ts src/composables/useNodeGeneration.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/utils/generationPollGate.ts apps/web/src/utils/generationPollGate.test.ts \
  apps/web/src/pages/CanvasPage.vue apps/web/src/composables/useNodeGeneration.ts
git commit -m "fix(web): 同 generationRecordId 的终态 poll 必须写回节点"
```

---

### Task 3: 任务面板 — 聚合列表、详情历史、任务 ID、Teleport 诊断、重试

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue`
- Modify: `apps/web/src/components/canvas/NodePanelDock.vue`（若需向上转发 `retry`）
- Modify: `apps/web/src/pages/CanvasPage.vue`（`handleHistoryLocate` 优先 `nodeId`；接 `history-retry`）
- Test: 逻辑已在 Task 1；本 Task 以手动验收 + 可选小组件测为主。可为 copy/group 视图加 `taskHistoryView.ts` 纯函数测「第 N 次」文案。

**Interfaces:**
- Consumes: `groupRecordsByNodeId`、`retryNodeGeneration`（经 emit）、`CANVAS_NODE_RETRY_KEY` 或 `emit('retry', nodeId)`
- Produces:
  - `emit('locate', { recordId: string; nodeId?: string | null })` 或保持 `recordId` 并在 CanvasPage 内用 records 反查 — **推荐** locate payload 带 `nodeId`
  - `emit('retry', nodeId: string)`

- [ ] **Step 1: 重构列表面板状态模型**

将 `detailRecord: GenerationRecord | null` 改为：

```ts
const detailNodeId = ref<string | null | undefined>(undefined)
// undefined = 列表；null = 孤儿组详情；string = 该节点详情
const expandedAttemptId = ref<string | null>(null) // 手风琴，默认 latest.id
```

`filteredGroups = computed(() => groupRecordsByNodeId(records).filter(...lifecycle/type))`  
生命周期分桶用 **`group.latest.status`**。

- [ ] **Step 2: 列表 UI**

每组一行：类型图标、`nodeId` 或「未关联」、最新状态徽章、`第 ${attemptCount} 次`、时间、失败时 `!` + 小「重试」。  
点击行 → `openGroupDetail(group)`。

- [ ] **Step 3: 详情 UI**

- 顶栏：返回、标题、最新状态；失败时「再试一次」→ `emit('retry', nodeId)`（无 nodeId 则 disable + 提示）
- 滚动列表：attempts 新→旧；每条含任务 ID + 复制按钮、状态、时间、摘要
- 点击展开手风琴：提示词、参数、失败原因、媒体；默认 `expandedAttemptId = latest.id`
- 进行中：沿用现有 4s `listGenerations` 轮询，详情内绑定同一 `records`

- [ ] **Step 4: 诊断 Teleport**

删除卡片内 `absolute` 包裹。改为：

```vue
<Teleport to="body">
  <div
    v-if="failurePopoverId"
    class="fixed z-[1000]"
    :style="failurePopoverStyle"
    @click.stop
  >
    <NodeDiagnosticPopover ... />
  </div>
</Teleport>
```

`openFailurePopover` 时用 `button.getBoundingClientRect()` 写入 `failurePopoverStyle`（`top/left`，并做视口边缘 clamp）。面板 `overflow` 不再裁切。

- [ ] **Step 5: Wire CanvasPage**

```ts
async function handleHistoryLocate(payload: string | { recordId: string; nodeId?: string | null }) {
  const recordId = typeof payload === 'string' ? payload : payload.recordId
  const nodeId = typeof payload === 'string' ? undefined : payload.nodeId
  const node =
    (nodeId && nodes.value.find((n) => n.id === nodeId)) ||
    nodes.value.find((n) => {
      const data = n.data as Record<string, unknown>
      return data.generationRecordId === recordId || data.materialId === recordId
    })
  // ... existing focus
}

function handleHistoryRetry(nodeId: string) {
  void retryNodeGeneration(nodeId)
}
```

模板：`@history-locate` / `@history-retry`。

- [ ] **Step 6: 手动冒烟 + Commit**

验收：同一节点失败再生成 → 列表一行「第 2 次」；详情可见两次且最新在上；复制任务 ID；点 `!` 弹层完整不被裁切；详情/列表重试触发新任务。

```bash
git add apps/web/src/components/canvas/CanvasTaskHistoryPanel.vue \
  apps/web/src/components/canvas/NodePanelDock.vue \
  apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): 任务面板按节点详情历史与诊断浮层"
```

---

### Task 4: 视频节点 drag / play 双模式

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasNodeVideo.vue`
- Optional CSS: `apps/web/src/styles/neo-node.css`（▶ 按钮样式）
- Test: 可抽 `resolveVideoInteractionMode` 若逻辑变复杂；否则组件手动验收

**Interfaces:**
- Produces: 组件内 `mode: 'drag' | 'play'`；`selected` 变 false 时重置为 `drag`

- [ ] **Step 1: 实现状态与模板分支**

```ts
import { ref, watch } from 'vue'
const mode = ref<'drag' | 'play'>('drag')

watch(
  () => props.selected,
  (sel) => {
    if (!sel) mode.value = 'drag'
  },
)

function enterPlay(e: Event) {
  e.stopPropagation()
  mode.value = 'play'
}
function exitPlay() {
  mode.value = 'drag'
}
```

模板（有 `data.url` 时）：

- `mode === 'drag'`：`<video :src muted playsinline preload="metadata" class="neo-gen-video-poster" />`（**无** `controls`，**无** `nodrag`）+ 居中 ▶ 按钮 `class="nodrag"` `@click.stop="enterPlay"`；`@dblclick.stop="enterPlay"` 在预览容器上
- `mode === 'play'`：`<video controls autoplay class="nodrag nowheel" />`；可选角标「退出」`@click.stop="exitPlay"`；`window` 监听 `keydown.Escape` → `exitPlay`

替换/下载/存库按钮保持 `nodrag` + stop。

- [ ] **Step 2: 手动验收**

- 有视频时拖节点边缘/画面可移动
- 点 ▶ 或双击可播放；Esc 退出
- 取消选中退出 play

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/canvas/CanvasNodeVideo.vue apps/web/src/styles/neo-node.css
git commit -m "feat(web): 视频节点默认拖拽、双击/播放按钮进入播放态"
```

---

### Task 5: 视频时长滑轨 UI

**Files:**
- Modify: `apps/web/src/components/canvas/VideoSettingsSelector.vue`
- Modify: `packages/shared/src/index.ts`（`VIDEO_DURATION_OPTIONS` 可保留刻度标记或改为 `VIDEO_DURATION_MARKS = [5,10,15]`）
- Test: Task 1 已覆盖 clamp/credits；本 Task 手动点选

- [ ] **Step 1: 替换时长三按钮为滑轨**

```vue
<div class="mb-3">
  <p class="mb-1.5 flex items-center justify-between text-[10px] text-[var(--neo-text-muted)]">
    <span>时长</span>
    <span class="tabular-nums text-[var(--neo-text-secondary)]">{{ modelValue.duration }}s</span>
  </p>
  <input
    type="range"
    min="5"
    max="15"
    step="1"
    class="w-full accent-[var(--neo-accent)]"
    :value="modelValue.duration"
    @input="patch({ duration: clampVideoDuration(($event.target as HTMLInputElement).value) })"
  />
  <div class="mt-1 flex justify-between text-[10px]">
    <button type="button" class="text-[var(--neo-text-muted)]" @click="patch({ duration: 5 })">5</button>
    <button type="button" class="font-semibold text-[var(--neo-accent-text)]" @click="patch({ duration: 10 })">10</button>
    <button type="button" class="font-semibold text-[var(--neo-accent-text)]" @click="patch({ duration: 15 })">15</button>
  </div>
</div>
```

从 `@lnkpi/shared` 引入 `clampVideoDuration`。打开面板时若 duration 越界先 clamp 一次。

- [ ] **Step 2: 确认 dock 积分预估**

`VideoDockPanel` 已用 `estimateVideoCredits(videoSettings.duration)` — 确认中间秒数显示正确。

- [ ] **Step 3: `pnpm --filter @lnkpi/shared build` + web 类型检查相关文件**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/canvas/VideoSettingsSelector.vue packages/shared/src/index.ts
git commit -m "feat(web): 视频时长改为 5–15 秒整数滑轨"
```

---

### Task 6: 画布 Undo / Redo 栈

**Files:**
- Create: `apps/web/src/composables/useCanvasUndoStack.ts`
- Create: `apps/web/src/composables/useCanvasUndoStack.test.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`（挂载快捷键、在 drag stop / 参数 patch 入栈）
- Modify: `apps/web/src/composables/useDebouncedNodePatch.ts`（若存在：支持 `skipHistory` 或对外暴露 commit 钩子）
- Test: `useCanvasUndoStack.test.ts`

**Interfaces:**
- Produces:

```ts
export type CanvasSnapshot = {
  nodes: EditableFlowNode[] // 深拷贝或结构化克隆可序列化子集
  edges: { id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }[]
}

export function useCanvasUndoStack(opts: {
  maxDepth?: number // default 50
  getSnapshot: () => CanvasSnapshot
  applySnapshot: (s: CanvasSnapshot) => void
}): {
  push: (label?: string) => void
  undo: () => boolean
  redo: () => boolean
  clear: () => void
  canUndo: Ref<boolean>
  canRedo: Ref<boolean>
}
```

规则：
- `push` 在「操作前」或「操作后」二选一，**全文件统一「操作后提交当前快照到 past，清空 future」**（常见做法：操作前记 before，更稳；实现时选一种并写进测试）
- **推荐：** `beginTransaction()` 记 before；`commitTransaction()` 若与 before 不同则入栈
- 生成结果 patch：`patchNodeData(id, patch, { skipHistory: true })` 或不走 transaction

- [ ] **Step 1: Write failing stack tests**

```ts
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { createCanvasUndoStack } from './useCanvasUndoStack' // 若导出纯函数工厂便于测

describe('canvas undo stack', () => {
  it('undo restores previous snapshot', () => {
    let current = { nodes: [{ id: 'a', position: { x: 0, y: 0 } }], edges: [] as never[] }
    const stack = createCanvasUndoStack({
      maxDepth: 3,
      getSnapshot: () => structuredClone(current),
      applySnapshot: (s) => {
        current = structuredClone(s)
      },
    })
    stack.commitAfterChange() // baseline optional
    current.nodes[0].position = { x: 10, y: 0 }
    stack.commitAfterChange()
    expect(stack.undo()).toBe(true)
    expect(current.nodes[0].position).toEqual({ x: 0, y: 0 })
    expect(stack.redo()).toBe(true)
    expect(current.nodes[0].position).toEqual({ x: 10, y: 0 })
  })

  it('caps depth at maxDepth', () => {
    // push 5 edits with maxDepth 3 → only 3 undos
  })
})
```

- [ ] **Step 2: Implement stack**

深拷贝用 `structuredClone`（注意 Vue proxy：`toRaw` + clone）。节点保留 `id/type/position/data` 必要字段。

- [ ] **Step 3: Wire CanvasPage**

- `onNodeDragStop`：commit
- 增删节点、连线完成：commit
- `useDebouncedNodePatch` / dock 改 prompt、settings：debounce 结束后 commit（仅 data 中允许字段变化时）
- `keydown`：若 `isEditableTarget(event.target)`（INPUT/TEXTAREA/contenteditable）→ return；否则 `meta/ctrl+Z` undo，`meta/ctrl+Shift+Z` 或 `ctrl+Y` redo；`preventDefault`
- undo/redo 后调用现有 `saveCanvas`

**跳过历史的 patch：** generationPolling、resolveStudioRecord、upload 进度等。

- [ ] **Step 4: Run tests + 手动验收**

Run: `pnpm --filter @lnkpi/web exec vitest run src/composables/useCanvasUndoStack.test.ts`  
手动：拖节点 → Z 回退；改时长 → Z 回退；生成失败后 Z **不应**清掉 error/url。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useCanvasUndoStack.ts \
  apps/web/src/composables/useCanvasUndoStack.test.ts \
  apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): 画布图操作与节点参数 Undo/Redo"
```

---

### Task 7: 回归、文档状态、PR

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-canvas-task-undo-video-ux-design.md`（状态已批准）
- 本 plan 勾选完成项

- [ ] **Step 1: 全量相关测试**

```bash
pnpm --filter @lnkpi/shared build
pnpm --filter @lnkpi/web exec vitest run \
  src/utils/taskHistoryGrouping.test.ts \
  src/utils/generationPollGate.test.ts \
  src/constants/credits.test.ts \
  src/composables/useCanvasUndoStack.test.ts \
  src/composables/useNodeGeneration.test.ts
pnpm build
```

Expected: 全绿

- [ ] **Step 2: 按 mydev-github-workflow 开 PR**

分支建议：`feature/canvas-task-undo-video-ux`  
PR 正文引用 spec + 本 plan；Test plan 勾选 spec 验收标准 1–7。

- [ ] **Step 3: CI 绿后 Squash 合并**

---

## Spec coverage checklist

| Spec § | Task |
|--------|------|
| 1 任务 ID | Task 3 |
| 2 Undo/Redo | Task 6 |
| 3 视频双模式 | Task 4 |
| 4 状态同步 | Task 2 |
| 5 聚合列表+详情历史+重试同逻辑 | Task 1 + 3 |
| 6 诊断 Teleport + 重试入口 | Task 3 |
| 7 时长滑轨+计费 | Task 1 + 5 |
| 验收标准 1–7 | Task 7 手动/自动 |

## Self-review notes

- 无 TBD 占位；locate/retry 的 emit 形状在 Task 3 写死
- `shouldApplyGenerationPoll` 与 `estimateVideoCredits` / `clampVideoDuration` 命名在后续 Task 一致引用
- composition 轨时长明确非目标，未列入 Task
