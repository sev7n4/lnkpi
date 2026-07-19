# C2.1 Canvas 旁路接入 T*/I* Refs（产品与技术规格）

> 状态：**设计确认 / 待实现**  
> 日期：2026-07-19  
> 范围：**C2.1 最小对齐** — shot、shot-linked image/video、sceneComposer batch 传递并消费 `refs` + `mentionedKeys`；Material 走与 Studio 同款 `mergeRefsToPrompt` + `referenceImages`  
> 前置：C2 Canvas adapter/计费（PR #27）、C1 Studio 模型适配层（PR #25）、节点数据贯通 refs（2026-07-18）  
> 后续：**C3 V\*** → **C4 A\***

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 实现方案 | **Material 增量接入 refs**；不先抽共享 GenerationRefResolver；不经 StudioService |
| 适用路径 | shot 生成、shot-linked image/video、sceneComposer batch |
| Prompt 来源 | **目标节点 local prompt**；禁止把 `mergePromptWithUpstream` 长拼接二次喂给 merge |
| Refs 归属 | **目标节点语义**；不做 composer→shot→child 隐式层级合并 |
| Batch prompt | 已展开：媒体子节点 prompt 优先，空则 shot prompt；未展开：shot prompt |
| Batch refs | 已展开：媒体子节点 refs；未展开/子节点缺失：composer 节点 refs |
| 消费能力 | 仅 **T\*** 文本合并 + **I\*** 图片参考；V\*/A\* 可展示但不消费 |
| Merge 计费 | 与 Studio 一致：**不另计费**；batch 预检仍只按图/视频单价 |
| blob | Web 拦截 + Server 扣费前拒绝；允许持久化/外部 HTTPS |
| URL 归属 | 本轮不做资产归属查库（与 Studio 对齐） |
| 明确不做 | 共享 resolver 抽取、V\*/A\* 消费、多图 Material、Playwright、GenerationRecord 统一 |

---

## 1. 背景与问题

C2 已使 Canvas 旁路接入 catalog + adapter + 统一计费 + 所有权校验，但生成仍是 **prompt-only**：

```text
Web → canvasApi({ prompt, model, params })
  → MaterialService
  → build*ProviderOptions({ referenceImages: [] })
```

Studio 独立节点已具备完整链路：

```text
resolveNodeRefs + parseRefMentions
  → studioApi({ prompt, refs, mentionedKeys, ... })
  → resolveMergedPrompt
  → mergeRefsToPrompt(T*) + extractReferenceImages(I*)
  → adapter → provider
```

因此一旦 image/video **连到 shot** 或走 sceneComposer batch，用户在 Dock 上配置的 T*/I* 芯片会静默失效。

另有 **双重合并风险**：Canvas 历史使用 `mergePromptWithUpstream`（简单拼接上游文案）生成 `canvasPrompt`；若再把该结果当 `localPrompt` 送入 `mergeRefsToPrompt`，且同时传 edge T* refs，文本会重复。

---

## 2. 目标与非目标

### 2.1 目标

1. Canvas 三条旁路与 Studio 同款消费 **T\*** / **I\***。
2. Web 按目标节点语义解析并传递 `refs` + `mentionedKeys`。
3. Material 使用 `mergeRefsToPrompt` 与 adapter `referenceImages`，替换硬编码空数组。
4. Prompt 单一来源：local prompt + refs merge；不再二次喂 `canvasPrompt`。
5. Web + Server 均拦截 `blob:`；扣费前完成校验。
6. C2 的 adapter、计费、`skipCharge`、所有权、`count=1` 不退化。
7. 为 C3/C4 预留 V*/A* 展示位，本轮不消费。

### 2.2 非目标

| 能力 | 后续 |
| --- | --- |
| 抽共享 `GenerationRefResolver` / Studio 迁移 | 独立清理 PR |
| V\* 抽帧 / 视频理解 | C3 |
| A\* ASR / 音色参考 | C4 |
| 多图 Material 持久化与展示 | 独立能力 |
| refs URL 必须映射当前用户资产 | 安全加固 |
| LLM merge 单独计费 | 产品另议 |
| Playwright E2E | T2 |

---

## 3. 架构与数据流

### 3.1 选择方案 A

```text
目标节点 local prompt
  + resolveNodeRefs(target)
  + parseRefMentions(local)
        │
        ▼
Canvas API / batch item
  { prompt, refs, mentionedKeys, model/params }
        │
        ▼
MaterialService
  ├─ ownership
  ├─ reject blob refs (before charge)
  ├─ PointsService (unless skipCharge)
  ├─ resolveMergedPrompt → T* merge + I* urls
  └─ buildImage/VideoProviderOptions → Provider
        │
        ▼
Material async state + shot polling
```

不采用：先抽共享编排器、Canvas 调用 StudioService 再同步 Material。

### 3.2 Prompt 与 Refs 解析表

| 路径 | local prompt | refs 来源 | mentionedKeys |
| --- | --- | --- | --- |
| 直接 shot 生成 | `shot.data.prompt` | shot 节点 | 从 shot local prompt 解析 |
| shot-linked image/video | 媒体节点 prompt | 媒体节点 | 从媒体 local prompt 解析 |
| batch 已展开且有媒体子节点 | 媒体子节点 prompt；空则 shot prompt | 媒体子节点 | 从最终 local prompt 解析 |
| batch 未展开 / 子节点缺失 | shot prompt | **composer** 节点 | 从最终 local prompt 解析 |

规则：

- 不做 composer + shot + child 三层 refs 隐式合并。
- Canvas 路径**停止**将 `mergePromptWithUpstream` 结果作为生成 prompt。
- 上游文本应作为 T* edge refs 进入 merge；上游图片作为 I* edge refs。

---

## 4. API 与共享类型

### 4.1 `GenerationRefPayload`

建议放在 `packages/shared/src/nodeRefs.ts` 并 re-export：

```ts
export interface GenerationRefPayload {
  refKey: string
  mediaType: RefMediaType
  label?: string
  text?: string
  url?: string
}
```

Web `StudioRefPayload` 与 Server DTO 对齐该形状（可保留别名）。

### 4.2 Material 请求

`POST material/generate-image` / `generate-video` 增加：

```ts
refs?: GenerationRefPayload[]
mentionedKeys?: string[]
```

其余 C2 字段不变（model、aspectRatio、resolution、duration、crop；image `count` 仍服务端强制 1）。

### 4.3 SceneComposer BatchItem

```ts
export interface SceneComposerBatchItem {
  // ...existing C2 fields
  refs?: GenerationRefPayload[]
  mentionedKeys?: string[]
}
```

每项独立携带；服务端按项 merge，互不影响。

### 4.4 Controller

- 继续从 `req.user.sub` 注入 `userId`。
- Image/Video/BatchItemDto 增加嵌套 refs 校验：`refKey`、`mediaType` 必填；其余可选。
- `mentionedKeys` 为可选字符串数组。

---

## 5. Web 行为

### 5.1 公共解析

复用 `resolveNodeRefs`：

1. 选定目标节点（见 §3.2）。
2. 解析 edge + local refs，过滤 stale。
3. 映射为 `GenerationRefPayload`。
4. `mentionedKeys = parseRefMentions(localPrompt)`。
5. 若 `hasBlobReference(refs, data)` → patch error，不发请求。

### 5.2 `useNodeGeneration` 变更

- `generateShot`：传 shot local prompt + shot refs/mentions + 媒体子节点 model/params（C2 已有）。
- shot-linked 分支：传媒体节点 local prompt + 其 refs/mentions（不再传 `canvasPrompt`）。
- `batchGenerateSceneComposer`：`buildBatchGenerateItems` 按 §3.2 填充每项 prompt/refs/mentions。

### 5.3 `buildBatchGenerateItems`

签名扩展为接收 `{ nodes, edges, composerNodeId }`，以便：

- 定位媒体子节点 / composer；
- 解析目标 refs；
- 计算最终 local prompt。

---

## 6. Material merge 与 provider

### 6.1 私有 `resolveMergedPrompt`

语义对齐 `StudioService.resolveMergedPrompt`：

- T* → `mergeRefsToPrompt({ sources, localPrompt, downstreamType, mentionedKeys, apiKey, baseUrl })`
- I* → URL 列表（顺序与 refs 一致；仅非空 url）
- V*/A* 忽略
- 返回 `{ mergedText, skippedMerge, referenceImages }`

### 6.2 Image

1. 所有权校验 → blob 校验 → 扣费（除非 `skipCharge`）→ 创建 Material。
2. 异步：`resolveMergedPrompt(..., 'image')`。
3. `buildImageProviderOptions({ referenceImages, n: 1, ... })`。
4. 主图：`buildPromptWithRefImage(mergedText, primaryRef)`（有 primary 时）。
5. 拼接 `effectivePromptSuffix`。
6. Provider 生成；Material.`prompt` 存 **effectivePrompt**；失败标 `failed`，不退款。

### 6.3 Video

1. 同上前序校验与扣费。
2. `resolveMergedPrompt(..., 'video')`。
3. `buildVideoProviderOptions({ referenceImages, ... })`。
4. `effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')`。
5. Provider options 含 `image: built.image`。
6. Material.`prompt` 存 effectivePrompt。

### 6.4 日志

Material 表不新增列。结构化日志记录：

- `skippedMerge`
- `refsCount`
- `referenceImages.length`
- `event: canvas_blob_ref_rejected`（若触发）

---

## 7. blob、batch 与计费

### 7.1 blob

| 层 | 行为 |
| --- | --- |
| Web | 生成前拦截；错误文案与现有一致（参考图尚未上传） |
| Server | **扣费前**扫描全部 refs 的 `url`；任一以 `blob:` 开头 → `BadRequestException` |

允许：已持久化的相对/绝对业务 URL、`https://` 外链（与 Studio 一致）。

### 7.2 Batch

1. `assertOwnedSession` + 每项 shot 属 session。
2. 预检全部 item 的 refs（blob）。
3. 任一项非法 → 整批拒绝，零扣费、零 Material、零 provider。
4. `sum(itemCredits)` → 一次 `points.consume`。
5. 各 item `skipCharge: true` + 完整 `refs`/`mentionedKeys`/model params 调用 Material。
6. 每项独立异步 merge/generate；单项失败不退款、不阻断其他项。

### 7.3 Merge 计费

- LLM merge **不另计费**（与 Studio 一致）。
- Batch 预检总额仍仅为图 10 + 视频 30/50/70。

---

## 8. 测试策略

### 8.1 Server

- image：T* 进入 merge；I* 进入 `referenceImages`；主图走 `buildPromptWithRefImage`；`n=1`
- video：I1 → `options.image`；其余图 → prompt suffix
- blob → 扣费前拒绝，无 Material
- foreign shot → 404，不扣费
- `skipCharge: true` 仍 merge，不二次扣费
- batch：透传 refs；blob 整批零副作用；积分不足零副作用

### 8.2 Web

- shot：local + shot refs；不使用 `canvasPrompt`
- shot-linked image/video：媒体节点 prompt/refs + model params
- blob 护栏覆盖 Canvas 路径
- batch 已展开 / 未展开 的 prompt+refs 规则
- `mentionedKeys` 来自最终 local prompt
- Studio 独立路径不回归

### 8.3 全量验收

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm test
```

手工清单写入 `docs/DOCK_STUDIO_E2E_TRACKING.md`：

1. text → shot → 生成：合并文案进入 Material  
2. image → shot-linked video：I\* 进入图生视频  
3. 已展开 sceneComposer：改媒体 prompt/@mention 后 batch 生效  
4. 未展开 batch：composer 上 T\*/I\* 生效  
5. blob：Web 拦截；直打 API 也被 Server 拒绝  
6. 积分不足 batch 零启动  

---

## 9. 验收标准

1. Canvas 三条路径消费 T\*/I\*，行为对齐 Studio merge + adapter。  
2. 无 `canvasPrompt` 双重合并。  
3. 目标节点 refs 语义成立；未展开 batch 使用 composer refs。  
4. Web + Server 拦截 `blob:`。  
5. Merge 不另计费；C2 计费/`skipCharge`/所有权/`count=1` 不退化。  
6. V\*/A\* 不消费。  
7. `pnpm build && pnpm test` 通过。  
8. 跟踪文档登记 C2.1 状态与 C3/C4 顺序。  

---

## 10. 后续路线

```text
C2.1 T*/I* refs on Canvas
  → C3 V* frame extraction / understanding
  → C4 A* ASR / voice reference
```

可选并行：抽共享 `resolveMergedPrompt` 清理 Studio/Material 重复（非本 PR 阻塞项）。

---

## 11. 实现交接

规格确认后：

1. `writing-plans` → `docs/superpowers/plans/2026-07-19-c21-canvas-refs.md`  
2. 分支 `feature/c21-canvas-refs`  
3. TDD：shared 类型 → Material merge → Controller/DTO → Web 解析 → batch → 全量验收  
4. Subagent-Driven 或 Inline 执行  
5. 独立 PR，CI 绿后 Squash & Merge  
