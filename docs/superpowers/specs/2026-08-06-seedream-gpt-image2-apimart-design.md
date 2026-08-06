# Seedream 5.0 Pro / GPT Image2（APIMart）图像生成补全规格

> 状态：**规格已定 / 开发中**  
> 日期：2026-08-06  
> 范围：补齐 `seedream-5.0-pro`、`image2`（GPT Image2）在 APIMart 聚合网关下的 **native 参考图、比例分辨率、异步任务、prompt 一致性** 全链路  
> 前置：`2026-07-19-dock-studio-model-adapter-design.md`（C1 适配层）、PR #155（Agnes img2img native refs）  
> 参考文档：  
> - [APIMart GPT-Image-2 Official](https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/official)  
> - [APIMart GPT-Image-2](https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md)  
> - [APIMart Seedream-5.0-Pro](https://docs.apimart.ai/cn/api-reference/images/seedream-5-0-pro)  
> - [OpenAI Image Generation Guide](https://developers.openai.com/api/docs/guides/image-generation)

---

## 0. 决策摘要

| 项 | 结论 |
|---|---|
| 网关 | 暂定 **APIMart** `https://api.apimart.ai/v1`（与现有 `OPENAI_BASE_URL` 兼容层一致） |
| GPT Image2 catalog | `image2` → gateway `gpt-image-2-official` |
| Seedream catalog | `seedream-5.0-pro` → gateway `doubao-seedream-5-0-pro` |
| 参考图 wire | APIMart 模型走 **`image_urls[]` 顶层字段**（非 Agnes 的 `extra_body.image`） |
| 尺寸 wire | APIMart 模型走 **`size` 比例 + `resolution` 档位**（非 `1024x576` 像素串） |
| 响应模式 | APIMart 两模型均为 **async task**：POST 返回 `task_id` → `GET /v1/tasks/{id}` 轮询 |
| 一致性 prompt | 有 I* 时统一追加 **【参考图一致性】** 约束块（单图/多图） |
| 内网 upload URL | 生成前须公网 HTTPS 或 Data URI；否则上游拒拉（与 Agnes 相同约束） |
| 明确不做 | OpenAI 直连 `/images/edits` multipart；Seedream 交互编辑坐标；mask inpainting UI |

---

## 1. 问题与缺口（现状）

| 缺口 | 影响 |
|---|---|
| adapter 仅 `agnes-image-*` 走 native refs | Seedream / Image2 参考图不进 API |
| provider 仅 Agnes 写 `extra_body.image` | APIMart 需要 `image_urls[]` |
| `resolveImageSize()` 输出像素串 | APIMart 要求 `16:9` + `2K`，易 400 |
| 同步 `data[].url` 解析 | APIMart 返回 `task_id`，当前链路直接失败 |
| catalog `gatewayModelId` 与上游不一致 | 平台/BYOK 模型名无法命中 APIMart |
| `IMAGE_FAST_PATH_MS=3s` | 异步模型（90–160s）永远走不到 completed |
| 无单图一致性 prompt 兜底 | 强模型仍可能偏离参考图主体 |

---

## 2. 上游协议摘要

### 2.1 GPT Image2（APIMart official）

```json
{
  "model": "gpt-image-2-official",
  "prompt": "...",
  "size": "16:9",
  "resolution": "2k",
  "quality": "high",
  "n": 1,
  "image_urls": ["https://.../a.png", "https://.../b.png"]
}
```

- 参考图：最多 **16** 张，`image_urls[]`
- 比例：`size` = `1:1`…`21:9` / `auto`
- 分辨率：`1k` / `2k` / `4k`（小写）
- `n`：1–4
- 不支持透明背景
- 异步：`data[0].task_id` → 轮询 → `data.result.images[0].url[0]`

### 2.2 Seedream 5.0 Pro（APIMart）

```json
{
  "model": "doubao-seedream-5-0-pro",
  "prompt": "...",
  "size": "16:9",
  "resolution": "2K",
  "image_urls": ["https://.../ref.jpg"],
  "output_format": "png"
}
```

- 参考图：最多 **10** 张
- 分辨率：仅 **1K / 2K**（`2K` 大写）；4K 请求须降级
- **`n > 1` 直接 400**；UI/adapter 强制 `n=1`
- 异步：1K ~90s、2K ~160s；轮询超时建议 **5 分钟**

### 2.3 Agnes（已实现，保持不变）

- `extra_body.image[]` + 同步 URL
- 像素 `size` 字符串

---

## 3. 架构：Image Model Profile

在 `@lnkpi/shared` 新增 **按 modelKey/gatewayModelId 解析的 profile**，供 adapter 与 provider 共用：

```typescript
type ImageRefWire = 'none' | 'agnes_extra_body' | 'apimart_image_urls' | 'legacy_prompt_tags'
type ImageSizeWire = 'pixel' | 'ratio_resolution'
type ImageResponseMode = 'sync_url' | 'async_task'

interface ImageModelProfile {
  refWire: ImageRefWire
  sizeWire: ImageSizeWire
  responseMode: ImageResponseMode
  gatewayModelId: string
  maxRefs: number
  maxN: number
  allowedResolutions: ImageResolutionTier[]
  resolutionCase: 'lower' | 'upper'  // gpt: 2k, seedream: 2K
  pollIntervalMs: number
  maxPollMs: number
}
```

### 3.1 Profile 映射表

| modelKey / 模式 | gatewayModelId | refWire | sizeWire | response | maxRefs | maxN | resolutions |
|---|---|---|---|---|---|---|---|
| `agnes-image-*` | 同名 | `agnes_extra_body` | `pixel` | `sync_url` | 16 | 4 | 1K/2K/4K |
| `image2`, `gpt-image-2*` | `gpt-image-2-official` | `apimart_image_urls` | `ratio_resolution` | `async_task` | 16 | 4 | 1K/2K/4K |
| `seedream-5.0-pro`, `doubao-seedream-*` | `doubao-seedream-5-0-pro` | `apimart_image_urls` | `ratio_resolution` | `async_task` | 10 | 1 | 1K/2K |
| 其他 legacy | catalog 默认 | `legacy_prompt_tags` | `pixel` | `sync_url` | 16 | 4 | 1K/2K/4K |

### 3.2 Adapter 输出（`buildImageProviderOptions`）

扩展入参：`aspectRatio`、`resolution`（替代仅传 pixel size）。

扩展出参与 metadata：

- `refImageMode: 'native' | 'primary_image' | 'none'` — APIMart + Agnes 均为 **`native`**
- `responseMode: 'sync_url' | 'async_task'`
- `refWire: ImageRefWire`
- `nativeParams`: 完整 provider body 字段（`model`, `size`, `resolution`, `quality`, `image_urls` 等）
- `providerOptions`: 传给 `createImageProvider().generate()` 的结构化选项

### 3.3 Prompt 构建（`buildEffectiveImagePrompt`）

1. **native ref**（Agnes + APIMart）：不写 `[ref-image:URL]`
2. **legacy**：I1 标签 + I2+ suffix
3. **一律**：有 I* 时追加 `buildImageRefConsistencyBlock(imageRefs)`

### 3.4 Provider（`OpenAIImageProvider` 增强）

**请求体：**

| refWire | 参考图字段 |
|---|---|
| `agnes_extra_body` | `extra_body: { image: refs, response_format: 'url' }` |
| `apimart_image_urls` | `image_urls: refs` |
| `legacy_prompt_tags` | 不传 refs（已在 prompt） |

**响应：**

| responseMode | 行为 |
|---|---|
| `sync_url` | 解析 `data[].url`（现有） |
| `async_task` | 解析 `data[0].task_id` → 轮询 `GET {baseUrl}/tasks/{id}` → `result.images[0].url[0]` |

轮询：间隔 8s，总超时 Seedream 300s / GPT Image2 360s。

### 3.5 Server 层

- `generateImage` / material image：`buildImageProviderOptions({ aspectRatio, resolution, ... })`
- **async 模型**：不走 `IMAGE_FAST_PATH_MS` race，立即返回 `generating` record
- `completeImage`：传入 `providerOptions`（含 resolution、refWire、responseMode、quality）
- 平台回退：`refImageMode === 'native'` 时 strip legacy tags 并传 `referenceImages`

---

## 4. Catalog 变更

```typescript
// image2
gatewayModelId: 'gpt-image-2-official'
params: { model, size, resolution, n, quality, refImages: 'native' }

// seedream-5.0-pro
gatewayModelId: 'doubao-seedream-5-0-pro'
params: { model, size, resolution, refImages: 'native', n: 'metadataOnly' }
defaults: { resolution: '2K' }
```

---

## 5. 参数 clamp 规则

| 模型 | 规则 |
|---|---|
| Seedream | `n` 强制 1；`resolution` 4K→2K 并记 droppedFields |
| GPT Image2 | `n` clamp 1–4；`quality` 默认 `high`（可选 native） |
| 共用 | refs 超过 maxRefs 截断并记 metadata；比例不在白名单则回退 `16:9` |

---

## 6. 验收标准

1. **Seedream 单图参考**：`nativeParams.image_urls` 含公网 URL；prompt 含一致性块；metadata `responseMode=async_task`；轮询完成后 `url` 非空。  
2. **Seedream 多图（≤10）**：全部进 `image_urls[]`；无 `[ref-image:]` 标签。  
3. **GPT Image2 多图（≤16）**：同上；`resolution`/`size` 为比例档位而非像素。  
4. **Seedream n=2 请求**：adapter 降为 n=1，不 400。  
5. **Agnes 回归**：`extra_body.image` 行为不变。  
6. **legacy 模型**（navo/mj）：仍走 prompt 标签降级。  
7. **单元测试**：profile 解析、adapter nativeParams、provider body、async poll mock。  
8. **`pnpm build` + agent tests 全绿**。

---

## 7. 分阶段实施（与本 PR 对应）

| Phase | 内容 | 文件 |
|---|---|---|
| P0 | ImageModelProfile + catalog gateway 映射 | `shared/imageModelProfiles.ts`, `studioModelCatalog.ts` |
| P1 | adapter ratio/resolution + native image_urls | `generation-adapter.ts` |
| P2 | provider async poll + image_urls / extra_body 分支 | `image-provider.ts` |
| P3 | server 传参 + async 跳过 fast path + 回退 | `studio.service.ts`, `material.service.ts` |
| P4 | 一致性 prompt + mergeRefs 图片感知 | `generation-adapter.ts`, `merge-refs.ts` |
| P5 | 测试与 build 验证 | `*.test.ts` |

---

## 8. 非目标（后续轮次）

- OpenAI 官方直连 `api.openai.com` 的 `/images/edits` multipart provider  
- APIMart `mask_url` inpainting UI  
- Seedream 坐标/框选交互编辑 prompt 模板  
- 内网 upload 自动 CDN 转换（独立任务）
