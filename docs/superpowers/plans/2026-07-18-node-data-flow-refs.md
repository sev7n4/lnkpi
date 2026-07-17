# 画布节点数据贯通与多上游引用 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让画布节点通过连线 / 资产库 / 上传形成统一多上游 Ref 列表，Dock 单行芯片展示并可调序；生成时多文本经 LLM 归纳合并、多图全部作为参考；图→文本支持视觉方案；`prompt` 上游长文不进模式生成（决策 B）。

**Architecture:** 前端 `resolveNodeRefs` 实时解析 edge + `localRefs` → `DockRefStrip`；生成请求携带结构化 `refs[]`；Nest/agent 在文/图/视/音生成前按需 `mergeRefsToPrompt`；`prompt/generate` 仍只吃本节点短 `prompt`。不做自动级联、环检测、可连性强制矩阵。

**Tech Stack:** Vue 3, TypeScript, NestJS, Vitest, OpenAI-compatible chat/completions（文本合并 + 可选 vision）

**Spec:** `docs/superpowers/specs/2026-07-18-node-data-flow-refs-design.md`

## Global Constraints

- 数据贯通 only：引用变化不自动重跑下游
- RefChip 单行横滑；序号 `T1/I1/V1/A1`；移除芯片 = 断边或解绑 `localRefs`
- 多文本：Chat 归纳合并（非朴素拼接）；单源跳过；合并费用计入该次生成不加价
- 上游 → `prompt` = **B**：长文不进 Call-1/Call-2；仅空短需求时可摘要预填一次
- 图→文本与普通文本同价；音频节点图片芯片一期只展示
- 持久化：edges + `data.localRefs` + `data.refOrder`；不拷贝上游全文
- P3（视→图/ASR/环检测等）本计划不实现
- 提交前：`pnpm --filter @lnkpi/agent test`；涉及 web 时 `pnpm --filter @lnkpi/web build`（或 `pnpm build`）

---

## File Structure Map

| 路径 | 职责 |
|------|------|
| `packages/shared/src/nodeRefs.ts`（或 `packages/agent/...` 若仅服务端用类型则前后端各一份对齐） | `NodeRef` / `StudioRefPayload` 共享类型（优先放 shared） |
| `packages/agent/src/refs/merge-refs.ts` | `mergeRefsToPrompt` Chat 归纳 |
| `packages/agent/src/refs/merge-refs.test.ts` | 合并跳过/调用逻辑单测（mock fetch） |
| `packages/agent/src/refs/vision-text.ts` | 图→文本视觉生成（Task 8） |
| `apps/server/src/studio/studio.dto.ts`（或内联 DTO） | `refs` 字段校验 |
| `apps/server/src/studio/studio.service.ts` | generate* 接入 merge / vision |
| `apps/server/src/studio/studio.controller.ts` | 接收 `refs` |
| `apps/web/src/composables/useNodeRefs.ts` | `resolveNodeRefs`、编号、排序 |
| `apps/web/src/composables/useNodeRefs.test.ts` | Vitest（若 web 已有 vitest；否则放 `packages/shared` 测纯函数） |
| `apps/web/src/composables/useUpstreamNodeContext.ts` | 改为薄封装调用 `resolveNodeRefs` 或逐步弃用旧 API |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.vue` | 单行芯片条 |
| `apps/web/src/components/canvas/dock-studio/shared/DockRefChip.vue` | 单芯片 |
| `apps/web/src/components/canvas/dock-studio/panels/*DockPanel.vue` | 接入 RefStrip（text/prompt/image/video/audio） |
| `apps/web/src/composables/useNodeGeneration.ts` | 组装 refs 提交；prompt 分支遵守 B |
| `apps/web/src/services/studio-api.ts` | generate* 增加 `refs` / `referenceImages` |
| `apps/web/src/pages/CanvasPage.vue` | 移除芯片断边；资产/上传写入 `localRefs` |

---

### Task 1: 共享类型 + `resolveNodeRefs` 纯函数

**Files:**
- Create: `packages/shared/src/nodeRefs.ts`
- Modify: `packages/shared/src/index.ts`（re-export）
- Create: `packages/shared/src/nodeRefs.test.ts`（若 shared 有 vitest；否则 `apps/web/src/composables/useNodeRefs.test.ts` 只测导入的纯函数）
- Create: `apps/web/src/composables/useNodeRefs.ts`

**Interfaces:**
- Produces:

```ts
export type RefMediaType = 'text' | 'image' | 'video' | 'audio'
export type RefSourceKind = 'edge' | 'asset' | 'upload'

export interface NodeRef {
  refId: string
  refKey: string // 'T1' | 'I1' | ...
  mediaType: RefMediaType
  sourceKind: RefSourceKind
  label: string
  preview: string
  payload: { text?: string; url?: string }
  edgeId?: string
  sourceNodeId?: string
  stale?: boolean
}

export interface LocalRefBinding {
  id: string
  mediaType: RefMediaType
  sourceKind: 'asset' | 'upload'
  label: string
  url?: string
  text?: string
}

export interface ResolveNodeRefsInput {
  targetNodeId: string
  targetType: string
  nodes: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
  edges: Array<{ id: string; source: string; target: string }>
  localRefs?: LocalRefBinding[]
  refOrder?: string[] // refId 顺序
}

export function resolveNodeRefs(input: ResolveNodeRefsInput): NodeRef[]
export function assignRefKeys(refs: Omit<NodeRef, 'refKey'>[]): NodeRef[]
```

- [ ] **Step 1: 写失败单测（多文本 + 多图 + prompt 优先 content + refOrder）**

```ts
import { describe, it, expect } from 'vitest'
import { resolveNodeRefs } from './nodeRefs' // 路径按实际

describe('resolveNodeRefs', () => {
  it('collects multiple texts and images with T/I keys', () => {
    const refs = resolveNodeRefs({
      targetNodeId: 'img1',
      targetType: 'image',
      nodes: [
        { id: 't1', type: 'text', data: { content: '文案A' } },
        { id: 'p1', type: 'prompt', data: { prompt: '短', content: '长文CONTENT' } },
        { id: 'i1', type: 'image', data: { url: 'https://a/1.png' } },
        { id: 'i2', type: 'image', data: { url: 'https://a/2.png' } },
        { id: 'img1', type: 'image', data: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'img1' },
        { id: 'e2', source: 'i1', target: 'img1' },
        { id: 'e3', source: 'p1', target: 'img1' },
        { id: 'e4', source: 'i2', target: 'img1' },
      ],
    })
    const texts = refs.filter((r) => r.mediaType === 'text')
    const images = refs.filter((r) => r.mediaType === 'image')
    expect(texts.map((r) => r.refKey)).toEqual(['T1', 'T2'])
    expect(texts.find((r) => r.sourceNodeId === 'p1')?.payload.text).toBe('长文CONTENT')
    expect(images).toHaveLength(2)
    expect(images.map((r) => r.refKey)).toEqual(['I1', 'I2'])
  })

  it('respects refOrder for same media type', () => {
    const refs = resolveNodeRefs({
      targetNodeId: 'img1',
      targetType: 'image',
      nodes: [
        { id: 't1', type: 'text', data: { content: 'A' } },
        { id: 't2', type: 'text', data: { content: 'B' } },
        { id: 'img1', type: 'image', data: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'img1' },
        { id: 'e2', source: 't2', target: 'img1' },
      ],
      refOrder: ['e2', 'e1'],
    })
    expect(refs.filter((r) => r.mediaType === 'text').map((r) => r.payload.text)).toEqual(['B', 'A'])
    expect(refs[0].refKey).toBe('T1')
  })
})
```

- [ ] **Step 2: 跑测确认失败**

Run: `pnpm --filter @lnkpi/shared test`（或 web/agent 中实际测试命令）  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `resolveNodeRefs` + `assignRefKeys`**

规则：
- text/prompt → text（prompt：`content || prompt`）
- image/mediaInput → image（`data.url`）
- video → video；audio → audio（可先收录芯片）
- `localRefs` 一并纳入
- 缺 url/text → `stale: true` 仍返回芯片
- `refOrder` 按 `refId` 排序；未出现的 append 到末尾
- 按 mediaType 分组赋 `T#/I#/V#/A#`

- [ ] **Step 4: 跑测通过**

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/nodeRefs.ts packages/shared/src/nodeRefs.test.ts packages/shared/src/index.ts apps/web/src/composables/useNodeRefs.ts
git commit -m "feat(shared): add resolveNodeRefs for multi-upstream chips"
```

---

### Task 2: 兼容层 — 旧 `UpstreamNodeContext` 委托新解析

**Files:**
- Modify: `apps/web/src/composables/useUpstreamNodeContext.ts`

**Interfaces:**
- Consumes: `resolveNodeRefs`
- Produces: 保持 `UpstreamNodeContext` 形状供未改面板临时使用：
  - `textPrompt` = 文本 refs 的临时 join（仅兼容；生成路径 Task 6 起不再依赖）
  - `referenceImageUrl` = `I1` 的 url
  - `textNodeIds` / `referenceImageNodeId` 从 refs 推导

- [ ] **Step 1: 改写 `resolveUpstreamContext` 内部调用 `resolveNodeRefs`，单测或手工确认旧调用方不炸**

```ts
export function resolveUpstreamContext(...): UpstreamNodeContext {
  const refs = resolveNodeRefs({ ... edges need id — 若旧 edge 无 id，用 `${source}->${target}` 作 refId })
  const textRefs = refs.filter((r) => r.mediaType === 'text' && !r.stale)
  const imageRefs = refs.filter((r) => r.mediaType === 'image' && !r.stale)
  return {
    textPrompt: textRefs.map((r) => r.payload.text).filter(Boolean).join('\n'),
    referenceImageUrl: imageRefs[0]?.payload.url ?? '',
    referenceImageNodeId: imageRefs[0]?.sourceNodeId ?? null,
    textNodeIds: textRefs.map((r) => r.sourceNodeId!).filter(Boolean),
  }
}
```

- [ ] **Step 2: 确保 `CanvasEdgeLike` 含可选 `id?: string`；`CanvasPage` 的 edges 已有 id 则传入**

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(web): bridge UpstreamNodeContext to resolveNodeRefs"
```

---

### Task 3: `DockRefChip` + `DockRefStrip` UI

**Files:**
- Create: `apps/web/src/components/canvas/dock-studio/shared/DockRefChip.vue`
- Create: `apps/web/src/components/canvas/dock-studio/shared/DockRefStrip.vue`

**Interfaces:**
- Produces:

```ts
// DockRefStrip props
{
  refs: NodeRef[]
  // emits
  reorder: [refIds: string[]]
  remove: [ref: NodeRef]
}
```

- [ ] **Step 1: 实现 Chip** — 显示 `refKey`、类型色点/图标、`label` 截断；图片显示小缩略图；`stale` 灰色；右侧 ×

- [ ] **Step 2: 实现 Strip** — 单行 `overflow-x-auto`；HTML5 drag-and-drop 或指针拖拽调序；emit `reorder`；× → `remove`

样式约束：高度紧凑（约 28–32px 芯片），不占多行分类标题。

- [ ] **Step 3: 在 Story/临时挂到 ImageDockPanel 上方目视确认单行横滑**（可随后 Task 4 正式接入）

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): add DockRefStrip single-row reference chips"
```

---

### Task 4: 五类 Dock 接入 RefStrip + `refOrder` / 移除断边

**Files:**
- Modify: `TextDockPanel.vue`, `PromptDockPanel.vue`, `ImageDockPanel.vue`, `VideoDockPanel.vue`, `AudioDockPanel.vue`
- Modify: `DockStudioRouter.vue` / `NodePanelDock.vue`（若需把 `removeEdge` / `patch` 回调传入）
- Modify: `CanvasPage.vue`（提供 `onRefRemove` / edges 带 id）

**Interfaces:**
- Consumes: `resolveNodeRefs` via props 或 inject：`refs: NodeRef[]`
- Panel `emit('patch', { refOrder })`；`emit('removeRef', ref)`
- CanvasPage: `removeRef` → 若 `sourceKind==='edge'` 则 `deleteEdgeById(ref.edgeId)`；否则从 `localRefs` filter

- [ ] **Step 1: CanvasPage 计算 selected 节点的 refs 并传给 Dock**

```ts
const selectedRefs = computed(() => {
  if (!selectedNode.value) return []
  return resolveNodeRefs({
    targetNodeId: selectedNode.value.id,
    targetType: String(selectedNode.value.type),
    nodes: nodes.value,
    edges: edges.value.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    localRefs: (selectedNode.value.data?.localRefs as LocalRefBinding[]) ?? [],
    refOrder: (selectedNode.value.data?.refOrder as string[]) ?? [],
  })
})
```

- [ ] **Step 2: 各 Dock 在 `DockPromptSection` 上方插入 `<DockRefStrip>`**

- [ ] **Step 3: PromptDockPanel 特殊逻辑（决策 B）**
  - 展示全部文本芯片
  - `watch`：仅当 `prompt` 为空且存在文本 ref 时，预填 `preview`/`payload.text` 截断（如 80 字）一次；用 `data.promptPrefillFromRefId` 防重复覆盖

- [ ] **Step 4: AudioDockPanel 图片芯片照常展示（只展示）**

- [ ] **Step 5: 手动验收：连两条 text + 两张 image → 图片 Dock 见 T1/T2/I1/I2；× 掉 T1 后边消失**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(web): wire RefStrip into dock panels with edge unlink"
```

---

### Task 5: 资产库 / 上传 → `localRefs`

**Files:**
- Modify: `CanvasPage.vue`（`handleAssetApply`、拖放、上传成功回调）
- Modify: `useCanvasMedia.ts`（若上传落点在此）

**Interfaces:**
- `data.localRefs: LocalRefBinding[]`
- 应用图片资产到**当前选中** image/video/text 节点时：push `{ id, mediaType:'image', sourceKind:'asset', label, url }`，不要只改 `url` 覆盖（可同时设主 url 以兼容旧节点卡片预览）

- [ ] **Step 1: `handleAssetApply` 改为写入 `localRefs`（append）**

```ts
function appendLocalRef(nodeId: string, binding: LocalRefBinding) {
  const node = findNodeById(nodes.value, nodeId)
  const prev = (node?.data?.localRefs as LocalRefBinding[]) ?? []
  patchNodeData(nodeId, { localRefs: [...prev, binding] })
}
```

- [ ] **Step 2: 节点/Dock 拖入文件成功后同样 append `sourceKind:'upload'`**

- [ ] **Step 3: Strip 上 × 本地引用 → filter `localRefs`，不断无关边**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): unify asset/upload into localRefs chips"
```

---

### Task 6: Agent `mergeRefsToPrompt` + Nest 生成接入 refs

**Files:**
- Create: `packages/agent/src/refs/merge-refs.ts`
- Create: `packages/agent/src/refs/merge-refs.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `apps/server/src/studio/studio.controller.ts`
- Modify: `apps/server/src/studio/studio.service.ts`

**Interfaces:**
- Produces:

```ts
export interface MergeTextSource {
  refKey: string
  label: string
  text: string
}

export async function mergeRefsToPrompt(input: {
  sources: MergeTextSource[]
  localPrompt?: string
  downstreamType: 'text' | 'image' | 'video' | 'audio'
  apiKey?: string
  baseUrl?: string
  model?: string
}): Promise<{ mergedText: string; skippedMerge: boolean }>
```

规则：
- `sources` + 非空 `localPrompt` 计为文本源；总数 ≤ 1 → `skippedMerge: true`，返回该条文本
- 否则 Chat 合并（temperature ~0.3）；无 Key 时 fallback：带 `【T1·label】` 前缀的拼接（仅无 Key 降级，有 Key 禁止用拼接当最终策略）

Nest DTO 扩展：

```ts
class StudioRefDto {
  @IsString() refKey!: string
  @IsString() mediaType!: string
  @IsOptional() @IsString() label?: string
  @IsOptional() @IsString() text?: string
  @IsOptional() @IsString() url?: string
}

// generateText / image / video / audio body 增加:
@IsOptional() @IsArray() refs?: StudioRefDto[]
```

`generatePrompt`：**忽略 refs 进合并**（决策 B）；短 `prompt` 仍必填。

`generateText/Image/Video/Audio`：
1. 从 refs 抽 text → mergeRefsToPrompt（按下游 type）
2. image urls → `referenceImages`（I1 为主）
3. 再调原 provider（image 若尚不支持多图，至少 prompt 用 mergedText + 主图 URL 拼进现有 `buildPromptWithRefImage` 兼容路径；多图数组先写入 metadata）

- [ ] **Step 1: 单测 skip / merge 分支（mock fetch）**

- [ ] **Step 2: 实现 mergeRefsToPrompt 并 export**

- [ ] **Step 3: studio.service 各 generate* 接入；积分仍一次 5/10…（合并不加价）**

- [ ] **Step 4: `pnpm --filter @lnkpi/agent test` + server build**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(studio): merge multi-text refs via LLM before generate"
```

---

### Task 7: 前端生成链路传 `refs`（替换本地独占 merge）

**Files:**
- Modify: `apps/web/src/services/studio-api.ts`
- Modify: `apps/web/src/composables/useNodeGeneration.ts`

**Interfaces:**
- `studioApi.generateText(prompt, model?, refs?)`
- `studioApi.generateImage(prompt, model?, aspectRatio?, refs?)`
- 同理 video/audio
- `prompt` 分支：`generatePrompt(localPrompt, model)` **不传文本 refs 作合并**（B）

- [ ] **Step 1: 扩展 studio-api 类型**

```ts
export type StudioRefPayload = {
  refKey: string
  mediaType: string
  label?: string
  text?: string
  url?: string
}
```

- [ ] **Step 2: `generateForNode` 内 `resolveNodeRefs`，映射为 payload**

```ts
const refs = resolveNodeRefs(...).filter((r) => !r.stale)
const payload = refs.map((r) => ({
  refKey: r.refKey,
  mediaType: r.mediaType,
  label: r.label,
  text: r.payload.text,
  url: r.payload.url,
}))
// image/video/audio/text: 传 local prompt + refs
// prompt: 只传 data.prompt
```

- [ ] **Step 3: 删除/绕过「本地非空则忽略上游」的旧 `mergePromptWithUpstream` 生成路径**（Dock 预填可保留独立逻辑）

- [ ] **Step 4: 手动：双文本 → 图节点生成，Network 请求 body 含 `refs:[{refKey:T1...},{T2...}]`**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): send structured refs on studio generate"
```

---

### Task 8: 图 → 文本视觉方案（P2）

**Files:**
- Create: `packages/agent/src/refs/vision-text.ts`
- Create: `packages/agent/src/refs/vision-text.test.ts`
- Modify: `apps/server/src/studio/studio.service.ts` `generateText`
- Modify: text-provider 或单独 vision chat（image_url parts）

**Interfaces:**
- 当 `generateText` 收到 `refs` 中含 image url 时：走 vision system（电商主图/详情/细节/模特方案默认模板）+ 用户 local/merged 文本
- 积分：与普通文本同价（5 点）

- [ ] **Step 1: 实现 `generateTextWithImages(prompt, imageUrls, opts)`**

OpenAI-compatible：

```ts
messages: [{
  role: 'user',
  content: [
    { type: 'text', text: promptOrDefault },
    ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } })),
  ],
}]
```

无 Key：返回带结构的 Placeholder 方案文，禁止空。

- [ ] **Step 2: studio.generateText 分支调用**

- [ ] **Step 3: 验收：衣服图 → 文本节点生成出分镜式电商方案**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(studio): vision-assisted text generate from image refs"
```

---

### Task 9: `@T1` / `@I2` 解析（P1.1，可紧随）

**Files:**
- Create: `apps/web/src/composables/useRefMentions.ts`
- Modify: `DockPromptSection.vue` 或 MentionInput（若已有 @ 基建则复用）

**Interfaces:**
- 一期规格允许「整组自动带入」已在 Task 6–7 完成；本任务仅增强：输入中的 `@T1` 高亮；提交前若存在 `@` 标记，合并 LLM 的 user 消息中强调「优先落实被 @ 的项」（服务端可增加 `mentionedKeys?: string[]`）

- [ ] **Step 1: 前端解析 `@[TIVA]\d+`，生成时附加 `mentionedKeys`**

- [ ] **Step 2: mergeRefsToPrompt system 增加「被提及的 refKey 优先」**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(web): support @T1 style ref mentions in dock input"
```

---

### Task 10: 回归验收清单 + 文档收口

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-node-data-flow-refs-design.md`（状态改为实现中/完成）
- Modify: `docs/DOCK_STUDIO_E2E_TRACKING.md`（补数据贯通验收项，若该文件仍维护）

- [ ] **Step 1: 按下列清单手测并勾选**

| # | 场景 | 期望 |
|---|---|---|
| 1 | 多 text → image | 单行 T1/T2；生成 body 含 refs；出图用合并文案 |
| 2 | 多 image → image/video | I1/I2 皆在 refs；主图 I1 |
| 3 | prompt.content → image | 注入长文非短 prompt |
| 4 | × 芯片 | edge 删除 / localRefs 移除 |
| 5 | 资产拖入 | 出现 upload/asset 芯片 |
| 6 | prompt 上游长文 | 不进 prompt 生成；空框可预填 |
| 7 | 图 → text | 电商方案类长文；扣 5 点 |
| 8 | 音频 + 图片芯片 | 只展示不报错 |
| 9 | 仅改上游 content | 下游芯片更新；不自动重生成 |

- [ ] **Step 2: `pnpm build` + agent test 全绿**

- [ ] **Step 3: Commit docs**

```bash
git commit -m "docs: mark node data-flow refs plan acceptance checklist"
```

---

## Spec coverage self-check

| 规格项 | 任务 |
|--------|------|
| resolve 多上游 / T-I-V-A | Task 1 |
| 单行 RefChip UI | Task 3–4 |
| 移除=断边 | Task 4 |
| localRefs 三类源 | Task 5 |
| LLM 文本合并 | Task 6–7 |
| prompt 决策 B | Task 4、6、7 |
| 多图参考 | Task 1、6、7 |
| 图→文本视觉 | Task 8 |
| @ 引用 | Task 9（P1.1） |
| 不自动级联 / 无环检测 | Global Constraints（不实现） |
| 视→图/ASR 等 | 不做（P3） |

## Placeholder scan

无 TBD 实现步骤；P3 仅登记在 Global Constraints。

---

## 建议落地顺序

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10`

可垂直切片先行发布：**Task 1–7**（数据贯通+合并+UI）为 MVP；**Task 8–9** 为增强。
