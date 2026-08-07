# Agent 侧栏 M3 — 显式引用、@ 语义与芯片交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Agent 侧栏引用改为显式加入芯片、芯片 hover 预览/click 插入 `@`、侧栏 `@` 补全，并将 `mentionedKeys` 贯通至 atomic/Campaign 生成 merge。

**Architecture:** 前端 `nodeToSidebarAttachment` + 画布右键/多选批量入口写入 `pendingAttachments`；`AgentSidebarRefChip` 负责 hover 浮层与 click mention；`MentionInput` 替换 plain textarea；发送时 `parseRefMentions` 产出 `mentionedKeys` 随 conversation API 进入 runtime state，在 atomic 建节点后写入 `node.data.mentionedKeys`，`startImageGeneration` 传给 `studio.generateImage`。废止 send 路径上的 `mergeFocusNodeRef`。**不含**画布节点拖拽进侧栏。

**Tech Stack:** Vue 3、NestJS、`@lnkpi/shared`、LangGraph Python 3.11+、Vitest、pytest

**Spec:** [docs/superpowers/specs/2026-08-07-agent-sidebar-m3-explicit-refs-design.md](../specs/2026-08-07-agent-sidebar-m3-explicit-refs-design.md)

## Global Constraints

- 复用 `LocalRefBinding` + `refOrder`；**不**新建侧栏持久化结构。
- 单轮 attachments ≤ **5**；拒绝 `blob:` URL。
- **废止** send 时 `mergeFocusNodeRef`；`focusNodeId` 仅指代，不自动进芯片。
- 芯片内 ref **默认全量**参与生成；`@` 仅产生 `mentionedKeys`（优先参考，非过滤）。
- 侧栏芯片：**hover 预览、click 插入 `@`**；**不修改** Dock `DockRefChip` 行为。
- M3 生成侧仍以 **T\*/I\*** 为主消费；V/A 芯片可展示，生成消费仍 P1。
- 侧栏文案禁止暴露 `localRefs`/`mentionedKeys` 等内部术语。
- Commit per task；PR 前：`pnpm --filter @lnkpi/shared build`、`pnpm --filter @lnkpi/web test`、`cd services/agent-runtime && python -m pytest tests/test_sidebar* tests/test_atomic* -v`。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/agentContract.ts` | `mentionedKeys` on conversation schema |
| `packages/shared/src/agentContract.test.ts` | **NEW/extend** — schema 单测 |
| `apps/web/src/composables/useSidebarAttachments.ts` | `nodeToSidebarAttachment`, `addFromCanvasNodes` |
| `apps/web/src/composables/useSidebarAttachments.test.ts` | 节点映射 + 批量 + 去重 |
| `apps/web/src/components/agent/AgentRefHoverPreview.vue` | **NEW** — hover 浮层预览 |
| `apps/web/src/components/agent/AgentSidebarRefChip.vue` | **NEW** — hover + click mention |
| `apps/web/src/components/agent/AgentRefStrip.vue` | 换 chip 组件；emit `mention` |
| `apps/web/src/components/agent/AgentSideRail.vue` | MentionInput；移除 silent merge；expose `addFromCanvasNodes` |
| `apps/web/src/components/canvas/CanvasContextMenu.vue` | 「加入 Agent 引用」菜单项 |
| `apps/web/src/pages/CanvasPage.vue` | 多选批量、context menu 接线（**无**节点 DnD） |
| `apps/server/src/agent/agent.controller.ts` | DTO `mentionedKeys` |
| `apps/server/src/agent/agent.service.ts` | 校验 + 转发 |
| `apps/server/src/agent/agent-runtime.client.ts` | body 字段 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `startImageGeneration` 读 `node.data.mentionedKeys` |
| `apps/server/src/agent/agent-canvas-tools.service.test.ts` | mentionedKeys 传入 studio |
| `services/agent-runtime/app/runs.py` | `sidebar_mentioned_keys` |
| `services/agent-runtime/app/graph/state.py` | state 字段 |
| `services/agent-runtime/app/graph/sidebar_attachments.py` | `normalize_mentioned_keys` |
| `services/agent-runtime/app/graph/nodes/atomic_create_node.py` | patch node mentionedKeys |
| `services/agent-runtime/tests/test_atomic_sidebar_refs.py` | mentionedKeys 写入 |
| `deploy/prod-sidebar-attachments-verify.py` | 更新：显式加入 + mentionedKeys 断言 |

---

### Task 1: Shared — `mentionedKeys` on conversation contract

**Files:**
- Modify: `packages/shared/src/agentContract.ts:557-569`
- Create or modify: `packages/shared/src/agentContract.test.ts`

**Interfaces:**
- Produces: `AgentConversationRequestSchema` 增量 `mentionedKeys?: string[]`（max 5，regex `/^[TIVA]\d+$/`）

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/agentContract.test.ts
import { describe, expect, it } from 'vitest'
import { AgentConversationRequestSchema } from './agentContract'

describe('AgentConversationRequestSchema mentionedKeys', () => {
  it('accepts valid mentionedKeys', () => {
    const parsed = AgentConversationRequestSchema.parse({
      sessionId: 's1',
      message: '@I1 风格',
      mentionedKeys: ['I1', 'T2'],
    })
    expect(parsed.mentionedKeys).toEqual(['I1', 'T2'])
  })

  it('rejects invalid ref key format', () => {
    expect(() =>
      AgentConversationRequestSchema.parse({
        sessionId: 's1',
        message: 'x',
        mentionedKeys: ['image1'],
      }),
    ).toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @lnkpi/shared test agentContract.test.ts`  
Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
// agentContract.ts — append to AgentConversationRequestSchema
mentionedKeys: z
  .array(z.string().regex(/^[TIVA]\d+$/i))
  .max(5)
  .optional(),
```

Export helper optional:

```typescript
export function normalizeMentionedKeys(keys?: string[]): string[] | undefined {
  if (!keys?.length) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of keys) {
    const upper = k.toUpperCase()
    if (seen.has(upper)) continue
    seen.add(upper)
    out.push(upper)
  }
  return out.length ? out : undefined
}
```

- [ ] **Step 4: Run test + build**

Run: `pnpm --filter @lnkpi/shared test agentContract.test.ts && pnpm --filter @lnkpi/shared build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/agentContract.ts packages/shared/src/agentContract.test.ts
git commit -m "feat(shared): add mentionedKeys to agent conversation contract"
```

---

### Task 2: Composable — 显式画布节点引用 + 修正 mediaType

**Files:**
- Modify: `apps/web/src/composables/useSidebarAttachments.ts`
- Modify: `apps/web/src/composables/useSidebarAttachments.test.ts`

**Interfaces:**
- Produces: `nodeToSidebarAttachment(node): SidebarAttachment | null`
- Produces: `addFromCanvasNode(node)`, `addFromCanvasNodes(nodes[])`
- **Removes usage** of `mergeFocusNodeRef` from send path (Task 5)；函数可保留供迁移测试或删除

- [ ] **Step 1: Write failing tests**

```typescript
// useSidebarAttachments.test.ts — append
import { nodeToSidebarAttachment } from './useSidebarAttachments'

describe('nodeToSidebarAttachment', () => {
  it('maps video node to V* mediaType', () => {
    const item = nodeToSidebarAttachment({
      id: 'v1',
      type: 'video',
      data: { url: 'https://cdn/x.mp4', title: 'demo' },
    })
    expect(item?.mediaType).toBe('video')
    expect(item?.sourceKind).toBe('canvasNode')
  })

  it('returns null when no url or text', () => {
    expect(nodeToSidebarAttachment({ id: 'e', type: 'image', data: {} })).toBeNull()
  })
})

describe('addFromCanvasNodes', () => {
  it('adds up to max and skips dup sourceNodeId', () => {
    const { addFromCanvasNodes, pendingAttachments } = useSidebarAttachments()
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      type: 'image' as const,
      data: { url: `https://cdn/${i}.jpg` },
    }))
    const added = addFromCanvasNodes(nodes)
    expect(added).toBe(5)
    expect(pendingAttachments.value).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Run — FAIL**

Run: `pnpm --filter @lnkpi/web test useSidebarAttachments.test.ts`

- [ ] **Step 3: Implement**

```typescript
export function nodeToSidebarAttachment(node: FocusNodeLike): SidebarAttachment | null {
  const data = node.data ?? {}
  const url = String(data.url ?? '').trim()
  const text = String(data.content ?? data.prompt ?? '').trim()
  if (!url && !text) return null

  const t = String(node.type ?? '')
  let mediaType: SidebarAttachment['mediaType'] = 'image'
  if (t === 'text' || t === 'prompt') mediaType = 'text'
  else if (t === 'video') mediaType = 'video'
  else if (t === 'audio') mediaType = 'audio'
  else if (t === 'image' || t === 'mediaInput') mediaType = 'image'
  else if (text && !url) mediaType = 'text'
  else if (!url) return null

  return {
    id: randomId(),
    mediaType,
    sourceKind: 'canvasNode',
    label: String(data.title ?? data.label ?? t || node.id),
    url: url || undefined,
    text: text || undefined,
    sourceNodeId: node.id,
  }
}

function addFromCanvasNode(node: FocusNodeLike): boolean {
  const item = nodeToSidebarAttachment(node)
  if (!item) return false
  if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) return false
  addFromPayload(item)
  return true
}

function addFromCanvasNodes(nodes: FocusNodeLike[]): number {
  let count = 0
  for (const n of nodes) {
    if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) break
    if (addFromCanvasNode(n)) count += 1
  }
  return count
}
```

Return `addFromCanvasNode`, `addFromCanvasNodes` from composable factory.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useSidebarAttachments.ts apps/web/src/composables/useSidebarAttachments.test.ts
git commit -m "feat(web): explicit canvas node to sidebar attachment mapping"
```

---

### Task 3: AgentRefHoverPreview + AgentSidebarRefChip

**Files:**
- Create: `apps/web/src/components/agent/AgentRefHoverPreview.vue`
- Create: `apps/web/src/components/agent/AgentSidebarRefChip.vue`
- Modify: `apps/web/src/components/agent/AgentRefStrip.vue`

**Interfaces:**
- Consumes: `NodeRef`（与 Dock 一致）
- Produces: `AgentSidebarRefChip` emit `mention: [refKey: string]`, `remove: []`
- Produces: hover 200ms 后显示 `AgentRefHoverPreview`；mouseleave 隐藏

- [ ] **Step 1: AgentRefHoverPreview.vue**

无 backdrop；`position: fixed`；内容区复用 DockRefPreview 的布局（图/文/视/音分支），props: `refItem`, `x`, `y`；`pointer-events: none` on root 或仅预览区可交互（视/音 controls 需 `pointer-events-auto`）。

- [ ] **Step 2: AgentSidebarRefChip.vue**

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'
// 复用 DockRefChip 的 thumbUrl / 样式结构，但：
// - @mouseenter (+200ms timer) → show hover preview
// - @mouseleave → hide
// - @click (非 remove) → emit('mention', refItem.refKey)
// - remove 按钮行为不变
const hoverTimer = ref<number | null>(null)
function onEnter(e: MouseEvent) {
  hoverTimer.value = window.setTimeout(() => { previewOpen.value = true; previewPos = ... }, 200)
}
function onClick(e: MouseEvent) {
  if (props.refItem.stale) return
  emit('mention', props.refItem.refKey)
}
</script>
```

- [ ] **Step 3: Wire AgentRefStrip**

Replace `DockRefChip` with `AgentSidebarRefChip`；forward `@mention`；只读模式 `:clickable="false"` 禁用 click mention。

- [ ] **Step 4: Manual check**

Dev：上传图 → hover 见预览浮层 → click 触发 emit（暂接 console）。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/agent/AgentRefHoverPreview.vue \
  apps/web/src/components/agent/AgentSidebarRefChip.vue \
  apps/web/src/components/agent/AgentRefStrip.vue
git commit -m "feat(web): agent sidebar ref chip hover preview and click mention"
```

---

### Task 4: AgentSideRail — MentionInput + 芯片 click 插入 + 去掉 silent merge

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Consumes: `MentionInput`, `parseRefMentions`, `normalizeMentionedKeys` from shared
- Consumes: `sidebar.addFromCanvasNodes` expose via `defineExpose`
- Produces: send body 含 `mentionedKeys`；**不再**调用 `mergeFocusNodeRef`

- [ ] **Step 1: Replace textarea with MentionInput**

```typescript
import MentionInput, { type MentionOption } from '@/components/canvas/MentionInput.vue'
import { parseRefMentions } from '@/composables/useRefMentions'
import { normalizeMentionedKeys } from '@lnkpi/shared'

const mentionOptions = computed((): MentionOption[] =>
  pendingAttachmentItems.value.map(({ refKey, attachment }) => ({
    id: attachment.id,
    label: refKey,
    type: attachment.mediaType,
  })),
)

function insertRefMention(refKey: string) {
  const el = composerRef.value // MentionInput 需 expose textarea ref 或通过 v-model 拼接
  const token = `@${refKey}`
  input.value = input.value ? `${input.value} ${token} ` : `${token} `
  nextTick(() => composerRef.value?.focus())
}
```

若 `MentionInput` 未 expose textarea，扩展其 `defineExpose({ focus, insertAtCursor(text) })` 或在 SideRail 用 v-model 拼接（最小改动优先 expose `insertText`）。

- [ ] **Step 2: AgentRefStrip @mention handler**

```vue
<AgentRefStrip ... @mention="insertRefMention" />
```

- [ ] **Step 3: Fix sendMessage**

```typescript
// REMOVE:
// const attachments = mergeFocusNodeRef(pendingAttachments, props.selectedNode ?? null)

// USE:
const { attachments: pendingAttachments } = sidebar.toPayload()
const attachments = pendingAttachments
const mentionedKeys = normalizeMentionedKeys(parseRefMentions(message))

body: JSON.stringify({
  ...
  attachments: attachments.length ? attachments : undefined,
  refOrder: attachments.length ? attachments.map(a => a.id) : undefined,
  mentionedKeys,
})
```

- [ ] **Step 4: defineExpose for canvas**

```typescript
defineExpose({
  addFromCanvasNodes: (nodes: FocusNodeLike[]) => {
    const n = sidebar.addFromCanvasNodes(nodes)
    if (n < nodes.length) ElMessage.warning(`最多添加 ${SIDEBAR_ATTACHMENT_MAX} 个参考素材`)
    return n
  },
})
```

- [ ] **Step 5: Manual smoke**

1. 选中节点不发引用 → 无 localRefs  
2. 手动加芯片 → click 芯片 → 输入框有 `@I1`  
3. 打 `@I` → 补全列表

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/agent/AgentSideRail.vue apps/web/src/components/canvas/MentionInput.vue
git commit -m "feat(web): agent sidebar mention input and remove silent focus merge"
```

---

### Task 5: Canvas — 显式加入入口（右键 + 多选）

**Files:**
- Modify: `apps/web/src/components/canvas/CanvasContextMenu.vue`
- Modify: `apps/web/src/pages/CanvasPage.vue`

**Interfaces:**
- Consumes: `agentRailRef.addFromCanvasNodes`
- Produces: context menu action `add-agent-ref`；多选工具栏批量加入

**Out of scope:** 画布节点拖拽到侧栏（用户确认不做）。

- [ ] **Step 1: Context menu item**

```vue
<!-- CanvasContextMenu.vue — 在 duplicate 前插入 -->
<button
  v-if="nodeId && nodeType !== 'group'"
  class="neo-popover-item block w-full px-4 py-2 text-left text-xs"
  @click="run('add-agent-ref')"
>
  加入 Agent 引用
</button>
```

- [ ] **Step 2: CanvasPage handle context action**

```typescript
function onContextMenuAction(action: string) {
  if (action === 'add-agent-ref') {
    const ids = multiSelectedIds.value.length ? multiSelectedIds.value : selectedNodeId.value ? [selectedNodeId.value] : []
    const nodes = ids.map(id => findNodeById(id)).filter(Boolean)
    agentRailRef.value?.addFromCanvasNodes(nodes)
    return
  }
  // ...existing
}
```

- [ ] **Step 3: Multi-select toolbar button（可选但推荐）**

当选中 ≥2 节点时在画布工具栏或 selection bar 增加「加入 Agent 引用」（与现有「建组」并列）。

- [ ] **Step 4: Manual smoke**

右键单节点、框选 3 节点批量 — 均出现在芯片条。

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/canvas/CanvasContextMenu.vue apps/web/src/pages/CanvasPage.vue
git commit -m "feat(web): explicit add canvas nodes to agent sidebar refs"
```

---

### Task 6: API — Nest + Runtime `mentionedKeys` 管道

**Files:**
- Modify: `apps/server/src/agent/agent.controller.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts`
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/app/graph/sidebar_attachments.py`
- Create or extend: `services/agent-runtime/tests/test_sidebar_attachments.py`

**Interfaces:**
- Produces: state `sidebar_mentioned_keys: list[str] | None`
- Produces: `normalize_mentioned_keys(raw) -> list[str]`

- [ ] **Step 1: Python failing test**

```python
def test_normalize_mentioned_keys():
    from app.graph.sidebar_attachments import normalize_mentioned_keys
    assert normalize_mentioned_keys(["i1", "I1", "T2"]) == ["I1", "T2"]
    assert normalize_mentioned_keys(None) == []
```

- [ ] **Step 2: Implement normalize + wire runs.py / state.py**

Mirror `sidebar_attachments` pattern; Nest DTO + service forward.

- [ ] **Step 3: Run pytest — PASS**

Run: `cd services/agent-runtime && python -m pytest tests/test_sidebar_attachments.py -v`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): pipe sidebar mentionedKeys through conversation API"
```

---

### Task 7: 生成贯通 — node.data.mentionedKeys + startImageGeneration

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/atomic_create_node.py`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-canvas-tools.service.test.ts`
- Extend: `services/agent-runtime/tests/test_atomic_sidebar_refs.py`

**Interfaces:**
- Consumes: `state.sidebar_mentioned_keys`
- Produces: `update_node` action with `data: { mentionedKeys }` on atomic targets
- Produces: `startImageGeneration` passes keys to `studio.generateImage`

- [ ] **Step 1: Failing Nest test**

```typescript
it('startImageGeneration passes node.data.mentionedKeys to studio', async () => {
  // node with mentionedKeys: ['I1','T1']
  // assert studio.generateImage called with mentionedKeys
})
```

- [ ] **Step 2: atomic_create_node patch**

After `apply_sidebar_attachments`, if `sidebar_mentioned_keys`:

```python
keys = state.get("sidebar_mentioned_keys") or []
if keys:
    await nest.update_nodes_batch([
        {"nodeId": nid, "patch": {"mentionedKeys": keys}}
        for nid in node_ids
    ])
```

（或使用现有 persist update_node batch API。）

- [ ] **Step 3: startImageGeneration**

```typescript
const mentionedKeys = Array.isArray(node.data?.mentionedKeys)
  ? (node.data.mentionedKeys as string[])
  : undefined
const record = await this.studio.generateImage(
  input.userId,
  imagePrompt,
  model,
  aspectRatio,
  refs,
  mentionedKeys?.length ? mentionedKeys : undefined,
  resolution,
  count,
  { sessionId: input.sessionId, nodeId: input.nodeId },
)
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lnkpi/server test agent-canvas-tools.service.test.ts`  
Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_sidebar_refs.py -v`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): apply sidebar mentionedKeys to atomic image generation"
```

---

### Task 8: 冒烟脚本 + 回归

**Files:**
- Modify: `deploy/prod-sidebar-attachments-verify.py`
- Modify: `apps/web/src/composables/useSidebarAttachments.test.ts`（删除/更新 mergeFocusNodeRef send 相关用例若需）

- [ ] **Step 1: Update verify script**

- 移除「仅 focusNodeId 即 ref」断言  
- 增加：payload 含 `mentionedKeys: ['I1']` 时 node.data.mentionedKeys 或 merge log  
- Campaign plan 关键词断言放宽（既有误报）

- [ ] **Step 2: Run local/staging**

Run: `python deploy/prod-sidebar-attachments-verify.py`

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-sidebar-attachments-verify.py
git commit -m "test(deploy): update sidebar M3 explicit refs verify"
```

---

## M3 backlog（本计划不阻塞 M3a–c）

| 项 | 说明 |
| --- | --- |
| 芯片拖拽排序 | refOrder 手动调整 |
| 粘贴板截图 | paste → addFromFile |
| V/A 生成消费 | studio 路径扩展 |
| 设置项「选中自动加入引用」 | 默认关 |
| Campaign text merge mentionedKeys | 若 text gen 走 mergeRefs |

---

## Spec self-review

| Spec 章节 | Task |
| --- | --- |
| D-A 废止 silent merge | 4, 5 |
| D-B focus 解耦 | 4 |
| D-C @ 语义 | 1, 4, 6, 7 |
| D-D 多选显式 | 2, 5 |
| D-E hover/click 芯片 | 3, 4 |
| D-F MentionInput | 4 |
| §3 节点映射 | 2 |
| §4 API mentionedKeys | 1, 6, 7 |
| §7 测试要点 | 8 |

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-agent-sidebar-m3-explicit-refs.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派发独立 subagent，Task 间 review  
2. **Inline Execution** — 本会话按 Task 顺序实现，checkpoint 处暂停 review  

**Which approach?**
