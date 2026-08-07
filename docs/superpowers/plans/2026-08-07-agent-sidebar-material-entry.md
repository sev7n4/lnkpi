# Agent 侧栏素材引用入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Agent 侧栏增加素材上传/选取入口，经统一 Ref 模型贯通 atomic 生图（localRefs + img2img）与 Campaign 编排（attach_edges）两条路径。

**Architecture:** 侧栏维护会话级 `pendingAttachments`，发送时随 `POST /api/agent/chat/conversation` 传给 runtime；Nest 提供 `applySidebarAttachments` 写画布 SoT；atomic 在 `create_atomic_node` 后写 `localRefs`，Campaign 在 `split` 后为附件建 mediaInput 节点并 `attach_refs` 连主图；生成层复用现有 `toStudioRefs` → img2img，provider 零改动。

**Tech Stack:** Vue 3 + Pinia（web）、NestJS + `@lnkpi/shared`（server）、LangGraph Python 3.11+ + pytest（agent-runtime）

**Spec:** [docs/superpowers/specs/2026-08-07-agent-sidebar-material-entry-design.md](../specs/2026-08-07-agent-sidebar-material-entry-design.md)

## Global Constraints

- 复用 `LocalRefBinding` + `refOrder` + `resolveNodeRefs`；**不**新建侧栏专用持久化结构。
- 单轮 attachments ≤ **5**；每项必有 `url` 或 `text`；**拒绝** `blob:` URL。
- M1/M2 生成侧仅消费 **T\*/I\***；V/A 芯片可展示，生成不消费。
- atomic 多 batch **全员共享**同一组 attachments；Campaign 默认 **attach_edges**，无目标时 fallback **localRefs**。
- user 气泡附件条 **永久保留**（只读）；发送后清空 `pendingAttachments`。
- 侧栏文案遵循 [agent-sidebar-copy-design](../specs/2026-08-06-agent-sidebar-copy-design.md)；禁止暴露 `localRefs`/`attach_refs` 等内部术语。
- readOnly 画布禁止上传；无 attachments 时行为与现网 **完全一致**（回归必测）。
- Commit per task；PR 前跑：`pnpm --filter @lnkpi/shared build`、`cd services/agent-runtime && python -m pytest tests/test_sidebar_attachments*.py tests/test_atomic*.py -v`。

## File map

| File | Role |
| --- | --- |
| `packages/shared/src/sidebarAttachments.ts` | **NEW** — `SidebarAttachment` 类型 + Zod schema |
| `packages/shared/src/agentContract.ts` | 扩展 conversation 请求 schema |
| `packages/shared/src/sidebarAttachments.test.ts` | **NEW** — schema 单测 |
| `apps/server/src/agent/agent.controller.ts` | `ConversationDto.attachments` |
| `apps/server/src/agent/agent.service.ts` | 转发 attachments 至 runtime |
| `apps/server/src/agent/agent-runtime.client.ts` | `attachments` / `refOrder` body 字段 |
| `apps/server/src/agent/agent-canvas-tools.service.ts` | `applySidebarAttachments()` |
| `apps/server/src/agent/agent-canvas-tools.sidebar.test.ts` | **NEW** — Nest apply 单测 |
| `apps/server/src/agent/agent-internal.controller.ts` | internal route（若尚无则追加） |
| `services/agent-runtime/app/runs.py` | `RunRequest.sidebar_attachments` |
| `services/agent-runtime/app/graph/state.py` | state 字段 |
| `services/agent-runtime/app/graph/sidebar_attachments.py` | **NEW** — 校验 + 归一化 |
| `services/agent-runtime/app/tools/nest_client.py` | `apply_sidebar_attachments()` |
| `services/agent-runtime/app/graph/nodes/atomic_create_node.py` | 建节点后 apply localRefs |
| `services/agent-runtime/app/graph/nodes/apply_sidebar_refs.py` | **NEW** — Campaign IO 节点 |
| `services/agent-runtime/app/graph/builder.py` | Campaign split 后路由 |
| `services/agent-runtime/app/graph/sidebar_copy.py` | 带附件 parse 文案 |
| `services/agent-runtime/tests/test_sidebar_attachments.py` | **NEW** — 校验单测 |
| `services/agent-runtime/tests/test_atomic_sidebar_refs.py` | **NEW** — atomic apply 集成测 |
| `services/agent-runtime/tests/test_campaign_sidebar_refs.py` | **NEW** — Campaign apply 集成测 |
| `apps/web/src/composables/useSidebarAttachments.ts` | **NEW** — pending 状态、上传、去重 |
| `apps/web/src/composables/useSidebarAttachments.test.ts` | **NEW** — composable 单测 |
| `apps/web/src/components/agent/AgentRefStrip.vue` | **NEW** — 引用芯片条 |
| `apps/web/src/components/agent/AgentAssetPicker.vue` | **NEW** — 资产库弹层（M2） |
| `apps/web/src/components/agent/AgentSideRail.vue` | 上传、drop、send body、附件展示 |
| `apps/web/src/stores/agent.ts` | user 消息 `attachments` 字段 |
| `deploy/prod-sidebar-attachments-verify.py` | **NEW** — 冒烟脚本 |

---

### Task 1: Shared contract — SidebarAttachment

**Files:**
- Create: `packages/shared/src/sidebarAttachments.ts`
- Create: `packages/shared/src/sidebarAttachments.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/agentContract.ts`

**Interfaces:**
- Produces: `SidebarAttachmentSchema`, `SidebarAttachment`, `SIDEBAR_ATTACHMENT_MAX = 5`
- Produces: `ConversationRequestSchema` 增量字段 `attachments?`, `refOrder?`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/shared/src/sidebarAttachments.test.ts
import { describe, expect, it } from 'vitest'
import {
  SidebarAttachmentSchema,
  validateSidebarAttachments,
  SIDEBAR_ATTACHMENT_MAX,
} from './sidebarAttachments'

describe('SidebarAttachmentSchema', () => {
  it('accepts image upload', () => {
    const parsed = SidebarAttachmentSchema.parse({
      id: 'a1',
      mediaType: 'image',
      sourceKind: 'upload',
      label: 'product.jpg',
      url: 'https://cdn.example.com/a.jpg',
    })
    expect(parsed.mediaType).toBe('image')
  })

  it('rejects blob url', () => {
    expect(() =>
      validateSidebarAttachments([
        {
          id: 'a1',
          mediaType: 'image',
          sourceKind: 'upload',
          label: 'x',
          url: 'blob:http://localhost/abc',
        },
      ]),
    ).toThrow(/blob/)
  })

  it('rejects more than max', () => {
    const items = Array.from({ length: SIDEBAR_ATTACHMENT_MAX + 1 }, (_, i) => ({
      id: `a${i}`,
      mediaType: 'image' as const,
      sourceKind: 'upload' as const,
      label: 'x',
      url: `https://cdn.example.com/${i}.jpg`,
    }))
    expect(() => validateSidebarAttachments(items)).toThrow(/最多/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/shared test sidebarAttachments.test.ts`  
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/shared/src/sidebarAttachments.ts
import { z } from 'zod'
import type { RefMediaType } from './nodeRefs'

export const SIDEBAR_ATTACHMENT_MAX = 5

export const SidebarAttachmentSchema = z.object({
  id: z.string().min(1),
  mediaType: z.enum(['text', 'image', 'video', 'audio']),
  sourceKind: z.enum(['upload', 'asset', 'canvasNode']),
  label: z.string().min(1),
  url: z.string().optional(),
  text: z.string().optional(),
  sourceNodeId: z.string().optional(),
})

export type SidebarAttachment = z.infer<typeof SidebarAttachmentSchema>

export function validateSidebarAttachments(items: SidebarAttachment[]): SidebarAttachment[] {
  if (items.length > SIDEBAR_ATTACHMENT_MAX) {
    throw new Error(`最多添加 ${SIDEBAR_ATTACHMENT_MAX} 个参考素材`)
  }
  const parsed = items.map((item) => SidebarAttachmentSchema.parse(item))
  for (const item of parsed) {
    if (!item.url?.trim() && !item.text?.trim()) {
      throw new Error('参考素材缺少 url 或 text')
    }
    if (item.url?.startsWith('blob:')) {
      throw new Error('blob URL 不允许作为参考素材')
    }
  }
  return parsed
}
```

In `agentContract.ts` append to conversation request (或新建 `AgentConversationRequestSchema` 若已有则扩展):

```typescript
import { SidebarAttachmentSchema } from './sidebarAttachments'

// 在现有 conversation body schema 中增加：
attachments: z.array(SidebarAttachmentSchema).max(5).optional(),
refOrder: z.array(z.string()).optional(),
```

Export from `index.ts`: `export * from './sidebarAttachments'`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/shared test sidebarAttachments.test.ts && pnpm --filter @lnkpi/shared build`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/sidebarAttachments.ts packages/shared/src/sidebarAttachments.test.ts \
  packages/shared/src/agentContract.ts packages/shared/src/index.ts
git commit -m "feat(shared): add SidebarAttachment contract for agent sidebar refs"
```

---

### Task 2: Nest — applySidebarAttachments (localRefs mode)

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`
- Modify: `apps/server/src/agent/agent-internal.controller.ts`（或现有 internal routes 文件）
- Create: `apps/server/src/agent/agent-canvas-tools.sidebar.test.ts`

**Interfaces:**
- Consumes: `SidebarAttachment[]` from Task 1
- Produces: `applySidebarAttachments(input: { sessionId, nodeIds, attachments, refOrder, mode: 'localRefs' | 'attach_edges' }): Promise<{ actions: CanvasAction[]; sourceNodeIds?: string[] }>`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/server/src/agent/agent-canvas-tools.sidebar.test.ts
import { AgentCanvasToolsService } from './agent-canvas-tools.service'

describe('applySidebarAttachments localRefs', () => {
  it('writes localRefs and refOrder to target nodes', async () => {
    // mock loadSession/persist; assert update_node actions contain localRefs
    // 参照 agent-canvas-tools 现有 test 模式 setup mock SessionsService
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/server test agent-canvas-tools.sidebar.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

在 `agent-canvas-tools.service.ts` 新增：

```typescript
async applySidebarAttachments(input: {
  sessionId: string
  nodeIds: string[]
  attachments: SidebarAttachment[]
  refOrder?: string[]
  mode: 'localRefs' | 'attach_edges'
}): Promise<{ actions: CanvasAction[]; sourceNodeIds: string[] }> {
  validateSidebarAttachments(input.attachments)
  const order = input.refOrder?.length
    ? input.refOrder
    : input.attachments.map((a) => a.id)

  if (input.mode === 'localRefs') {
    const localRefs: LocalRefBinding[] = input.attachments
      .filter((a) => a.sourceKind !== 'canvasNode')
      .map((a) => ({
        id: a.id,
        mediaType: a.mediaType,
        sourceKind: a.sourceKind === 'asset' ? 'asset' : 'upload',
        label: a.label,
        url: a.url,
        text: a.text,
      }))
    const actions: CanvasAction[] = input.nodeIds.map((nodeId) => ({
      type: 'update_node',
      payload: { id: nodeId, data: { localRefs, refOrder: order } },
    }))
    await this.persist(input.sessionId, actions)
    return { actions, sourceNodeIds: [] }
  }

  // attach_edges mode — Task 8 完整实现；此处 stub 返回空
  return { actions: [], sourceNodeIds: [] }
}
```

Internal route: `POST /agent/internal/apply-sidebar-attachments`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/server test agent-canvas-tools.sidebar.test.ts`  
Expected: PASS (localRefs case)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.ts \
  apps/server/src/agent/agent-internal.controller.ts \
  apps/server/src/agent/agent-canvas-tools.sidebar.test.ts
git commit -m "feat(server): applySidebarAttachments localRefs mode"
```

---

### Task 3: API 贯通 — Nest → Runtime

**Files:**
- Modify: `apps/server/src/agent/agent.controller.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts`
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `services/agent-runtime/app/graph/state.py`
- Create: `services/agent-runtime/app/graph/sidebar_attachments.py`
- Create: `services/agent-runtime/tests/test_sidebar_attachments.py`

**Interfaces:**
- Consumes: `SidebarAttachment[]` from Task 1
- Produces: LangGraph state keys `sidebar_attachments: list[dict]`, `sidebar_ref_order: list[str]`
- Produces: `normalize_sidebar_attachments(raw) -> list[dict]`（校验入口）

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_sidebar_attachments.py
from app.graph.sidebar_attachments import normalize_sidebar_attachments


def test_normalize_accepts_image():
    out = normalize_sidebar_attachments([
        {"id": "a1", "mediaType": "image", "sourceKind": "upload",
         "label": "p.jpg", "url": "https://x/a.jpg"}
    ])
    assert len(out) == 1


def test_normalize_rejects_blob():
    try:
        normalize_sidebar_attachments([
            {"id": "a1", "mediaType": "image", "sourceKind": "upload",
             "label": "x", "url": "blob:http://localhost/x"}
        ])
        assert False, "expected error"
    except ValueError as e:
        assert "blob" in str(e).lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_sidebar_attachments.py -v`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`agent.controller.ts` — 在 `ConversationDto` 增加：

```typescript
@IsOptional()
@ValidateNested({ each: true })
@Type(() => SidebarAttachmentDto)
attachments?: SidebarAttachmentDto[]

@IsOptional()
@IsArray()
@IsString({ each: true })
refOrder?: string[]
```

`agent-runtime.client.ts` body 增加 `attachments`, `ref_order`.

`runs.py` `RunRequest`:

```python
sidebar_attachments: list[dict[str, Any]] | None = None
sidebar_ref_order: list[str] | None = None
```

`stream_run_events` input dict 增加：

```python
"sidebar_attachments": req.sidebar_attachments,
"sidebar_ref_order": req.sidebar_ref_order,
```

`state.py` `AgentRuntimeState` 增加同名字段（非 reducer，每 turn 覆盖）。

`sidebar_attachments.py`:

```python
MAX_SIDEBAR_ATTACHMENTS = 5

def normalize_sidebar_attachments(raw: list[dict] | None) -> list[dict]:
    if not raw:
        return []
    if len(raw) > MAX_SIDEBAR_ATTACHMENTS:
        raise ValueError(f"最多 {MAX_SIDEBAR_ATTACHMENTS} 个参考素材")
    out: list[dict] = []
    for item in raw:
        url = str(item.get("url") or "").strip()
        text = str(item.get("text") or "").strip()
        if url.startswith("blob:"):
            raise ValueError("blob URL 不允许")
        if not url and not text:
            raise ValueError("参考素材缺少 url 或 text")
        out.append(dict(item))
    return out
```

Nest `agent.service.ts` 在转发前调用 `validateSidebarAttachments`（shared）。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && python -m pytest tests/test_sidebar_attachments.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent.controller.ts apps/server/src/agent/agent.service.ts \
  apps/server/src/agent/agent-runtime.client.ts \
  services/agent-runtime/app/runs.py services/agent-runtime/app/graph/state.py \
  services/agent-runtime/app/graph/sidebar_attachments.py \
  services/agent-runtime/tests/test_sidebar_attachments.py
git commit -m "feat(agent): pipe sidebar attachments through conversation API"
```

---

### Task 4: Atomic — create 后写 localRefs

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/atomic_create_node.py`
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Create: `services/agent-runtime/tests/test_atomic_sidebar_refs.py`

**Interfaces:**
- Consumes: state `sidebar_attachments`, `sidebar_ref_order`; nest `apply_sidebar_attachments`
- Produces: 每个 `atomic_items[].node_id` 写入相同 localRefs

- [ ] **Step 1: Write the failing test**

```python
# services/agent-runtime/tests/test_atomic_sidebar_refs.py
import pytest
from app.graph.nodes.atomic_create_node import make_create_atomic_node


@pytest.mark.asyncio
async def test_create_atomic_applies_sidebar_attachments():
    calls: list[tuple] = []

    class Nest:
        async def add_nodes_batch(self, items):
            return {"nodes": [{"key": items[0]["key"], "nodeId": "n1"}]}

        async def apply_sidebar_attachments(self, **kwargs):
            calls.append(kwargs)
            return {"actions": []}

        async def emit_task_list(self, tasks):
            pass

    node_fn = make_create_atomic_node(nest=Nest())
    state = {
        "atomic_items": [{"target_type": "image", "prompt": "三视图", "title": "三视图"}],
        "sidebar_attachments": [
            {"id": "a1", "mediaType": "image", "sourceKind": "upload",
             "label": "p.jpg", "url": "https://x/a.jpg"}
        ],
        "sidebar_ref_order": ["a1"],
    }
    out = await node_fn(state)
    assert out.get("phase") != "error"
    assert calls
    assert calls[0]["node_ids"] == ["n1"]
    assert calls[0]["mode"] == "localRefs"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_sidebar_refs.py -v`  
Expected: FAIL — no apply call

- [ ] **Step 3: Write minimal implementation**

`nest_client.py`:

```python
async def apply_sidebar_attachments(
    self,
    *,
    node_ids: list[str],
    attachments: list[dict],
    ref_order: list[str] | None,
    mode: str,
) -> dict[str, Any]:
    body = {
        "sessionId": self._session_id,
        "nodeIds": node_ids,
        "attachments": attachments,
        "refOrder": ref_order or [],
        "mode": mode,
    }
    return await self._post("/agent/internal/apply-sidebar-attachments", body)
```

`atomic_create_node.py` — `add_nodes_batch` 成功后：

```python
attachments = state.get("sidebar_attachments") or []
if attachments:
    node_ids = [str(i.get("node_id") or "") for i in created if i.get("node_id")]
    apply_fn = getattr(nest, "apply_sidebar_attachments", None)
    if apply_fn and node_ids:
        await apply_fn(
            node_ids=node_ids,
            attachments=attachments,
            ref_order=state.get("sidebar_ref_order"),
            mode="localRefs",
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && python -m pytest tests/test_atomic_sidebar_refs.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/atomic_create_node.py \
  services/agent-runtime/app/tools/nest_client.py \
  services/agent-runtime/tests/test_atomic_sidebar_refs.py
git commit -m "feat(agent): apply sidebar attachments on atomic_create"
```

---

### Task 5: Frontend composable — useSidebarAttachments

**Files:**
- Create: `apps/web/src/composables/useSidebarAttachments.ts`
- Create: `apps/web/src/composables/useSidebarAttachments.test.ts`

**Interfaces:**
- Produces: `{ pendingAttachments, refOrder, addFromFile, addFromAsset, remove, clear, toPayload, assignRefKeys }`
- Consumes: `persistMediaUrl` / `fileToPersistedPayload` from `useMediaUpload`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/composables/useSidebarAttachments.test.ts
import { describe, expect, it } from 'vitest'
import { useSidebarAttachments } from './useSidebarAttachments'

describe('useSidebarAttachments', () => {
  it('dedupes by url', () => {
    const { addFromPayload, pendingAttachments } = useSidebarAttachments()
    addFromPayload({ id: '1', mediaType: 'image', sourceKind: 'upload', label: 'a', url: 'https://x/1.jpg' })
    addFromPayload({ id: '2', mediaType: 'image', sourceKind: 'upload', label: 'b', url: 'https://x/1.jpg' })
    expect(pendingAttachments.value).toHaveLength(1)
  })

  it('assigns ref keys I1 T1', () => {
    const { addFromPayload, assignRefKeys } = useSidebarAttachments()
    addFromPayload({ id: '1', mediaType: 'image', sourceKind: 'upload', label: 'a', url: 'https://x/1.jpg' })
    addFromPayload({ id: '2', mediaType: 'text', sourceKind: 'upload', label: 'b', text: '卖点' })
    const keys = assignRefKeys()
    expect(keys).toEqual(['I1', 'T1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/web test useSidebarAttachments.test.ts`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/web/src/composables/useSidebarAttachments.ts
import { ref, computed } from 'vue'
import type { SidebarAttachment } from '@lnkpi/shared'
import { SIDEBAR_ATTACHMENT_MAX } from '@lnkpi/shared'
import { fileToPersistedPayload } from '@/composables/useMediaUpload'

const REF_PREFIX = { text: 'T', image: 'I', video: 'V', audio: 'A' } as const

export function useSidebarAttachments() {
  const pendingAttachments = ref<SidebarAttachment[]>([])
  const refOrder = computed(() => pendingAttachments.value.map((a) => a.id))

  function addFromPayload(item: SidebarAttachment) {
    if (pendingAttachments.value.length >= SIDEBAR_ATTACHMENT_MAX) return
    const dup = pendingAttachments.value.some(
      (a) => (item.url && a.url === item.url) || (item.sourceNodeId && a.sourceNodeId === item.sourceNodeId),
    )
    if (dup) return
    pendingAttachments.value = [...pendingAttachments.value, item]
  }

  async function addFromFile(file: File) {
    const payload = await fileToPersistedPayload(file)
    if (payload.url.startsWith('blob:')) throw new Error('请先完成上传')
    const mediaType = payload.kind === 'text' ? 'text' : payload.kind === 'video' ? 'video' : payload.kind === 'audio' ? 'audio' : 'image'
    addFromPayload({
      id: crypto.randomUUID(),
      mediaType,
      sourceKind: 'upload',
      label: payload.fileName,
      url: mediaType !== 'text' ? payload.url : undefined,
      text: mediaType === 'text' ? payload.textContent : undefined,
    })
  }

  function remove(id: string) {
    pendingAttachments.value = pendingAttachments.value.filter((a) => a.id !== id)
  }

  function clear() {
    pendingAttachments.value = []
  }

  function assignRefKeys(): string[] {
    const counters = { text: 0, image: 0, video: 0, audio: 0 }
    return pendingAttachments.value.map((a) => {
      counters[a.mediaType] += 1
      return `${REF_PREFIX[a.mediaType]}${counters[a.mediaType]}`
    })
  }

  function toPayload() {
    return { attachments: [...pendingAttachments.value], refOrder: refOrder.value }
  }

  return { pendingAttachments, refOrder, addFromFile, addFromPayload, remove, clear, toPayload, assignRefKeys }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lnkpi/web test useSidebarAttachments.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/composables/useSidebarAttachments.ts apps/web/src/composables/useSidebarAttachments.test.ts
git commit -m "feat(web): add useSidebarAttachments composable"
```

---

### Task 6: AgentRefStrip UI

**Files:**
- Create: `apps/web/src/components/agent/AgentRefStrip.vue`

**Interfaces:**
- Consumes: `SidebarAttachment[]` + `refKeys: string[]` from composable
- Produces: Vue component with remove/preview events

- [ ] **Step 1: Scaffold component**

复用 `DockRefChip` 样式；props: `items: Array<{ attachment: SidebarAttachment; refKey: string }>`；emit `remove(id)`.

```vue
<!-- apps/web/src/components/agent/AgentRefStrip.vue -->
<script setup lang="ts">
import type { SidebarAttachment } from '@lnkpi/shared'
import DockRefChip from '@/components/canvas/dock-studio/shared/DockRefChip.vue'
import { computed } from 'vue'
import type { NodeRef } from '@/composables/useNodeRefs'

const props = defineProps<{
  items: Array<{ attachment: SidebarAttachment; refKey: string }>
}>()
const emit = defineEmits<{ remove: [id: string] }>()

const refs = computed<NodeRef[]>(() =>
  props.items.map(({ attachment, refKey }) => ({
    refId: attachment.id,
    refKey,
    mediaType: attachment.mediaType,
    sourceKind: attachment.sourceKind === 'canvasNode' ? 'edge' : attachment.sourceKind,
    label: attachment.label,
    preview: attachment.url ?? attachment.text ?? '',
    payload: { url: attachment.url, text: attachment.text },
  })),
)
</script>

<template>
  <div v-if="refs.length" class="agent-ref-strip">
    <DockRefChip
      v-for="refItem in refs"
      :key="refItem.refId"
      :ref-item="refItem"
      @remove="emit('remove', refItem.refId)"
    />
  </div>
</template>
```

- [ ] **Step 2: Visual check in dev**

Run: `pnpm --filter @lnkpi/web dev` — 临时在 AgentSideRail 挂载空 strip 确认样式不溢出。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/agent/AgentRefStrip.vue
git commit -m "feat(web): add AgentRefStrip for sidebar reference chips"
```

---

### Task 7: AgentSideRail — 上传、拖拽、发送（M1 核心）

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/stores/agent.ts`

**Interfaces:**
- Consumes: `useSidebarAttachments`, `AgentRefStrip`
- Produces: `sendMessage` body 含 `attachments` + `refOrder`；user 消息含 attachments 快照

- [ ] **Step 1: Extend agent store user message**

```typescript
// apps/web/src/stores/agent.ts
export interface AgentStreamMessage {
  // ...existing
  attachments?: SidebarAttachment[]
  attachmentRefKeys?: string[]
}

function addUserMessage(content: string, extras?: { attachments?: SidebarAttachment[]; attachmentRefKeys?: string[] }) {
  messages.value.push({
    id: `msg-${Date.now()}`,
    role: 'user',
    content,
    attachments: extras?.attachments,
    attachmentRefKeys: extras?.attachmentRefKeys,
  })
}
```

- [ ] **Step 2: Wire AgentSideRail**

在 dock 区 input 上方插入 `AgentRefStrip`；`[+]` 触发 hidden `<input type="file">`；`@drop.prevent` 调 `addFromFile`；uploading 时禁用发送。

`sendMessage` body 增量：

```typescript
const { attachments, refOrder } = sidebar.toPayload()
const refKeys = sidebar.assignRefKeys()
agent.addUserMessage(message, { attachments: [...attachments], attachmentRefKeys: refKeys })
// ...
body: JSON.stringify({
  sessionId: props.sessionId,
  message,
  attachments: attachments.length ? attachments : undefined,
  refOrder: refOrder.length ? refOrder : undefined,
  // ...existing
})
sidebar.clear()
```

User 气泡 template：attachments 存在时渲染只读 `AgentRefStrip`（无 remove）。

- [ ] **Step 3: Manual M1 smoke**

1. 打开画布 Agent 侧栏  
2. 上传产品图 → 见 I1 芯片  
3. 输入「按 @I1 生成产品三视图」→ 发送  
4. 检查 Network request body 含 attachments  
5. atomic 完成后检查 image 节点 `data.localRefs` 含上传 url

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/agent/AgentSideRail.vue apps/web/src/stores/agent.ts
git commit -m "feat(web): sidebar upload, ref strip, and attachment payload on send"
```

---

### Task 8: Sidebar copy — 带附件 atomic 文案

**Files:**
- Modify: `services/agent-runtime/app/graph/sidebar_copy.py`
- Modify: `services/agent-runtime/app/graph/atomic_parse_schema.py`（或 parse ack 调用处）

**Interfaces:**
- Consumes: `sidebar_attachments` ref keys
- Produces: `format_atomic_parse_ack(..., ref_keys: list[str] | None)`

- [ ] **Step 1: Write the failing test**

```python
from app.graph.sidebar_copy import format_atomic_parse_ack

def test_parse_ack_mentions_ref():
    msg = format_atomic_parse_ack(title="产品三视图", target_type="image", ref_keys=["I1"])
    assert "@I1" in msg or "参考" in msg
```

- [ ] **Step 2: Run test — FAIL then implement**

有 attachments 时 ack 追加：`好的，我会参考你提供的 @I1，生成…`

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/app/graph/sidebar_copy.py services/agent-runtime/tests/test_sidebar_copy.py
git commit -m "feat(agent): sidebar copy acknowledges attachment ref keys"
```

---

### Task 9: M2 — AgentAssetPicker（资产库选取）

**Files:**
- Create: `apps/web/src/components/agent/AgentAssetPicker.vue`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- Consumes: `CanvasAssetPanel` 选取逻辑 / `canvas asset API`
- Produces: `addFromAsset(asset)` → `sourceKind:'asset'`

- [ ] **Step 1: Implement picker dialog**

弹层列出用户资产；选中 emit `pick(asset)`；SideRail 调 `addFromPayload({ sourceKind:'asset', ... })`.

- [ ] **Step 2: Manual smoke — 从资产库选图 → I1 芯片 → atomic 发送**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/agent/AgentAssetPicker.vue apps/web/src/components/agent/AgentSideRail.vue
git commit -m "feat(web): agent sidebar asset library picker"
```

---

### Task 10: M2 — focusNodeId 升格为 ref

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/composables/useSidebarAttachments.ts`
- Modify: `apps/web/src/pages/CanvasPage.vue`（可选：向 SideRail 传 selected node data）

**Interfaces:**
- Consumes: `props.selectedNodeId` + canvas node list
- Produces: send 时合并 `canvasNode` attachment（去重）

- [ ] **Step 1: Add mergeFocusNodeRef helper**

```typescript
function mergeFocusNodeRef(
  attachments: SidebarAttachment[],
  node: { id: string; type?: string; data?: Record<string, unknown> } | null,
): SidebarAttachment[] {
  if (!node) return attachments
  const data = node.data ?? {}
  const url = String(data.url ?? '').trim()
  const text = String(data.content ?? data.prompt ?? '').trim()
  if (!url && !text) return attachments
  const mediaType = node.type === 'text' || node.type === 'prompt' ? 'text' : 'image'
  const item: SidebarAttachment = {
    id: `focus-${node.id}`,
    mediaType,
    sourceKind: 'canvasNode',
    label: String(data.title ?? data.label ?? node.type ?? node.id),
    url: url || undefined,
    text: text || undefined,
    sourceNodeId: node.id,
  }
  // dedupe by sourceNodeId / url
  ...
}
```

- [ ] **Step 2: sendMessage 调用 merge；manual smoke 选中 image 节点 + 「生成白底版」**

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/agent/AgentSideRail.vue apps/web/src/composables/useSidebarAttachments.ts
git commit -m "feat(web): promote focusNodeId to sidebar attachment ref"
```

---

### Task 11: M2 — Campaign attach_edges + Nest 完整实现

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`（attach_edges 分支）
- Create: `services/agent-runtime/app/graph/nodes/apply_sidebar_refs.py`
- Modify: `services/agent-runtime/app/graph/builder.py`
- Create: `services/agent-runtime/tests/test_campaign_sidebar_refs.py`

**Interfaces:**
- Consumes: `sidebar_attachments` after split; manifest items with `role=seed`
- Produces: mediaInput nodes for uploads; `attach_refs(target, ref_order)`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_campaign_apply_creates_media_input_and_attaches():
    # mock nest: add_nodes_batch for mediaInput, attach_refs called on seed node
    ...
```

- [ ] **Step 2: Implement Nest attach_edges mode**

```typescript
// attach_edges 分支逻辑：
// 1. canvasNode attachments → sourceNodeIds 直接用于 refOrder
// 2. upload/asset image → add_nodes_batch mediaInput 节点，url 写入 data
// 3. text attachment → add text 节点或 fallback localRefs
// 返回 sourceNodeIds 供 attach_refs
```

- [ ] **Step 3: apply_sidebar_refs node after split**

```python
async def apply_sidebar_refs(state: dict) -> dict:
    attachments = state.get("sidebar_attachments") or []
    if not attachments:
        return {}
    manifest = state.get("split_manifest") or []
    target = next((i for i in manifest if i.get("role") == "seed"), manifest[0] if manifest else None)
    target_id = str(target.get("node_id") or "") if target else ""
    if not target_id:
        return {}
    result = await nest.apply_sidebar_attachments(
        node_ids=[target_id],
        attachments=attachments,
        ref_order=state.get("sidebar_ref_order"),
        mode="attach_edges",
    )
    source_ids = result.get("sourceNodeIds") or []
    if source_ids:
        await nest.attach_refs(target_id, source_ids)
    return {}
```

Register in builder: `split` → `apply_sidebar_refs` → `await_topo`（或现有 split 后继）。

- [ ] **Step 4: Run tests + manual Campaign smoke**

Run: `cd services/agent-runtime && python -m pytest tests/test_campaign_sidebar_refs.py -v`  
Manual: 上传品牌图 → Campaign 方案 → split 后主图节点有入边自 mediaInput

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/agent/agent-canvas-tools.service.ts \
  services/agent-runtime/app/graph/nodes/apply_sidebar_refs.py \
  services/agent-runtime/app/graph/builder.py \
  services/agent-runtime/tests/test_campaign_sidebar_refs.py
git commit -m "feat(agent): campaign sidebar attachments via attach_edges"
```

---

### Task 12: Deploy smoke script

**Files:**
- Create: `deploy/prod-sidebar-attachments-verify.py`

- [ ] **Step 1: Write smoke script**

两轮对话：
1. atomic：带 mock attachment payload → 断言 node localRefs
2. campaign：带 attachment → split 后 seed 节点有 ref 边

参照 `deploy/prod-atomic-studio-verify.py` 模式。

- [ ] **Step 2: Run locally against dev/staging**

Run: `python deploy/prod-sidebar-attachments-verify.py`  
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add deploy/prod-sidebar-attachments-verify.py
git commit -m "test(deploy): sidebar attachments smoke verify"
```

---

## M3  backlog（本计划不阻塞 M1/M2 合入）

| 项 | 说明 |
| --- | --- |
| `@` 提及高亮 | 侧栏 textarea 复用 `useRefMentions` |
| 拖拽画布节点 | CanvasPage DnD → AgentSideRail drop |
| 粘贴板 | paste event → addFromFile |
| V/A 生成消费 | 对齐 C3/C4 |
| 芯片拖拽排序 | AgentRefStrip reorder |

---

## Spec self-review

| Spec 章节 | 覆盖 Task |
| --- | --- |
| D1 复用 Ref 模型 | 1, 2, 4, 11 |
| D2 A+B 并重 | 4 (atomic), 11 (campaign) |
| D3 atomic localRefs / Campaign edges | 2, 4, 11 |
| D4 交互引用条 +/+拖拽 | 5, 6, 7 |
| D5 focusNodeId | 10 |
| D6 T\*/I\* only M1/M2 | composable + 文档约束 |
| §4.4 user 气泡附件 | 7 |
| §8 约束 blob/上限/去重 | 1, 3, 5 |
| §9 侧栏文案 | 8 |
| §11 测试要点 | 4, 7, 11, 12 |

无 TBD/占位；M3 明确列为 backlog。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-07-agent-sidebar-material-entry.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派发独立 subagent，Task 间 review，迭代快
2. **Inline Execution** — 本会话按 Task 顺序直接实现，checkpoint 处暂停 review

**Which approach?**
