# C2 Canvas 旁路接入 Studio Adapter（产品与技术规格）

> 状态：**设计确认 / 待实现**  
> 日期：2026-07-19  
> 范围：**C2 最小** — shot、shot 子媒体与 sceneComposer batch 接入 C1 模型目录、生成 adapter、参数透传与统一计费  
> 前置：T0 测试地基（PR #26）、C1 Studio 模型适配层（PR #25）  
> 后续：**C2.1 refs** → **C3 V\*** → **C4 A\***

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 实现方案 | **增量接入 adapter**；不先重构统一生成编排器 |
| 适用路径 | shot 生成、shot-linked image/video、sceneComposer batch |
| 配置来源 | 优先复用媒体子节点；缺失时用 catalog 默认 |
| 图片数量 | Canvas/Material 旁路固定 `count = 1` |
| 计费 | 与 Studio 同价；图 10，视频按 5/10/15 秒计 30/50/70 |
| 批量计费 | 全量预检后一次扣除；不足则整批不启动 |
| 失败退款 | 不退款，与 Studio 当前语义一致 |
| 权限 | 生成、导演台保存/批量均校验 session/shot 归属 |
| 明确不做 | refs、mentionedKeys、LLM prompt 合并、多图 Material、V\*、A\*、Playwright |

---

## 1. 背景与问题

C1 已使普通 Studio 的 text/image/video/audio 路径统一经过：

```text
studioModelCatalog
  → buildImageProviderOptions / buildVideoProviderOptions / buildAudioRequest
  → Provider
```

但 Canvas 仍有三条旁路：

1. shot 直接生成 image/video；
2. image/video 连接到 shot 后走 `canvasApi`；
3. sceneComposer 批量生成 Material。

这些路径当前由 `MaterialService` 裸调 `createImageProvider()` /
`createVideoProvider()`，因此存在以下差距：

- 不传用户选择的模型；
- 图像不传比例、分辨率和数量约束；
- 视频参数不完整，crop 仍手工拼 prompt；
- 不经过 C1 能力表，无法获得参数降级规则；
- Canvas 生成不扣积分；
- 部分 Canvas 写入/生成入口只验证登录，不验证资源归属。

## 2. 目标与非目标

### 2.1 目标

1. 三条 Canvas 旁路复用 C1 catalog + adapter。
2. 用户在媒体子节点选择的模型和参数真实进入 provider。
3. 没有媒体子节点或配置缺失时，使用 catalog 默认值。
4. Material 保持现有异步生成、状态和 shot polling 模型。
5. Canvas 图/视频与 Studio 同价扣费。
6. sceneComposer batch 整批预检并一次扣费。
7. 生成和导演台入口校验当前用户的资源所有权。
8. 为 C2.1 refs 预留请求结构与 service 扩展点，但本轮不消费 refs。

### 2.2 非目标

| 能力 | 后续轮次 |
| --- | --- |
| T\*/I\* refs、`mentionedKeys`、LLM prompt 合并 | C2.1 |
| 多图 Material 与多 URL 展示 | 独立后续能力 |
| V\* 抽帧、视频理解 | C3 |
| A\* ASR、音色参考 | C4 |
| Playwright E2E | T2 工程轨 |
| Studio/Material 统一状态机或 `GenerationRecord` | 后续架构重构 |
| 所有 Canvas CRUD 的全面权限加固 | 独立安全加固；本轮覆盖触达的生成/导演台入口 |

---

## 3. 架构与数据流

### 3.1 选择方案

采用“MaterialService 增量接入 adapter”：

```text
Web: shot / child media / sceneComposer
  │  modelKey + image/video params
  ▼
CanvasController
  │  authenticated userId
  ▼
MaterialService / SceneComposerService
  ├─ ownership validation
  ├─ PointsService
  ├─ buildImageProviderOptions / buildVideoProviderOptions
  └─ Provider → Material async state
```

不采用：

- **Canvas 复用 StudioService**：会产生 GenerationRecord 与 Material 双状态机；
- **先抽统一 Orchestrator**：会重构已上线的 C1 主路径，超出 C2 最小范围。

### 3.2 服务职责

#### `PointsService`

共享积分扣减能力：

```ts
consume(userId: string, cost: number, reason: string): Promise<void>
```

- 使用数据库事务；
- 在事务内按 `id + points >= cost` 原子条件扣减；
- 更新数为 0 时抛 `BadRequestException('积分不足')`；
- 同事务写入负数 `PointTransaction`；
- `StudioService` 改为依赖该服务，对外行为不变。

#### `MaterialService`

- 接收 `userId`、shotId、prompt、modelKey 和媒体参数；
- 校验 shot 及所属 session 归当前用户；
- 单次请求扣费后创建 Material；
- image 调 `buildImageProviderOptions`；
- video 调 `buildVideoProviderOptions`；
- 保持 fire-and-forget provider 调用；
- 成功写 `completed + url/thumbnail`，失败写 `failed`。

#### `SceneComposerService`

- `save`、`batchGenerate` 接收 `userId`；
- 校验 session 归属；
- 对已存在 shot 校验其 `sessionId` 与请求 session 一致；
- batch 先完成全部结构、归属、参数和费用预检；
- 一次扣除总费用后，再创建/更新 shot 并启动 Material；
- 各 Material 异步失败相互隔离。

---

## 4. API 与共享类型

### 4.1 Image Material

`POST /agent/canvas/material/generate-image`

```ts
type GenerateCanvasImageRequest = {
  shotId: string
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: string
  count?: number
}
```

规则：

- `model` 是 catalog `modelKey`，缺省取 `defaultModelKey('image')`；
- `aspectRatio` 默认 `16:9`；
- `resolution` 默认 `1K`；
- 服务端始终以 `n = 1` 调 provider；
- 客户端传 `count > 1` 时忽略并输出结构化降级日志；
- `resolveImageSize` 生成 size；
- provider 参数为 `{ modelId, size, n: 1 }`。

本轮不改 Material schema；adapter meta 不落 `GenerationRecord`。必要的降级信息写服务端结构化日志。

### 4.2 Video Material

`POST /agent/canvas/material/generate-video`

```ts
type GenerateCanvasVideoRequest = {
  shotId: string
  prompt: string
  model?: string
  duration?: 5 | 10 | 15
  aspectRatio?: VideoAspectRatio
  resolution?: VideoResolution
  crop?: VideoCropMode
}
```

规则：

- model 缺省取 `defaultModelKey('video')`；
- 其余缺省取 `DEFAULT_VIDEO_SETTINGS`；
- 经 `buildVideoProviderOptions` 处理 native / metadataOnly；
- C2 的 `referenceImages` 固定为空数组；
- crop 不再由 MaterialService 手工拼入 prompt；
- provider 只收到 adapter 产出的参数。

### 4.3 Scene Composer Batch

扩展 `SceneComposerBatchItem`：

```ts
type SceneComposerBatchItem = {
  shotNodeId: string
  title?: string
  prompt: string
  mediaType: 'image' | 'video'
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: 5 | 10 | 15
  crop?: VideoCropMode
  count?: number
}
```

服务端按 `mediaType` 只读取对应字段；image 固定 `count = 1`。

### 4.4 Controller

以下入口都从 AuthGuard 注入的 `req.user.sub` 读取 userId，并传给 service：

- `material/generate-image`
- `material/generate-video`
- `scene-composer/save`
- `scene-composer/batch-generate`

客户端不得传 userId。

---

## 5. Web 配置解析

### 5.1 shot-linked media

`generateImageOrVideo` 已持有当前 image/video 节点：

- image 读取 `imageModel`、`imageAspect`、`imageResolution`；
- video 读取 `videoModel` 与完整 `videoSettings`；
- image 请求显式传 `count: 1`。

### 5.2 shot 自身生成

`generateShot` 查找 shot 的出边媒体子节点：

1. 根据生成策略选择 image 或 video；
2. 优先读取匹配媒体子节点配置；
3. 未找到子节点或字段缺失时，使用 catalog 与 shared defaults；
4. 调用扩展后的 `canvasApi.generateImage/Video`。

### 5.3 sceneComposer batch

`buildBatchGenerateItems` 增加 nodes/defaults 上下文：

1. 根据 `imageNodeId` / `videoNodeId` 定位媒体子节点；
2. 读取模型和参数；
3. 若导演台未展开、ID 缺失或节点不存在，则使用 catalog 默认；
4. 每个 batch item 都携带已解析完成的显式配置。

本轮不新增导演台模型/参数 UI。需要逐镜头精细配置时，用户先展开子图并编辑媒体子节点。

---

## 6. 计费与失败语义

### 6.1 单价

| 类型 | 费用 |
| --- | ---: |
| image（固定 n=1） | 10 |
| video 5 秒 | 30 |
| video 10 秒 | 50 |
| video 15 秒 | 70 |

未知或缺失 duration 按默认 5 秒计 30。

### 6.2 单次生成

```text
鉴权 → 所有权校验 → 原子扣费 → 创建 Material → 异步 provider
```

- Provider 失败时 Material 标 `failed`；
- 已扣积分不退款，与 Studio 语义一致；
- 扣费或权限失败时不创建 Material、不调用 provider。

### 6.3 批量生成

```text
鉴权
  → session/全部 item 预检
  → 计算总费用
  → 一次原子扣费
  → 创建/更新全部 shot
  → 启动各 Material
```

- 余额不足：整批拒绝，零 Material、零 provider 调用；
- 扣费后单项异步失败：该项失败，其他项继续；
- 不做失败退款或部分退款。

---

## 7. 权限边界

### 7.1 必须校验

| 入口 | 校验 |
| --- | --- |
| Material image/video | shot → session → `session.userId` |
| sceneComposer save | 请求 session 属当前用户；已有 shot 必须属于该 session |
| sceneComposer batch | 同上；全部 item 在扣费前完成校验 |

不存在或非本人资源统一抛 `NotFoundException`（HTTP 404），不暴露资源是否存在。

### 7.2 本轮不扩张

Canvas 的 create/edit/reorder/status 等其他入口仍需单独安全审计。本规格不宣称完成全 Canvas 权限治理。

---

## 8. 测试策略

### 8.1 Server

#### PointsService

- 足额扣减并写负数流水；
- 不足时抛错且不写流水；
- 条件更新失败回滚，不产生负余额。

#### MaterialService

- image modelKey → provider modelId；
- aspectRatio + resolution → size；
- 始终 `n: 1`；
- video model/duration/aspectRatio/resolution 进入 provider；
- crop 遵循 adapter，不再手工拼 prompt；
- 5/10/15 秒费用分别为 30/50/70；
- 非本人 shot 不扣费、不建 Material、不调 provider；
- provider 成功/失败更新 Material 状态。

#### SceneComposerService

- 多项费用求和且只扣一次；
- 积分不足时零副作用；
- 每项配置传给 MaterialService；
- 已存在 shot 必须属于请求 session；
- 非本人 session 拒绝 save/batch；
- 单项异步失败不阻止其他项启动。

### 8.2 Web

- shot-linked image 传子节点 model/aspect/resolution/count=1；
- shot-linked video 传 model + 完整 videoSettings；
- shot 自身生成优先读取媒体子节点；
- 子节点缺失时取 catalog/shared 默认；
- sceneComposer 已展开时按媒体 node ID 读取配置；
- 未展开或节点丢失时使用默认；
- 独立 Studio image/video 路径不回归。

### 8.3 全量验收

```bash
pnpm install --frozen-lockfile
pnpm --filter @lnkpi/server exec prisma generate
pnpm build
pnpm test
```

手工验收补充到 `docs/DOCK_STUDIO_E2E_TRACKING.md`：

1. shot + image 子节点：选择非默认模型/分辨率后生成；
2. shot + video 子节点：选择模型/时长/比例/分辨率后生成；
3. 未展开 sceneComposer 批量生成走默认；
4. 已展开 sceneComposer 修改子节点配置后批量生成；
5. 余额不足时批量零启动；
6. 非本人 session/shot 请求被拒绝。

---

## 9. 验收标准

1. shot、shot-linked media、sceneComposer batch 均经过 C1 catalog + adapter。
2. 用户媒体子节点配置进入 Canvas API 和 provider；缺失时使用默认。
3. image Canvas 路径固定单图，不产生不可持久化的多余 URL。
4. Canvas 图/视频与 Studio 同价。
5. batch 整批预检并一次扣费。
6. 触达的生成/导演台入口执行所有权校验。
7. Material 异步状态与现有 polling 不退化。
8. C1 普通 Studio 路径不退化。
9. build + 全仓 tests 通过。
10. 跟踪文档登记 C2 状态及 C2.1/C3/C4 顺序。

---

## 10. 后续路线

```text
C2 adapter + model/params + billing
  → C2.1 T*/I* refs + mentionedKeys + prompt merge
  → C3 V* frame extraction / understanding
  → C4 A* ASR / voice reference
```

| 轮次 | 内容 | 依赖 |
| --- | --- | --- |
| C2 | 本规格：Canvas 旁路模型、参数、计费、权限 | C1 |
| C2.1 | shot/sceneComposer refs 消费与 prompt 合并 | C2 |
| C3 | V\* 抽帧/视频理解 | C2.1 |
| C4 | A\* ASR/音色参考 | C3 可并行评估 provider |

---

## 11. 实现交接

规格确认后：

1. 使用 `writing-plans` 生成逐任务实现计划；
2. 优先 TDD：PointsService → MaterialService → SceneComposer → Web payload；
3. 使用 Subagent-Driven 执行并逐任务 review；
4. 独立 PR，CI 全绿后 Squash & Merge；
5. C2 合入后再写 C2.1 规格，不与本 PR 混做。
