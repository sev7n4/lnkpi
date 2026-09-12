# Wave A · A1 OSS 直传（STS）+ 图像 Upscale 设计

> 日期：2026-09-12  
> 状态：已批准（对话确认 §1–§4；计划见 `../plans/2026-09-12-wave-a-a1-*.md`）  
> 上级纲领：[2026-09-10-wave-a-delivery-program-design.md](./2026-09-10-wave-a-delivery-program-design.md)  
> 前置：  
> - [2026-09-10-wave-a-a3-media-persist-design.md](./2026-09-10-wave-a-a3-media-persist-design.md)（`StorageAdapter` / COS 双轨）  
> - [2026-09-12-canvas-workflow-exchange-design.md](./2026-09-12-canvas-workflow-exchange-design.md)（A2 导出，本规格不改）  
> 跟踪：[../../DOCK_STUDIO_E2E_TRACKING.md](../../DOCK_STUDIO_E2E_TRACKING.md)（B-2 upscale、B-4 OSS STS）  
> 落地节奏：**方案 1** — 一份契约规格；**PR1 直传 → PR2 Upscale** 串行

## 1. 背景与目标

Wave A 北极星是成片交付。A3 已提供可插拔对象存储与收藏持久化；上传仍以 Nest 中转 `POST /api/upload`（含分片）为主。M4 / B-2、B-4 要求：浏览器直传 COS，以及图像放大（对标 Neo `material/upscale-image`）。

**本规格目标：**

1. **直传：** COS 已配置时，现有上传路径改为 **预签名 PUT**；未配置时保留本地 upload 兜底。  
2. **Upscale：** 独立 `UpscaleProvider`；UI 固定 2×；选中浮层 + 右键入口；人机同路径。  
3. **可发现：** `capabilities` 暴露直传与放大可用性，避免「有按钮无后端」。

**本规格明确裁剪（相对纲领 A1 全量）：** **不含 lip-sync、不含 worldModel**。Lip-sync 另开子规格。

## 2. 范围

### 2.1 做

| 块 | 内容 |
|----|------|
| 直传契约 | `POST /api/upload/direct-credential`；Presigned PUT；key 规则；前端 `uploadApi` 统一切换 |
| 双轨 | 与 A3 相同 env 判定；`mode=presign` \| `mode=local` |
| Upscale 抽象 | `UpscaleProvider`；Agnes 优先，否则现有体系能接尽接；规格列接入清单 |
| Upscale API | Nest service + `POST …/upscale-image`（或等价路径）；Agent tool 同 service |
| UI | 选中浮层「放大 \| 编辑」；右键同步「放大」；Dock 不挂放大 |
| 计费 | `chargeReason: '图像放大'`；价目 key `image_upscale`（或与单次图像生成同档，实现时写死一处） |
| Capabilities | `stsDirectUpload`、`imageUpscale` |

### 2.2 不做

- video lip-sync / worldModel  
- 向浏览器下发完整 STS 临时 AK/SK/Token（除非日后必须上官方分片 SDK；本期不实现）  
- 一期 multipart 预签名 / >50MB 直传  
- 用文生图 + 提示词「放大」冒充超分  
- Dock 主入口放大；浮层堆 backlog 假 disabled 行（变体、三视图、宫格、扩图、抠图 — **仅文档排期**）  
- 放大结果默认覆盖源节点 `data.url`  
- 锁死单一云厂商 SDK（必须走现有 S3 兼容 `StorageAdapter` 配置）  
- 任意新模型厂商大接入（仅接线现有 provider 体系内可验证能力）

### 2.3 已锁决策

| 主题 | 选择 |
|------|------|
| 规格形态 | 一份 A1 文档；实现 STS → Upscale 分 PR |
| 直传形态 | **预签名 PUT**（产品仍称 STS/直传能力） |
| 上传范围 | COS 已配：当前所有 `POST /upload` 调用点改经统一直传层；未配：本地兜底 |
| Upscale 算力 | 抽象 `UpscaleProvider`；**Agnes 能满足则只接 Agnes，否则能接尽接**；规格写清单 |
| 倍率 | UI 固定 **2×**；API 预留 `scale` `2\|4` |
| 入口 | 选中**浮层**为主 + 右键同步；Dock 干净 |
| 浮层 P0 | 仅 **放大** + **编辑（开 Refine）** |
| 结果落点 | 新建 image 节点 + 自源边；源节点不变 |

## 3. 架构

```text
┌─ Web ─────────────────────────────────────────┐
│  uploadApi → direct-credential                 │
│    → presign: PUT putUrl → publicUrl           │
│    → local: 现有 /upload（含分片）              │
│  选中浮层：放大 | 编辑                         │
│  Agent tool → 同一 Nest API                    │
└──────────────────────┬────────────────────────┘
                       ▼
┌─ Nest ────────────────────────────────────────┐
│  DirectUploadService（签发 / 双轨）             │
│  UpscaleService（扣点、调 UpscaleProvider）     │
│  StorageAdapter（A3；签发复用同一配置）         │
│  capabilities：stsDirectUpload / imageUpscale  │
└──────────────────────┬────────────────────────┘
                       ▼
         COS/S3 兼容  ·  Agnes(优先) / 其它已接 provider
```

原则：

1. **契约先行、双 PR 串行** — 直传可独立上线；Upscale 不依赖改上传语义，但大图受益于直传。  
2. **人机同路径** — UI 与 Agent 打同一 Nest service。  
3. **复用 A3 存储配置** — 不平行发明第二套 COS env。  
4. **Provider 隔离** — Upscale 不塞进 `ImageProvider.generate`，不复用带 mask 的 `ImageEditProvider`。

## 4. 直传（STS）契约

### 4.1 双轨判定

与 `createStorageAdapterFromEnv` 一致：

| 条件 | `direct-credential.mode` | 实际上传 |
|------|--------------------------|----------|
| `OBJECT_STORAGE_*` 完整 | `presign` | 浏览器 PUT 到对象存储 |
| 仅本地盘适配器 | `local` | 现有 `POST /upload`（含 init/chunk/complete） |
| `OBJECT_STORAGE_DRIVER=none` | 签发失败或强制 `local` 不可用 | 规格：**生产可关本地**；默认开发态若本地适配器存在则 `local` 仍可用 |

### 4.2 API

**`POST /api/upload/direct-credential`**（AuthGuard）

请求：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fileName` | string | 原始名（仅取扩展名） |
| `mimeType` | string | 绑定到 PUT `Content-Type` |
| `size` | number | 字节；上限与现网一致 **50MB** |

响应 `mode=presign`：

| 字段 | 说明 |
|------|------|
| `mode` | `"presign"` |
| `key` | 对象键 |
| `putUrl` | 短时 PUT URL |
| `headers` | 客户端必须带的头（至少 `Content-Type`） |
| `expiresAt` | ISO 过期时间 |
| `publicUrl` | 成功后可读 URL（与 A3 `publicBaseUrl` 规则一致） |

响应 `mode=local`：

| 字段 | 说明 |
|------|------|
| `mode` | `"local"` |
| （无 putUrl） | 前端改走现有 upload 路径 |

**P0 不强制** `direct-complete` 回调；以 PUT 成功 + `publicUrl` 挂节点/资产为准。P1 可加 complete 仅用于记账/校验。

### 4.3 Key 规则

```text
uploads/{userId}/{yyyy}/{mm}/{dd}/{timestamp}-{uuid8}{ext}
```

- 仅签发当前用户 `userId` 前缀；禁止客户端自选任意 key。  
- 单对象单次 PUT；**一期不做** multipart 预签名。  
- TTL 建议 **5–15 分钟**（实现取中值并单测）。

### 4.4 前端

统一入口：`apps/web/src/services/upload-api.ts`（及 `useMediaUpload` / Dock 本地图上传等所有现网 `/upload` 调用点）：

```text
POST direct-credential
  → mode=presign → fetch PUT putUrl（headers）→ 返回 { url: publicUrl }
  → mode=local  → 现有 multipart / chunked
```

禁止半直传半中转的分叉调用点。

### 4.5 Capabilities

- `stsDirectUpload === true` 当且仅当可签发 `mode=presign`。  
- UI **不**因 false 隐藏上传；仅诊断 / Agent 探测。

### 4.6 安全

- 短 TTL；PUT 绑定 Content-Type + 指定 key。  
- 不向浏览器下发永久密钥或宽权限临时密钥。  
- 不能为其他 `userId` 签发 key。

## 5. Upscale

### 5.1 Provider 接口（语义）

```ts
interface UpscaleProvider {
  readonly id: string
  upscale(input: {
    imageUrl: string
    scale: 2 | 4
  }): Promise<{ url: string; providerId: string; modelId?: string }>
}
```

工厂 / 注册表在启动或首次请求时挂载**已探测可用**的实现；运行时选默认实现（Agnes 优先）。

### 5.2 接线策略

1. **探测 Agnes：** 现有 platform 凭证下，是否存在稳定「输入图 URL + scale → 更高分辨率图」能力（原生超分 API 或官方明确的 upscale 模型）。  
2. **若满足 → 一期只注册 `AgnesUpscaleProvider`。**  
3. **否则 →** 在现有图像通道（APIMart / 已接编辑同凭证等）能接尽接，每实现一类。  
4. **禁止** 文生图口头「放大」冒充。  
5. UI 固定传 `scale=2`；API 允许 `2|4`；**无 4× 实现时返回明确 400/501，禁止静默降为 2。**

### 5.3 接入清单（实现时填实，禁止留空合并）

| providerId | 状态 | 探测结论 | 备注 |
|------------|------|----------|------|
| `agnes` | 未接入 | **不满足**（2026-09-12）：官方文档仅有 `POST /v1/images/generations` 文生图 / 图生图（`extra_body.image` + prompt），无独立超分端点、无 upscale 模型名；用 prompt「放大」冒充超分被本规格禁止 | 优先探测；不注册 |
| `fal` | **已接入** | Agnes 不满足后接线现有 `FAL_KEY` 通道：`POST https://fal.run/fal-ai/esrgan`，body `{ image_url, scale: 2\|4 }`，返回 `image.url`（Real-ESRGAN，非文生图） | `modelId`: `fal-ai/esrgan`；与 Segment SAM 同凭证栈；支持 2× 与 4× |

合并 PR2 时本表必须与代码注册表一致；建议单测断言注册 id 列表 ⊆ 本表「已接入」行。

### 5.4 API

对标 Neo：`POST /agent/canvas/material/upscale-image`（若现网路由习惯在 `studio`，允许等价路径，但 **Agent tool 与 UI 必须打同一 service**）。

| 字段 | 说明 |
|------|------|
| `sessionId` | 画布会话；归属校验 |
| `nodeId?` | 有则取节点图 URL |
| `imageUrl?` | 与 nodeId 至少其一；有 nodeId 时以服务端解析为准 |
| `scale?` | 默认 `2`；`2\|4` |
| `provider?` | 可选覆盖；默认自动选 |

成功：`{ url, scale, providerId, recordId? }`；写 record `type: 'image_upscale'`（或 material 等价）。  
失败：按生成/精修模式 **退款**；错误可读（无 provider / 上游失败 / 积分不足 / URL 非法）。

### 5.5 计费

- `chargeReason: '图像放大'`。  
- **`reason-map`：** 将「图像放大」纳入与 `图像生成|图像精修` 同类的 `image` category（改 `CATEGORY_BY_LABEL` 正则或等价表项）。  
- 成本：读取价目 **`image_upscale`**；若价目尚未建行，**与单次「图像生成」同档**，并在实现 PR 中只改一处常量/表项。  
- BYOK：与现有图像生成/精修策略一致。

### 5.6 画布落点

```text
选中图像节点 → 放大
  → UpscaleService
  → 成功：新建 image 节点（url=结果）+ 边 source→new
  → 源节点 data.url 不变
```

「编辑」打开现有 Refine（与右键「编辑图像」同路径），与放大正交。

### 5.7 Agent

- Tool（名建议 `upscale_image`，可微调）调用同一 Upscale service。  
- 返回 URL；建节点方式与现有 generate/harness 惯例一致（规格不发明第二套画布写入协议）。

### 5.8 Capabilities

- `imageUpscale === true` ⇔ 至少一个 UpscaleProvider 已注册且凭证可用。  
- 浮层/右键「放大」在 false 时：**disabled + tooltip**（不隐藏）。

## 6. UI

### 6.1 选中浮层（主入口）

- **出现条件：** 单选 + 可放大图像节点（判定与 Refine 的 `canOpenRefineForNode` **对齐**，抽共享 helper 或规格写死同一谓词）。  
- **多选：** 不出现。  
- **挂载：** 贴节点（可参考 `NodeEditorToolbarOverlay` 节点坐标系），避免挡主体预览。  
- **P0 按钮：** 放大｜编辑。  
- **放大进行中：** loading、防连点；失败 toast，源不变。

### 6.2 右键

- `CanvasContextMenu` 在「编辑图像」旁增加「放大」；**同一 handler**。  
- 建议顺序：放大 → 编辑图像 → 其余不变。

### 6.3 Dock

- **不**增加放大主按钮/芯片。  
- Backlog（仅文档，非 P0 UI）：变体、产品/角色三视图、宫格、扩图、抠图 — 后续规格排期，本 PR 不出现假 disabled 行。

## 7. 错误与诊断

| 场景 | 表现 |
|------|------|
| 无 UpscaleProvider | 按钮 disabled + tooltip；API 明确 501/503 |
| 积分不足 | 与生成一致提示；不建节点 |
| 上游失败/超时 | toast + 退款；可选 failed record |
| 源 URL 非图/失效 | 400 + 可读文案 |
| 直传 PUT 失败 | 可重签一次凭证后重试；仍失败则明确错误 |
| COS 未配 | 上传 `mode=local`；不阻断放大（放大依赖可访问 `imageUrl`） |
| `scale=4` 无实现 | 400/501，不静默改 2 |

## 8. 测试

### PR1 直传

- 签发：key 含 `userId`；无 COS → `mode=local`。  
- 安全：不能为他人签发。  
- 前端：`uploadApi` mock presign 走 PUT；local 回归 multipart/chunk。  
- 资产库 / Dock / mediaInput 上传路径冒烟。

### PR2 Upscale

- Provider 单测（mock 上游）。  
- Service：扣点、退款、无 provider、`scale=4` 无实现。  
- UI：浮层两钮、disabled、成功新节点+边。  
- Agent tool → 同一 service。  
- 注册表 id ⊆ 规格接入清单「已接入」行。

## 9. PR 拆分与验收

| PR | 交付 | 验收要点 |
|----|------|----------|
| **PR1** | 直传契约 + `uploadApi` 切换 + capabilities `stsDirectUpload` | COS 环境 Network 可见对存储的 PUT，Nest 不收完整文件体；无 COS 仍上传成功得 `/api/uploads/...` |
| **PR2** | UpscaleProvider + API + 浮层/右键 + Agent + `imageUpscale` + 接入清单填实 | 放大出新节点；无 provider 时 disabled；积分正确 |

## 10. 成功标准（收口）

- [ ] COS 配置下上传主路径为预签名 PUT；本地仅为兜底  
- [ ] 图像可 2× 放大；入口在浮层+右键；Dock 无放大主入口  
- [ ] UI 与 Agent 同 Nest 路径  
- [ ] capabilities 可探测；失败可诊断  
- [ ] 接入清单与代码一致  
- [ ] 无 lip-sync / worldModel / 完整 STS Token 下发误入本规格 PR  

## 11. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-12 | 初稿：对话确认架构、直传、Upscale、UI；方案 1 双 PR |
