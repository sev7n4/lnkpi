# Fal H3 Max VideoProvider 最小接入设计

> 日期：2026-09-13  
> 状态：已批准（含 BYOK §3.5；实现计划见 `../plans/2026-09-13-fal-h3-max-video-min.md`）  
> 范围：**仅** fal 托管的 **H3 Max / H3 Max Turbo**，**T2V + I2V（含可选尾帧）**；Dock 模型可选；积分档位  
> 非目标：官方 MiniMax-H3 全能力（见姊妹规格）、H3 Max Director / fal.live 直播、Reference-to-Video、自托管开源权重  
> 前置：现有 `VideoProvider` / `videoModelProfiles` / `VideoDockPanel` / `videoCredits`；平台已用 `FAL_KEY`（SAM / ESRGAN）  
> 上游参考：[fal H3 Max](https://fal.ai/minimax-h3-max)、[MiniMax 视频说明中的 H3 Max](https://platform.minimax.io/docs/guides/video-generation)

## 0. 决策摘要

| 项 | 结论 |
|----|------|
| 接入通道 | **fal.ai**（`FAL_KEY`），不经 MiniMax 官网 |
| 模型 SKU | Dock 暴露 **2 个** catalog 项：`h3-max-turbo`（默认推荐）、`h3-max` |
| 能力 | **T2V**、**I2V**（单首帧）；**可选** `end_image_url` → 映射现有 Dock `first_last_frame`（若端点支持） |
| 不做 | Reference（图/视/音）、Context-IR、768→2K Regeneration、Director 连续直播 |
| Provider 类名 | `FalH3MaxVideoProvider`（实现 `VideoProvider`） |
| 路由 | `createVideoProvider`：识别 fal 网关或 modelKey ∈ `{h3-max, h3-max-turbo}`；凭证见 §3.5 BYOK |
| 积分 | 沿用 `chargeReason: '视频生成'`；**按时长档位**，并对 Max/Turbo **乘以分辨率系数**（见 §5）；公式进 `video-credits.ts` 扩展，禁止散落魔法数 |
| 人机同路径 | Studio / Material / Agent 视频生成共用同一 Provider |
| 凭证 | **平台 env + 用户 BYOK 双轨**（与 Agnes/Apimart 通道同一套 `apiKey`/`baseUrl`）；见 §3.5 |
| 能力发现 | 平台路径无 `FAL_KEY`、或 BYOK 通道无有效 Key 时：**不可生成 / 明确错误**（与 segment/upscale、现网 BYOK 一致） |

## 1. 背景与目标

网上「效率质变 / AI 直播」主要对应 **fal 后训练的 H3 Max 族**，不是裸 `MiniMax-H3`。本规格目标：在 lnkpi Dock **最快可选、可计费、可失败诊断**地接入 Max/Turbo，验证延迟与成本；不把直播写进一期。

成功标准：

- Dock 视频模型列表出现 H3 Max / Turbo；选中后可 T2V / I2V 出片。  
- 无 `FAL_KEY` 或 fal `TOP_UP` 锁定时，错误可读、积分退款。  
- 积分流水可区分模型（metadata 含 `providerId` / `modelKey` / `falEndpoint`）。

## 2. 范围

### 2.1 做

| 层 | 内容 |
|----|------|
| `@lnkpi/agent` | `FalH3MaxVideoProvider`；`createVideoProvider` 路由；单测 mock `fal.run` / queue |
| `@lnkpi/shared` | catalog 两项；`VideoModelProfile`（新 `refWire: 'fal_h3_max'`）；`videoModelCapabilities` 映射 |
| Nest | 现有 `generateVideo` 路径自动走到新 Provider；解析 `FAL_KEY`；失败退款 |
| Web Dock | 模型下拉可选；模式：文生视频 / 图生视频；（若 profile 开）首尾帧 |
| 积分 | 扩展 `videoCredits`（或 `videoCreditsForModel`） |

### 2.2 不做

- MiniMax 官网 API、`MINIMAX_API_KEY`  
- `minimax/h3/*` 裸 H3 端点（若需对照延迟，另开 spike，不进本规格交付）  
- Reference-to-video、Director、fal.live  
- 默认替换 `agnes-video-v2.0` / Seedance 为平台默认（本规格只 **新增可选**）

## 3. 上游契约（fal）

### 3.1 Endpoint（实现时以 fal 模型页为准，写入常量）

| catalog `modelKey` | 建议 fal endpoint（示意） | 用途 |
|--------------------|---------------------------|------|
| `h3-max-turbo` | `minimax/h3-max-turbo/text-to-video` / `.../image-to-video` | 低延迟优先 |
| `h3-max` | `minimax/h3-max/text-to-video` / `.../image-to-video` | 质量/对照 |

实现应用 **单一 subscribe/queue 客户端路径**：`Authorization: Key ${FAL_KEY}`，与 ESRGAN 同鉴权头格式。

### 3.2 输入映射

| Dock / `VideoGenerateOptions` | fal 字段 |
|-------------------------------|----------|
| `prompt` | `prompt` |
| `duration` | `duration`（整数秒；profile：Turbo/Max **5–15**） |
| `aspectRatio` | `aspect_ratio` |
| `resolution` | `resolution`（允许集：`480P` \| `768P`；**不上 2K**——Max 官方能力如此） |
| `image` / 单图 I2V | `image_url` |
| 首尾帧两图 | `image_url` + `end_image_url`（端点若不支持则 capability 关 `supportsFirstLastFrame`） |
| `promptExpansion`（可选 P1） | `prompt_expansion_mode`：默认 `balanced` 或关闭以省延迟 |

### 3.3 输出

- 成功：视频公网 URL → `{ url }`  
- 轮询：fal queue / subscribe；`pollIntervalMs` / `maxPollMs` 写入 profile（建议 poll 2s，max 10min，可按实测调）

### 3.4 错误

| 上游 | 产品表现 |
|------|----------|
| 401/403 `TOP_UP` / locked | 可读：「视频服务账户异常，请稍后重试或联系管理员」；**退款**（平台路径）；BYOK 路径按现网 BYOK 失败/退款策略 |
| 无有效 Key | 生成前明确错误（平台：「视频加速通道未配置」；BYOK：「通道未配置 API Key」） |
| 超时 | 失败 record + 退款（若已扣平台点） |

### 3.5 凭证：平台 env + 用户 BYOK

与现网 Provider 通道一致：**用户可在自定义 BYOK 设置中配置 `apiKey` + `baseUrl`**，不必只能用服务器环境变量。

| 选型 | 凭证来源 |
|------|----------|
| `platform::h3-max-turbo` / `platform::h3-max` | `process.env.FAL_KEY`；base 默认 `https://fal.run`（可用 `FAL_BASE_URL` 覆盖，可选） |
| 用户通道 `channelId::h3-max-turbo`（或同族 gateway） | 该通道加密存储的 **apiKey** + **baseUrl**（用户填写，如 `https://fal.run`） |

硬约束：

1. **`ProviderResolver.resolveForGeneration(..., 'video')` 已解析的 credentials 优先**；禁止平台路径写死只读 env 而忽略 BYOK。  
2. **鉴权头**：fal 使用 `Authorization: Key ${apiKey}`（与 ESRGAN/SAM 相同）；不要误用 Bearer。  
3. **baseUrl**：走现有 `safeOutboundUrl`（禁内网 SSRF）；允许用户填 fal 官方 host，禁止任意内网。  
4. **计费**：BYOK（`source === 'user'`）对齐现网 Seedance/视频 BYOK——**不另发明第三套**（通常不扣或少扣平台点；失败分类用现有 `classifyByokFailure`）。  
5. **能力边界不变**：BYOK 只换账号，不能解锁 Reference/Director（仍受本规格 §2.2 限制）。  
6. metadata 记录 `credentialSource: 'platform' | 'user'` 与 `channelId`（若有），便于排障。

## 4. 本仓库架构

```text
VideoDockPanel 选 h3-max-turbo + T2V/I2V
  → Studio/Material generateVideo
  → resolveVideoModelProfile → refWire=fal_h3_max
  → ProviderResolver → apiKey/baseUrl（platform FAL_KEY 或 BYOK 通道）
  → createVideoProvider({ apiKey, baseUrl, model })
  → FalH3MaxVideoProvider.generate
  → fal endpoint → url
  → GenerationRecord / Material（metadata: providerId=fal, modelKey, endpoint, duration, resolution, credentialSource）
```

### 4.1 `VideoModelProfile` 增量

```ts
// 语义示意
refWire: 'fal_h3_max'
sizeWire: 'ratio_duration'
responseMode: 'fal_queue'  // 或复用 async_task 若抽象允许
maxImageRefs: 2            // 首+尾；T2V=0
maxVideoRefs: 0
maxAudioRefs: 0
minDuration: 5
maxDuration: 15
allowedResolutions: ['480p', '768p']  // 内部规范小写；出站映射 480P/768P
allowedAspectRatios: ['16:9', '9:16', '1:1', /* fal 文档列出的其余 */]
defaultGenerateAudio: true // 若上游默认有声则 true；以模型页为准
```

### 4.2 Catalog

| modelKey | displayName | gatewayModelId |
|----------|-------------|----------------|
| `h3-max-turbo` | H3 Max Turbo (fal) | `minimax/h3-max-turbo`（逻辑 id，真正 HTTP path 分 T2V/I2V） |
| `h3-max` | H3 Max (fal) | `minimax/h3-max` |

`providerBinding`：新增 `'fal-http'` 或沿用扩展字段；**禁止**误路由到 Agnes/Apimart。

### 4.3 Capabilities（Dock 灰显）

```ts
supportsFirstLastFrame: true  // 仅当 I2V 端点支持 end_image
supportsKeyframes: false
supportsVideoRef: false
supportsAudioRef: false
supportsGenerateAudio: <profile>
supports4K: false
```

模式：仅展示 **文生视频 / 图生视频**；（首尾帧若支持则显示，与 Seedance 同 UX）。

## 5. 积分档位

现网 `videoCredits(duration)`：

| duration | 积分 |
|----------|------|
| &lt;10s | 30 |
| ≥10s | 50 |
| ≥15s | 70 |

**本规格扩展**为：

```ts
videoCreditsForModel({ duration, modelKey, resolution }): number
  base = videoCredits(duration)
  // H3 Max 族：相对 Seedance/Agnes 的上游 $/s 更低或更高时用系数校准
  // 锁定一期系数（可用正式价而非促销价估算）：
  //   turbo + 480p → ×1.0
  //   turbo + 768p → ×1.2
  //   max   + 480p → ×1.2
  //   max   + 768p → ×1.5
  // 非本族模型 → 仅 base
```

- `chargeReason` 仍为 **`视频生成`**（reason-map 已覆盖）。  
- metadata 必须含 `chargedPoints`、`modelKey`、`resolution`、`falEndpoint`。  
- **促销价不写入积分公式**；积分按上表正式系数；运营可用活动另调。

复盘触发：若 fal 正式价变动 &gt;20%，开 PR 只改系数表。

## 6. 安全与运维

- 密钥仅服务端 `FAL_KEY`。  
- 参考图须公网 HTTPS 或已有 inline 策略（复用 `inlineUpstreamReferenceImages`）。  
- 监控：成功率、p50/p95 墙钟、403 TOP_UP 计数。

## 7. 测试与验收

| 级 | 内容 |
|----|------|
| Provider 单测 | T2V/I2V body 映射；401/403 抛错文案 |
| Profile/capabilities | Dock 模式灰显正确 |
| Service | 扣点 / 退款；无 key；**BYOK 通道凭证优先于平台 env** |
| 手测 | 平台 FAL_KEY：Turbo 5s 768p；另建 BYOK 通道填自有 fal Key 再跑一条 |

## 8. PR 建议

单 PR：`feature/fal-h3-max-video-min` — Provider + catalog + credits + Dock 能力位。  
**不**与 MiniMax 官网全能力同 PR。

## 9. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-13 | 初稿：T2V/I2V 最小接入；与官网 H3 全能力规格拆分 |
| 2026-09-13 | 锁定 BYOK：用户通道可配 apiKey + baseUrl，与平台 FAL_KEY 双轨 |
