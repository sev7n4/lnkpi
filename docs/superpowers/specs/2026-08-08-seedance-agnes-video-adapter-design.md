# Seedance 2.0 / agnes-video-v2.0 视频生成对接规格

> 状态：**规格已定 / 待开发**  
> 日期：2026-08-08  
> 实施计划：`docs/superpowers/plans/2026-08-08-seedance-agnes-video-adapter.md`  
> 范围：补齐 `agnes-video-v2.0`、`seedance-2.0-min` 在 Agnes / APIMart 网关下的 **native 参考图/视频/音频、多模态 @ 占位符、异步任务、引用一致性** 全链路  
> 前置：`2026-07-19-dock-studio-model-adapter-design.md`（C1 适配层）、`2026-08-06-seedream-gpt-image2-apimart-design.md`（ImageModelProfile 先例）  
> 后续：`2026-07-19-dock-studio-model-adapter-design.md` **C3**（V* 抽帧/理解增强，本规格先消费 V*/A* URL 引用）  
> 参考文档：  
> - [Agnes Video V2.0](https://wiki.agnes-ai.com/en/docs/agnes-video-v20)  
> - [APIMart doubao-seedance-2.0](https://docs.apimart.ai/en/api-reference/videos/doubao-seedance-2.0)  
> - [fal Seedance 2.0 reference-to-video](https://fal.ai/models/bytedance/seedance-2.0/reference-to-video)

---

## 0. 决策摘要

| 项 | 结论 |
|---|---|
| 本轮代号 | **C3-video**（C1 视频最小路径的补全；与 C3 V* 抽帧理解可并行但本规格不依赖抽帧） |
| Agnes 网关 | 继续 `AgnesVideoProvider`；扩展 keyframes / seed / negative_prompt |
| Seedance 网关 | 新增 **APIMart Video Provider**：`POST /v1/videos/generations` → task 轮询 |
| catalog 映射 | `seedance-2.0-min` → gateway `doubao-seedance-2.0-mini` |
| 参考图 wire（Agnes） | 单图 `image`；多图（≥2）→ `extra_body.image[]` + `extra_body.mode: keyframes` |
| 参考图 wire（Seedance） | `image_urls[]` + prompt 中 `@Image1`…`@ImageN`（1-based，与数组顺序一致） |
| 参考视频 wire（Seedance） | `video_urls[]` + prompt 中 `@Video1`…（**本轮新增 V* 消费**） |
| 参考音频 wire（Seedance） | `audio_urls[]` + prompt 中 `@Audio1`…（须配合 I* 或 V*；**本轮新增 A* 消费**） |
| 首尾帧模式 | Seedance `image_with_roles`（`first_frame` / `last_frame`）；detect 或 UI 扩展 `first_last_frame` |
| 一致性 prompt | 有 I* 时追加 **【参考图一致性】** 块；Seedance 多模态时由 adapter 注入 `@ImageN` / `@VideoN` / `@AudioN` |
| 内网 upload URL | 生成前须公网 HTTPS 或 Data URI（与图像链路相同 `inlineUpstreamReferenceImages`） |
| 明确不做 | fal 直连 SDK；Seedance `asset://` 虚拟资产库；web_search tools；4K 视频；shot/scene composer 旁路统一（C2） |

---

## 1. 问题与缺口（现状调研结论）

### 1.1 能力利用率评估

| 模型 | 估算利用率 | 说明 |
|---|---|---|
| `agnes-video-v2.0`（Agnes 网关） | ~40% | 文生视频 + 单图 i2v + 基础分辨率/时长可用；关键帧、seed、negative_prompt 未用 |
| `seedance-2.0-min`（Apimart/通用网关） | ~0–5% | 无真实 Provider；非 Agnes baseUrl 走 `OpenAIVideoProvider` → **Unsplash 占位** |
| 引用一致性 | 偏低 | 多 I* 降级为 `[ref-image:url]` prompt tag；V*/A* 完全未消费 |

### 1.2 代码级缺口

| 缺口 | 位置 | 影响 |
|---|---|---|
| 无 Seedance / APIMart Video Provider | `video-provider.ts` | BYOK Apimart 选 Seedance 返回假视频 |
| Provider 路由仅识别 Agnes baseUrl | `createVideoProvider()` | 平台若走 Apimart 则 Seedance 不可用 |
| 视频无 per-model profile | 缺 `videoModelProfiles.ts` | 无法像图像一样分流 refWire / responseMode |
| 多 I* 仅首张 → `options.image` | `buildVideoProviderOptions()` | Agnes keyframes / Seedance `image_urls` 均未用 |
| 额外 I* → `[ref-image:url]` 拼 prompt | 同上 | 上游不识别该格式；Seedance 需 `@ImageN` |
| `extractReferenceImages` 只取 `mediaType === 'image'` | `studio.service.ts`, `material.service.ts` | **V* / A* 引用被丢弃** |
| video merge 不传 `imageRefs` | `resolveMergedPrompt()` | 多 I* 一致性仅靠 T* 文本合并 |
| 未传 seed / negative_prompt / generate_audio | `AgnesVideoProvider`, adapter | 上游支持的可复现/有声视频未释放 |
| catalog `gatewayModelId` 与 APIMart 不一致 | `studioModelCatalog.ts` | `seedance-2.0-min` ≠ `doubao-seedance-2.0-mini` |
| metadata 缺 refWire / responseMode | video 生成 metadata | 可观测性不足，难排障 |

### 1.3 平台默认路径

`.env.production.example` 配置 `OPENAI_VIDEO_MODEL=agnes-video-v2.0` + Agnes 网关 → **主路径 Agnes 可用**。目录中 Seedance 可选但后端未真正打通。

---

## 2. 上游模型关键参数分析

> 本节按「参数 → 约束 → 对一致性的作用 → 本项目是否已传」组织，作为 adapter/profile 设计的依据。

### 2.1 agnes-video-v2.0

#### 2.1.1 参数全景

| 参数 | 必填 | 取值 / 约束 | 对生成质量的作用 | 一致性相关 | 项目现状 |
|---|---|---|---|---|---|
| `model` | ✓ | `agnes-video-v2.0` | — | — | ✅ 已传 |
| `prompt` | ✓ | 自然语言 | 主体/动作/镜头/风格的主控 | 多图时须写清过渡关系 | ✅ 已传（含 T* merge） |
| `image` | — | 公网 HTTPS URL | 单图 i2v 首帧锚定 | **强**：锁定主体外观 | ✅ 仅首张 I* |
| `width`, `height` | — | 8 对齐；API normalize 到 480p/720p/1080p | 输出档位与构图 | 与参考图比例不一致时会 remap | ✅ 由 duration/ratio/resolution 换算 |
| `num_frames` | — | ≤441，**8n+1** | 控制时长与运动幅度 | 越长越易漂移 | ✅ 由 duration 推算 |
| `frame_rate` | — | 1–60，推荐 24/30 | 流畅度；影响实际秒数 | 同 frames 下 fps↑ → 时长↓ | ✅ 固定 24 |
| `seed` | — | 整数 | 弱复现 | 同 seed 结果相近非完全相同 | ❌ 未传 |
| `negative_prompt` | — | 字符串 | 排除水印/畸变/多余肢体等 | 减少主体崩坏 | ❌ 未传 |
| `mode` | — | `ti2vid` / `keyframes` | 区分单图动画 vs 多帧过渡 | keyframes 模式是多图一致性的**原生路径** | ❌ 未传 |
| `extra_body.image[]` | — | URL 数组 | 多关键帧输入 | **强**：帧间身份/构图约束 | ❌ 未传 |
| `extra_body.mode` | — | `keyframes` | 启用关键帧工作流 | 与 `extra_body.image` 配套 | ❌ 未传 |

#### 2.1.2 时长映射（本项目 UI → 上游）

UI `VideoSettings.duration` 为 **5 / 10 / 15 秒**（`clampVideoDuration` 5–15）。Adapter 换算规则（保持现有 `resolveVideoParams` 逻辑）：

| UI duration | frame_rate | num_frames | 实际秒数 |
|---|---|---|---|
| 5 | 24 | 121 | ≈5.04s |
| 10 | 24 | 241 | ≈10.04s |
| 15 | 24 | 361 | ≈15.04s |

> 注意：响应中的 `seconds` / `size` / `metadata.size_mapping` 为**权威值**；请求 width/height 可能被 normalize。

#### 2.1.3 分辨率 / 比例映射

| UI resolution | UI aspectRatio | 长边策略（现有实现） | Agnes 档位 |
|---|---|---|---|
| 480p | 16:9 | longEdge=854 | ~480p |
| 720p | 16:9 | longEdge=1280 | ~720p |
| 1080p | 16:9 | longEdge=1920 | ~1080p |
| * | 9:16 / 1:1 | 长边赋给竖边或正方形边 | 按官方 normalize |

Agnes 额外支持 **4:3 / 3:4**；本项目 UI 暂未暴露，adapter 可预留、P6 再开。

#### 2.1.4 引用模式决策树（Agnes）

```text
I* 数量 = 0  →  纯文生视频（不传 image / extra_body）
I* 数量 = 1  →  image: I1.url + prompt 描述动作/镜头稳定
I* 数量 ≥ 2  →  extra_body: { image: [I1..In], mode: 'keyframes' }
               prompt 强调 smooth transition + identity consistency
               不传顶层 image
V* / A*      →  本轮不支持（Agnes 无 video_urls/audio_urls）
```

---

### 2.2 Seedance 2.0（APIMart：`doubao-seedance-2.0-mini`）

#### 2.2.1 参数全景

| 参数 | 必填 | 取值 / 约束 | 对生成质量的作用 | 一致性相关 | 项目现状 |
|---|---|---|---|---|---|
| `model` | ✓ | `doubao-seedance-2.0-mini` 等 | — | — | ❌ gateway id 错误 + 无 provider |
| `prompt` | △ | 文生必填；i2v 可简短 | 主控叙事、镜头、时间线 | 多模态时**必须**用 `@ImageN` 指代引用 | ⚠️ 无 @ 注入 |
| `duration` | — | **4–15** 整数秒 | 镜头节奏 | 长 prompt + 长 duration 易丢细节 | ⚠️ UI 最小 5s |
| `size` | — | `16:9`…`21:9`, `adaptive` | 画幅 | i2v 可用 `adaptive` 跟随参考图 | ⚠️ wire 字段名应为 `size` 非 aspectRatio |
| `resolution` | — | 480p/720p/1080p | 清晰度；1080p 仅 standard 版 | mini 建议 720p | ⚠️ 已标记 native 但未发出 |
| `generate_audio` | — | bool，默认 true | 环境音/对白/口型 | 与 `@AudioN` 可叠加 | ❌ 未传 |
| `seed` | — | int | 弱复现 | 分镜重试时可固定 | ❌ 未传 |
| `return_last_frame` | — | bool | 返回末帧 PNG URL | **连续分镜**衔接 | ❌ 未传 |
| `image_urls` | — | ≤9 URL | 角色/产品/风格参考 | `@Image1` = `[0]` | ❌ 未传 |
| `image_with_roles` | — | `{url, role}`[] | 首尾帧 / 人像参考 | `first_frame`+`last_frame` 锁定起止 | ❌ 未传 |
| `video_urls` | — | ≤3，总 1.8–15.2s，480–720p | 运镜/动作/风格迁移 | `@Video1` = `[0]` | ❌ V* 未消费 |
| `audio_urls` | — | ≤3，总 ≤15s | BGM/对白参考 | `@Audio1`；**须**有 I* 或 V* | ❌ A* 未消费 |

#### 2.2.2 互斥与组合矩阵

| 组合 | 是否允许 | 说明 |
|---|---|---|
| `image_urls` + `image_with_roles` | ✗ | 二选一 |
| `image_with_roles` + `video_urls` / `audio_urls` | ✗ | 首尾帧模式隔离 |
| 仅 `audio_urls`（无 I*/V*） | ✗ | 上游拒绝；本项目须预检阻断 |
| `image_urls` + `video_urls` + `audio_urls` | ✓ | 全模态；prompt 须分角色描述 |
| 文生视频（无 refs） | ✓ | 仅 prompt + duration/size/resolution |

#### 2.2.3 @ 占位符与数组下标（核心一致性机制）

| 占位符 | 对应字段 | 下标规则 | prompt 写法示例 |
|---|---|---|---|
| `@Image1` | `image_urls[0]` | **1-based** | `@Image1 中的模特缓慢转身，保持面部特征不变` |
| `@Image2` | `image_urls[1]` | 1-based | `产品特写参考 @Image2 的包装细节` |
| `@Video1` | `video_urls[0]` | 1-based | `运镜方式参考 @Video1 的推拉节奏` |
| `@Audio1` | `audio_urls[0]` | 1-based | `背景音乐使用 @Audio1，口型与对白同步` |
| `@图片1` | 同 `@Image1` | 中文别名 | 可选支持，低优先级 |

**反模式（当前项目）：** 把 URL 写入 `[ref-image:https://...]` — Seedance **不解析**，等于丢引用。

#### 2.2.4 模型变体选型

| gateway id | 适用场景 | 本项目 catalog |
|---|---|---|
| `doubao-seedance-2.0-mini` | 默认、成本友好 | `seedance-2.0-min` ✅ |
| `doubao-seedance-2.0-fast` | 预览/迭代 | 后续可选 BYOK |
| `doubao-seedance-2.0` | 1080p / 4K / asset:// | 非 mini 档位，后续扩展 |

---

### 2.3 双模型关键差异对照

| 维度 | agnes-video-v2.0 | Seedance 2.0 mini |
|---|---|---|
| 时长表达 | `num_frames` + `frame_rate` | `duration` 秒 |
| 比例表达 | `width` + `height`（像素） | `size` 比例字符串 |
| 单图 i2v | `image` | `image_urls[0]` + `@Image1` |
| 多图 | `extra_body.image[]` keyframes | `image_urls[]` + `@ImageN` |
| 视频引用 | ✗ | `video_urls[]` + `@VideoN` |
| 音频引用 | ✗ | `audio_urls[]` + `@AudioN` |
| 首尾帧 | keyframes 模式（多图过渡） | `image_with_roles` |
| 有声视频 | 无独立开关 | `generate_audio: true` |
| 异步形态 | Agnes poll | APIMart task poll |
| 一致性抓手 | prompt + keyframes + seed | @ 占位符 + 多模态数组 + seed |

---

## 3. 调用最佳实践

### 3.1 Prompt 结构（通用）

上游推荐结构（Agnes 官方 / Seedance 社区共识）：

```text
[主体 Subject] + [动作 Action] + [场景 Scene] + [镜头 Camera] + [光照 Lighting] + [风格 Style]
```

**图生视频额外约束：**

```text
以参考图主体为准，保持面部/服装/产品外形一致；描述应动元素（头发、背景、镜头），避免重塑主体。
```

**多图 / 关键帧额外约束：**

```text
Agnes:  Create a smooth transition from the first keyframe to the second, maintaining character identity and camera continuity.
Seedance:  @Image1 作为起幅，@Image2 作为落幅，中间过渡自然，身份特征保持一致。
```

### 3.2 agnes-video-v2.0 推荐调用

#### 文生视频（S1）

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "一位年轻女性站在霓虹街头，慢速跟拍，电影感侧光，写实风格",
  "width": 1280, "height": 720,
  "num_frames": 121, "frame_rate": 24,
  "seed": 42,
  "negative_prompt": "blurry, distorted face, watermark, extra limbs"
}
```

#### 单图 i2v（S2）

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "参考图中的人物微微转头看向镜头，自然表情，头发随微风轻轻摆动，背景虚化光斑闪烁",
  "image": "https://cdn.example.com/portrait.png",
  "num_frames": 121, "frame_rate": 24
}
```

#### 多图关键帧（S4）

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "在两帧之间生成平滑电影感过渡，保持角色身份、服装与机位连贯",
  "extra_body": {
    "image": ["https://cdn.example.com/kf-a.png", "https://cdn.example.com/kf-b.png"],
    "mode": "keyframes"
  },
  "num_frames": 121, "frame_rate": 24
}
```

**实践要点：**

- 轮询用 `video_id`，Completed 后读 `metadata.url`（兼容顶层 `url`）  
- 调试时长/分辨率以响应 `seconds`、`size`、`metadata.size_mapping` 为准  
- 分镜重试：固定 `seed` + 固定 `num_frames`  

### 3.3 Seedance 2.0 推荐调用

#### 文生视频（S1）

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "小猫对着镜头打哈欠，浅景深，温暖室内光",
  "size": "16:9", "resolution": "720p", "duration": 5,
  "generate_audio": true
}
```

#### 单图 i2v（S2）

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "@Image1 中的产品保持外形不变，镜头缓慢推近，柔光下微尘漂浮",
  "image_urls": ["https://cdn.example.com/product.jpg"],
  "size": "adaptive", "duration": 8, "generate_audio": false
}
```

#### 动作迁移（S6 — Seedance 独有）

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "@Image1 中的人物复现 @Video1 的舞蹈动作，半身景别，舞台灯光",
  "image_urls": ["https://cdn.example.com/dancer.jpg"],
  "video_urls": ["https://cdn.example.com/choreo.mp4"],
  "duration": 10, "size": "16:9", "resolution": "720p"
}
```

#### 首尾帧过渡（S5）

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "由日景平滑过渡到夜景，保持同一条街道的构图",
  "image_with_roles": [
    { "url": "https://cdn.example.com/day.jpg", "role": "first_frame" },
    { "url": "https://cdn.example.com/night.jpg", "role": "last_frame" }
  ],
  "duration": 5
}
```

#### 连续分镜（S8）

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "@Image1 场景延续，角色继续向前行走",
  "image_urls": ["https://cdn.example.com/prev-last-frame.png"],
  "duration": 5,
  "return_last_frame": true
}
```

**实践要点：**

- prompt 中出现 `@ImageN` 时，`image_urls` 数组长度必须 ≥ N  
- 参考视频总时长控制在 **15s 内**、分辨率 **480–720p**  
- 有声广告/对白：开启 `generate_audio: true` 并在 prompt 写清台词  
- mini 版 prompt 建议中文 ≤500 字、英文 ≤1000 words，避免信息分散  
- 异步任务：8s 轮询，超时 600s；失败时查 task error message  

### 3.4 引用一致性策略（本项目 adapter 负责）

| 层级 | 手段 | 负责模块 |
|---|---|---|
| L1 原生 wire | 正确字段传 URL 数组 / keyframes / @ 占位符 | `buildVideoProviderOptions`, provider |
| L2 prompt 约束 | `buildVideoRefConsistencyBlock(imageRefs)` | `generation-adapter.ts` |
| L3 文本 merge | `mergeRefsToPrompt({ downstreamType:'video', imageRefs })` | `merge-refs.ts` |
| L4 用户 @ 提及 | `mentionedKeys` 优先融合对应 T*/I* | 现有 merge 逻辑 |
| L5 弱复现 | 可选 `seed`（用户层后续暴露；默认随机） | adapter metadata |

**禁止：** 仅把第 2+ 张图拼成 `[ref-image:url]` 而不走 native wire（对 Seedance 无效）。

---

## 4. 本项目关键场景适配

### 4.1 场景清单与产品入口

| 场景 ID | 名称 | 用户路径 | 后端入口 |
|---|---|---|---|
| **S1** | 文生视频 | Video Dock → 文生视频模式 → 生成 | `StudioService.generateVideo` |
| **S2** | 单图 i2v | Video Dock → 图生视频 + 上游 image 节点 / 上传 / `referenceImageUrl` | 同上 |
| **S3** | 多图参考（产品/人物一致） | 画布连线 I1+I2+… → 视频节点 → 生成 | 同上（`refs[]`） |
| **S4** | 多图关键帧过渡 | S3 且 ≥2 张 I* | Agnes keyframes / Seedance `image_urls` |
| **S5** | 首尾帧过渡 | 2 张 I* + 模式识别为 first_last | Seedance `image_with_roles` |
| **S6** | 视频动作/运镜参考 | 视频节点 ← V* 芯片 | Seedance `video_urls` + `@Video1` |
| **S7** | 音频参考（BGM/对白） | 视频节点 ← A* 芯片 | Seedance `audio_urls` + `@Audio1` |
| **S8** | 分镜连续生成 | 上一镜末帧 → 下一镜 I* | Seedance `return_last_frame` + 下镜 S2 |
| **S9** | 分镜/Scene Composer 批量 | Scene Composer → shot video | `MaterialService.generateVideo` |
| **S10** | BYOK 通道 | 用户通道 Apimart/Agnes | `createVideoProvider(providerOpts)` |

#### 4.1.1 现有 UI / 数据字段（基线）

| 字段 | 位置 | 用途 |
|---|---|---|
| `videoMode` | `node.data` | `'text_to_video' \| 'image_to_video'`（`VideoDockPanel.vue`） |
| `videoSettings` | `node.data` | `{ duration, aspectRatio, resolution, crop }` |
| `referenceImageUrl` | `node.data` | 单图 i2v 主参考（与 upstream image 合并） |
| `refs[]` | 生成请求体 | 画布芯片 T*/I*/V*/A*（`GenerationRefPayload`） |
| `mentionedKeys` | prompt @ 解析 | 优先融合的 refKey 列表 |
| `videoModel` | `node.data` | catalog modelKey |

**V*/A* 芯片：** UI 已可挂到视频节点（`CanvasPage.previewPatchForLocalRef`：audio→video 仅芯片不覆盖 url），**服务端尚未消费**。

---

### 4.2 场景 → 模型 → 上游参数映射

| 场景 | 推荐模型 | ref 输入 | 上游关键参数 | refWire |
|---|---|---|---|---|
| S1 文生视频 | Agnes / Seedance | 无 / 仅 T* | Agnes: prompt+frames；Seedance: prompt+duration+size | `none` |
| S2 单图 i2v | Agnes / Seedance | I1 或 `referenceImageUrl` | Agnes: `image`；Seedance: `image_urls[0]`+`@Image1` | `agnes_single_image` / `apimart_multimodal` |
| S3 多图参考 | **Seedance**（优先） | I1…I9 | `image_urls[]` + `@Image1…N` + 一致性块 | `apimart_multimodal` |
| S3 多图参考 | Agnes | I1…I8 | `extra_body.image[]` keyframes | `agnes_keyframes` |
| S4 关键帧过渡 | Agnes | ≥2 I* | 同 S3 Agnes | `agnes_keyframes` |
| S5 首尾帧 | **Seedance** | 恰好 2 I* | `image_with_roles` first+last | `apimart_first_last` |
| S6 运镜/动作 | **Seedance** | I* + V* | `video_urls[]` + `@VideoN` | `apimart_multimodal` |
| S7 音频参考 | **Seedance** | I*或V* + A* | `audio_urls[]` + `@AudioN` | `apimart_multimodal` |
| S8 连续分镜 | **Seedance** | 末帧 URL 作 I1 | `return_last_frame: true` → 下镜 S2 | 两阶段 |
| S9 Composer | 继承 shot 配置 | `item.refs` | 同 S1–S7 | 同左 |
| S10 BYOK | 用户模型 | 同左 | 按 baseUrl 路由 Provider | profile 解析 |

---

### 4.3 各场景实现要点

#### S1 文生视频

**触发条件：** `videoMode=text_to_video` 且无有效 I* / `referenceImageUrl`。

**Adapter：**

- Agnes：`resolveVideoParams(duration, aspectRatio, resolution)` → width/height/num_frames/frame_rate  
- Seedance：`{ size: aspectRatio, resolution, duration, generate_audio: true }`  

**Prompt：** 仅 merged T* + local prompt；无一致性块。

---

#### S2 单图 i2v（最高频）

**触发条件：** `videoMode=image_to_video` 或存在 `referenceImageUrl` / 1 张 I*。

**Ref 合并优先级（本项目）：**

```text
refs 中 I*（按 refOrder）
  → 若空，fallback node.data.referenceImageUrl
  → 若空，fallback upstream.referenceImageUrl（useUpstreamNodeContext）
```

**Adapter：**

| 模型 | 请求 |
|---|---|
| Agnes | `image: primaryUrl` |
| Seedance | `image_urls: [primaryUrl]`；`ensureSeedanceRefTags(prompt, { images:[{refKey:'I1'}] })` |

**Prompt 追加：**

```text
【参考图一致性】以 @Image1 / 参考图 I1 为主，严格保留主体外形、关键细节与构图。
```

**触点：** `VideoDockPanel.vue`（模式切换）、`useNodeGeneration.ts`（`firstImageRefUrl`）、`buildVideoProviderOptions`。

---

#### S3 / S4 多图参考

**触发条件：** `refs` 中 `mediaType=image` 数量 ≥ 2。

**模型分流：**

```typescript
if (profile.refWire.startsWith('agnes_') && images.length >= 2) {
  refWire = 'agnes_keyframes'
} else if (profile.refWire.startsWith('apimart_')) {
  refWire = images.length >= 2 ? 'apimart_multimodal' : 'apimart_multimodal' // 单图仍走 image_urls
}
```

**merge-refs 增强：** `downstreamType:'video'` 时传入 `imageRefs`，system prompt 要求按 I1/I2 说明角色。

**Seedance prompt 自动补全示例：**

```text
@Image1 为主角参考，@Image2 为场景/服装参考，保持 @Image1 的面部身份一致。
```

---

#### S5 首尾帧过渡

**触发条件：** 2 张 I* 且（`videoMode==='first_last_frame'` **或** adapter detect：有且仅有 2 张 I* 且 prompt 含「过渡/首尾帧/from…to…」关键词 — 可选启发式）。

**Seedance 请求：**

```json
"image_with_roles": [
  { "url": "<I1>", "role": "first_frame" },
  { "url": "<I2>", "role": "last_frame" }
]
```

**互斥：** 清空 `video_urls` / `audio_urls`；metadata 记录 dropped V*/A*。

**Agnes 降级：** 走 S4 keyframes（无 `image_with_roles` 等价）。

---

#### S6 视频运镜 / 动作参考

**触发条件：** refs 含 `mediaType=video`（V* 芯片）。

**仅 Seedance；** Agnes 下降为 metadataOnly + prompt 文字描述 V* label（无法 native）。

**Adapter：**

```typescript
video_urls: bundle.videos.map(v => v.url)
ensureSeedanceRefTags(prompt, bundle)  // 注入 @Video1
```

**典型用户图：** 视频节点 ← 图片节点 I1 + 参考视频节点 V1。

---

#### S7 音频参考

**触发条件：** refs 含 `mediaType=audio`（A* 芯片）。

**预检：** 无 I* 且无 V* → `BadRequestException('参考音频须配合参考图或视频')`。

**Seedance：**

```typescript
audio_urls: bundle.audios.map(a => a.url)
// prompt: 「全程使用 @Audio1 作为背景音乐」
```

---

#### S8 连续分镜（跨节点工作流）

**阶段 A — 生成第 N 镜：** 正常 S2/S3，`return_last_frame: true`（Seedance；Agnes 不支持则 metadata 标记）。

**阶段 B — 用户将末帧设为第 N+1 镜 I*：** 走 S2；`referenceImageUrl` 或连线传入。

**metadata 回写：** 可选存 `lastFrameUrl` 供前端「延续上一镜」一键操作（P6+ UX，非阻塞）。

---

#### S9 Scene Composer / 分镜 material 路径

**入口：** `scene-composer.service.ts` → `materialService.generateVideo({ refs, mentionedKeys, duration, aspectRatio, resolution, crop })`。

**要求：** 与 Studio 路径 **共用** `extractVideoReferences` + `buildVideoProviderOptions` + provider，禁止 composer 旁路单独拼 prompt。

---

#### S10 BYOK 通道路由

| baseUrl | modelKey | Provider |
|---|---|---|
| `*agnes-ai.com*` | `agnes-video-*` | `AgnesVideoProvider` |
| `*apimart.ai*` | `seedance-*` / `doubao-seedance-*` | `ApimartVideoProvider` |
| 其他 | 任意 | **不得** `PlaceholderVideoProvider`；返回明确错误 |

---

### 4.4 `referenceImageUrl` 与 `refs[]` 合并规则

```typescript
function buildVideoReferenceBundle(
  refs: GenerationRefPayload[],
  referenceImageUrl?: string,
): VideoReferenceBundle {
  const images = refs.filter(r => r.mediaType === 'image' && r.url)
  if (images.length === 0 && referenceImageUrl?.trim()) {
    images.push({ refKey: 'I1', url: referenceImageUrl.trim(), label: '参考图' })
  }
  return {
    images: images.map(/* refKey, url, label */),
    videos: refs.filter(r => r.mediaType === 'video' && r.url),
    audios: refs.filter(r => r.mediaType === 'audio' && r.url),
  }
}
```

> 避免 S2 中 `referenceImageUrl` 与 I1 重复：若 refs 已有 I*，忽略 `referenceImageUrl` 或 dedupe 同 URL。

---

### 4.5 UI 参数与上游能力差距（P6 范围）

| 项目 UI | 当前值 | Agnes | Seedance | 本规格处理 |
|---|---|---|---|---|
| duration | 5/10/15 | ✅ | ⚠️ 缺 4s | P6 增加 4s 选项 |
| aspectRatio | 16:9/9:16/1:1 | ✅ | ✅ | 保持 |
| aspectRatio | — | 4:3/3:4 | 4:3/3:4/21:9/adaptive | P6 扩展 |
| resolution 1080p on mini | 可选 | ✅ | 降级 720p | adapter clamp + droppedFields |
| crop | none/center/fill | metadataOnly | metadataOnly | 保持 metadataOnly |
| generate_audio | 无控件 | — | 默认 true | catalog default；P6 可选开关 |
| videoMode | text/i2v | — | — | P6 可选 first_last（S5） |

---

### 4.6 用户路径调用示例

> 视角：**用户在画布上做什么 → 界面呈现什么 → 项目 API 收到什么 → adapter 发给上游什么**。  
> 示例中 URL 为示意；实际上传后会变为持久化 HTTPS 地址。

#### 4.6.0 通用路径（所有场景共用）

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. 选中视频节点 → 底部 Video Dock 展开                                   │
│ 2. 选择模型（UniversalModelSelector）+ 时长/比例/分辨率（VideoSettings） │
│ 3. 输入 prompt（可 @T1 @I1 提及芯片）                                     │
│ 4. 可选：切换「文生视频 / 图生视频」、上传参考图、从上游/侧边栏拖入素材      │
│ 5. 点击「生成」→ useNodeGeneration → POST /studio/video/generate          │
│ 6. 节点 status=generating → 轮询 generationRecord → completed 播放        │
└─────────────────────────────────────────────────────────────────────────┘
```

**画布拓扑与芯片：**

```text
[文本节点 T1] ──边──→ [视频节点]
[图片节点]   ──边──→ [视频节点]     → 解析为 I1（refKey 按 refOrder 分配）
[视频节点]   ──边──→ [视频节点]     → 解析为 V1（Seedance 可 native）
[音频节点]   ──边──→ [视频节点]     → 解析为 A1（Seedance 可 native）
```

**三层 payload 对照：**

| 层 | 说明 | 示例字段 |
|---|---|---|
| L1 用户输入 | Dock + 节点 data | `prompt`, `videoMode`, `videoSettings`, `referenceImageUrl` |
| L2 项目 API | `POST /studio/video/generate` | `prompt`, `model`, `duration`, `aspectRatio`, `resolution`, `refs[]`, `mentionedKeys` |
| L3 上游模型 | Provider 出站 | Agnes: `image` / `extra_body`；Seedance: `image_urls` + `@ImageN` 等 |

---

#### 示例 A — S1 文生视频（通用）

**用户路径**

1. 画布新建 **视频节点**，不连接任何上游图片  
2. Dock 选 **「文生视频」**  
3. 模型选 `Agnes Video` 或 `Seedance 2.0 Min`  
4. 参数：时长 **5s**、比例 **16:9**、分辨率 **720p**  
5. 输入 prompt：`「赛博朋克城市夜景，无人机航拍，霓虹反射」`  
6. 点击 **生成**

**界面状态**

| 元素 | 值 |
|---|---|
| 模式切换 | 文生视频（高亮） |
| 参考图区域 | 隐藏 / 不可用 |
| 芯片条 | 无 I*/V*/A*（可有 T* 若连了文本节点） |
| 积分 | ~30（5s 档） |

**L2 — 项目 API 请求体**

```json
{
  "prompt": "赛博朋克城市夜景，无人机航拍，霓虹反射",
  "model": "agnes-video-v2.0",
  "duration": 5,
  "aspectRatio": "16:9",
  "resolution": "720p",
  "crop": "none",
  "refs": [
    { "refKey": "T1", "mediaType": "text", "label": "创意描述", "text": "雨夜、潮湿地面" }
  ],
  "mentionedKeys": [],
  "sessionId": "cms…",
  "nodeId": "node-video-1"
}
```

**L3 — 上游（Agnes，merge 后）**

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "【T1·创意描述】\n雨夜、潮湿地面\n\n赛博朋克城市夜景，无人机航拍，霓虹反射",
  "width": 1280, "height": 720,
  "num_frames": 121, "frame_rate": 24
}
```

**L3 — 上游（Seedance，若换模型）**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "【T1·创意描述】\n雨夜、潮湿地面\n\n赛博朋克城市夜景，无人机航拍，霓虹反射",
  "size": "16:9", "resolution": "720p", "duration": 5,
  "generate_audio": true
}
```

---

#### 示例 B — S2 单图 i2v（最高频）

**用户路径 A — 上游图片连线**

1. **图片节点** 已生成产品图 → 连线到 **视频节点**  
2. Dock 自动切 **「图生视频」**（或手动切换）  
3. 模型 `Seedance 2.0 Min`  
4. prompt：`「产品缓慢旋转，柔光下微尘漂浮，镜头推近」`  
5. 芯片条显示 **I1 · 产品图**  
6. 生成

**用户路径 B — Dock 内上传参考图**

1. 独立视频节点，无上游连线  
2. 切 **图生视频** → 点击参考图区 **上传** 本地 JPG  
3. 上传完成后 Dock 预览缩略图，`referenceImageUrl` 写入节点  
4. 其余同路径 A

**L2 — 项目 API**

```json
{
  "prompt": "产品缓慢旋转，柔光下微尘漂浮，镜头推近",
  "model": "seedance-2.0-min",
  "duration": 5,
  "aspectRatio": "16:9",
  "resolution": "720p",
  "refs": [
    {
      "refKey": "I1",
      "mediaType": "image",
      "label": "产品图",
      "url": "https://cdn.lnkpi.example/uploads/product-abc.png"
    }
  ]
}
```

**L3 — 上游（Seedance，adapter 后）**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "产品缓慢旋转，柔光下微尘漂浮，镜头推近\n\n【参考图一致性】以 @Image1 为主，严格保留主体外形、关键细节与构图。\n\n@Image1",
  "image_urls": ["https://cdn.lnkpi.example/uploads/product-abc.png"],
  "size": "16:9", "resolution": "720p", "duration": 5,
  "generate_audio": false
}
```

**L3 — 上游（Agnes，同场景）**

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "…同上（含一致性块，无 @Image1）…",
  "image": "https://cdn.lnkpi.example/uploads/product-abc.png",
  "width": 1280, "height": 720,
  "num_frames": 121, "frame_rate": 24
}
```

---

#### 示例 C — S3 多图参考（人物 + 服装）

**用户路径**

1. 画布：`[定妆照 I1]` + `[服装参考 I2]` 两条边连到 **视频节点**  
2. 文本节点 T1 连入，写「镜头语言」  
3. prompt 输入：`「@I1 穿着 @I2 中的服装，在 T 台走秀，跟拍」`（`mentionedKeys: ["I1","I2"]`）  
4. 模型 **Seedance 2.0 Min**  
5. 芯片：**T1 · I1 · I2**  
6. 生成

**L2 — 项目 API**

```json
{
  "prompt": "@I1 穿着 @I2 中的服装，在 T 台走秀，跟拍",
  "model": "seedance-2.0-min",
  "duration": 10,
  "aspectRatio": "9:16",
  "resolution": "720p",
  "refs": [
    { "refKey": "T1", "mediaType": "text", "text": "慢速跟拍，顶光" },
    { "refKey": "I1", "mediaType": "image", "url": "https://…/face.png", "label": "定妆照" },
    { "refKey": "I2", "mediaType": "image", "url": "https://…/outfit.png", "label": "服装" }
  ],
  "mentionedKeys": ["I1", "I2"]
}
```

**L3 — 上游（Seedance）**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "（merge 后全文）…\n@Image1 为人物面部与体型参考，@Image2 为服装参考，保持 @Image1 身份一致。",
  "image_urls": [
    "https://…/face.png",
    "https://…/outfit.png"
  ],
  "size": "9:16", "duration": 10, "resolution": "720p"
}
```

**若用户改选 Agnes：** 2 张 I* → `extra_body.image` + `mode:keyframes`（S4）。

---

#### 示例 D — S5 首尾帧过渡（Seedance）

**用户路径**

1. 连接 **两张图片**：I1「白天街道」、I2「夜晚同街」  
2. （P6 后）Dock 选 **首尾帧模式**；当前可用 prompt 明示：`「从白天平滑过渡到夜晚，构图不变」`  
3. 模型 Seedance，时长 5s  
4. 生成

**L3 — 上游**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "从白天平滑过渡到夜晚，保持同一条街道的构图与机位",
  "image_with_roles": [
    { "url": "https://…/day.jpg", "role": "first_frame" },
    { "url": "https://…/night.jpg", "role": "last_frame" }
  ],
  "duration": 5
}
```

---

#### 示例 E — S6 动作迁移（Seedance 独有）

**用户路径**

1. 画布：`[舞者照片 I1]` + `[舞蹈参考视频 V1]` → **视频节点**  
2. 侧边栏 **资产库** 也可拖入视频作为 V1  
3. prompt：`「@I1 复现 @V1 的舞蹈动作，舞台顶光」`  
4. 模型 **Seedance 2.0 Min**（Agnes 无法 native，会降级为文字描述）  
5. 芯片：**I1 · V1**  
6. 生成

**L2 — refs 片段**

```json
"refs": [
  { "refKey": "I1", "mediaType": "image", "url": "https://…/dancer.jpg" },
  { "refKey": "V1", "mediaType": "video", "url": "https://…/choreo.mp4", "label": "参考舞蹈" }
]
```

**L3 — 上游**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "@Image1 复现 @Video1 的舞蹈动作，舞台顶光，半身景别\n\n@Image1 @Video1",
  "image_urls": ["https://…/dancer.jpg"],
  "video_urls": ["https://…/choreo.mp4"],
  "duration": 10, "size": "16:9", "resolution": "720p"
}
```

---

#### 示例 F — S7 音频 + 图片（广告片）

**用户路径**

1. `[产品图 I1]` + `[BGM 片段 A1]` 连到视频节点  
2. prompt：`「@I1 产品特写，全程使用 @A1 作为背景音乐，15 秒广告片」`  
3. 时长 **15s**，Seedance  
4. 生成

**L3 — 上游**

```json
{
  "model": "doubao-seedance-2.0-mini",
  "prompt": "…@Image1 产品特写…全程使用 @Audio1 作为背景音乐…",
  "image_urls": ["https://…/product.jpg"],
  "audio_urls": ["https://…/bgm.mp3"],
  "duration": 15, "size": "16:9", "generate_audio": true
}
```

**失败路径（须阻断）：** 仅拖入 A1、无 I*/V* → 生成前 toast：`参考音频须配合参考图或视频`。

---

#### 示例 G — S8 连续分镜（两镜工作流）

**用户路径 — 第 1 镜**

1. 视频节点 A，S2 单图 i2v，Seedance，`return_last_frame: true`（adapter 自动，或 P6 UI「输出末帧」）  
2. 生成完成 → metadata 含 `lastFrameUrl`

**用户路径 — 第 2 镜**

1. 新建 **视频节点 B**，用户将第 1 镜末帧 **另存为图片** 或一键「延续上一镜」（P6）  
2. 作为 I1 连到节点 B，或写入 `referenceImageUrl`  
3. prompt：`「角色继续向前行走，场景延续」`  
4. 走 **示例 B** 的 S2 路径

```text
[视频节点 A] ──末帧 PNG──→ [图片/直接 I1] ──→ [视频节点 B]
```

---

#### 示例 H — S9 Scene Composer 分镜批量

**用户路径**

1. 用户通过 **Scene Composer** 编排多镜头脚本  
2. 某一镜设为 **video**，配置 model/duration/aspectRatio，refs 含 T* + I*  
3. 点击 **批量生成** → `POST /agent/canvas/scene-composer/batch-generate`  
4. 后端 `MaterialService.generateVideo`（与 Studio **同一 adapter 链**）

**L2 — material API（单镜）**

```json
{
  "shotId": "shot-node-3",
  "prompt": "镜头推近，人物微笑",
  "model": "agnes-video-v2.0",
  "duration": 5,
  "aspectRatio": "16:9",
  "resolution": "720p",
  "refs": [
    { "refKey": "I1", "mediaType": "image", "url": "https://…/keyframe.png" }
  ]
}
```

> 用户无感知 Studio vs Material 差异；规格要求出站 upstream body 与画布单节点生成一致。

---

#### 示例 I — S10 BYOK Apimart

**用户路径**

1. **设置 → 模型通道** 添加 Apimart BYOK，`baseUrl=https://api.apimart.ai/v1`  
2. 视频节点模型选 `通道ID::seedance-2.0-min`  
3. 普通 S2 图生视频流程  
4. 若 BYOK 失败 → 弹出 **平台回退确认**（现有 fallback 流程）

**路由结果**

```text
createVideoProvider({ apiKey: 'sk-…', baseUrl: 'https://api.apimart.ai/v1' })
  → ApimartVideoProvider（非 Placeholder）
```

---

#### 4.6.1 场景速查表（用户路径 → 场景 ID）

| 用户看到的操作 | 场景 |
|---|---|
| 文生视频模式，无参考图 | S1 |
| 图生视频 + 1 张图（连线/上传） | S2 |
| 2 张以上图片芯片 I1/I2… | S3 / S4 |
| 2 张图 + 首尾帧意图 | S5 |
| 图片 + 参考视频芯片 V1 | S6 |
| 图片 + 参考音频芯片 A1 | S7 |
| 上一镜末帧接下一镜 | S8 |
| Scene Composer 批量 | S9 |
| 设置里 BYOK 通道模型 | S10 |

---

## 5. 架构：Video Model Profile

在 `@lnkpi/shared` 新增 **按 modelKey/gatewayModelId 解析的 profile**（镜像 `imageModelProfiles.ts`），供 adapter 与 provider 共用。

```typescript
type VideoRefWire =
  | 'none'
  | 'agnes_single_image'
  | 'agnes_keyframes'
  | 'apimart_image_urls'
  | 'apimart_multimodal'
  | 'apimart_first_last'
  | 'legacy_prompt_tags'

type VideoSizeWire = 'pixel_frames' | 'ratio_duration'
type VideoResponseMode = 'agnes_poll' | 'async_task'

interface VideoModelProfile {
  refWire: VideoRefWire
  sizeWire: VideoSizeWire
  responseMode: VideoResponseMode
  gatewayModelId: string
  maxImageRefs: number
  maxVideoRefs: number
  maxAudioRefs: number
  minDuration: number
  maxDuration: number
  allowedAspectRatios: string[]
  allowedResolutions: string[]
  defaultGenerateAudio?: boolean
  pollIntervalMs: number
  maxPollMs: number
}
```

### 5.1 Profile 映射表

| modelKey / 模式 | gatewayModelId | refWire | sizeWire | response | max I* | max V* | max A* |
|---|---|---|---|---|---|---|---|
| `agnes-video-v2.0`, `agnes-video-*` | 同名 | 1 图：`agnes_single_image`；≥2：`agnes_keyframes` | `pixel_frames` | `agnes_poll` | 8 | 0 | 0 |
| `seedance-2.0-min`, `doubao-seedance-*` | `doubao-seedance-2.0-mini` | `apimart_multimodal` / `apimart_first_last` | `ratio_duration` | `async_task` | 9 | 3 | 3 |
| `happyhose-1.1`, `wan-2.7` 等 legacy | catalog 默认 | `legacy_prompt_tags` | `ratio_duration` | `async_task`‡ | 1 | 0 | 0 |

‡ 未实测模型暂走 legacy；网关实测后升级 profile。

### 5.2 引用提取（Server 层）

见 §4.4 `buildVideoReferenceBundle`；公网化：`inlineUpstreamReferenceMedia()` 统一处理 image/video/audio URL。

### 5.3 Adapter / Provider / Server

与初版规格相同，核心新增：

- `inferVideoScenario(bundle, videoMode)` → S1–S8 场景 ID（写 metadata `scenario` 便于追踪）  
- `buildEffectiveVideoPrompt(merged, bundle, profile, scenario)`  
- `ensureSeedanceRefTags(prompt, bundle)`  

**流程：**

```text
refs + referenceImageUrl
  → buildVideoReferenceBundle()
  → mergeRefsToPrompt({ downstreamType:'video', imageRefs })
  → inferVideoScenario()
  → buildVideoProviderOptions({ referenceBundle, videoMode, scenario })
  → buildEffectiveVideoPrompt()
  → inlineUpstreamReferenceMedia()
  → createVideoProvider().generate()
```

---

## 6. Catalog 变更

```typescript
// agnes-video-v2.0
params: { model, duration, aspectRatio, resolution, image, seed, negativePrompt, crop: 'metadataOnly' }

// seedance-2.0-min
gatewayModelId: 'doubao-seedance-2.0-mini'
params: { model, duration, aspectRatio, resolution, generateAudio, seed, refImages, refVideos, refAudios, crop: 'metadataOnly' }
defaults: { duration: 5, generateAudio: true }
```

---

## 7. 参数 clamp 规则

见 §2 参数分析；汇总：

| 模型 | 规则 |
|---|---|
| Agnes | num_frames ≤441 且 8n+1；多图 ≤8 |
| Seedance | duration 4–15；image≤9；video≤3；audio≤3；仅 A* 阻断 |
| Seedance mini | 1080p → 720p |
| 互斥 | first_last 模式下 V*/A* → droppedFields |

---

## 8. metadata 可观测性

```typescript
{
  modelKey, gatewayModelId, scenario,  // S1–S10
  nativeParams, refWire, responseMode,
  refImageMode, refVideoMode, refAudioMode,
  referenceImageCount, referenceVideoCount, referenceAudioCount,
  droppedFields, seed?, generateAudio?, lastFrameUrl?,
  modelFallback?,
}
```

---

## 9. 验收标准

### 9.1 按场景验收

| 场景 | 验收条件 |
|---|---|
| S1 | 无 ref；Agnes/Seedance 均返回真实 MP4；metadata `scenario=S1` |
| S2 | 1 I* 或 referenceImageUrl；Agnes 有 `image`；Seedance 有 `image_urls`+`@Image1`；无 `[ref-image:]` |
| S3 | 3 I*；Seedance 3 URL 全进 `image_urls`；prompt 含 `@Image1` `@Image2` `@Image3` |
| S4 | 2 I* + Agnes；`extra_body.image`+`mode:keyframes` |
| S5 | 2 I* + Seedance；`image_with_roles` first+last |
| S6 | I1+V1；Seedance `video_urls`+`@Video1` |
| S7 | I1+A1；`audio_urls`+`@Audio1`；仅 A1 阻断 |
| S8 | Seedance 返回 `lastFrameUrl`；下一镜 S2 可消费 |
| S9 | Composer 与 Studio 请求体结构一致 |
| S10 | Apimart BYOK 非 placeholder |

### 9.2 通用

11. 有 I* 时 prompt 含【参考图一致性】块  
12. 单元测试 + `pnpm build` 全绿  

---

## 10. 分阶段实施

| Phase | 内容 | 覆盖场景 |
|---|---|---|
| P0 | VideoModelProfile + catalog | 全部 |
| P1 | `buildVideoReferenceBundle` + merge-refs imageRefs | S2–S7 |
| P2 | adapter scenario + @ 注入 + consistency block | S2–S7 |
| P3 | ApimartVideoProvider + 路由 | S1–S7 Seedance |
| P4 | Agnes keyframes + seed + negative | S3–S4 |
| P5 | server Studio + Material 统一 | S9–S10 |
| P6 | UI duration 4s / first_last / generate_audio | S5,S8 |
| P7 | 测试 | 全部 |

**建议顺序：** P0 → P3 → P2 → P5 → P4 → P1 → P6 → P7

---

## 11. 非目标

- fal 直连；`asset://`；V* 抽帧理解（C3 完整）；A* ASR（C4）；C2 composer 旁路；4K

---

## 12. 附录：网关兼容性追踪

| modelKey | gatewayModelId | 实测状态 | 备注 |
|---|---|---|---|
| `agnes-video-v2.0` | 同名 | 部分可用 | 缺 keyframes |
| `seedance-2.0-min` | `doubao-seedance-2.0-mini` | 未对接 | 需 P3 |

---

## 13. 与既有规格关系

| 规格 | 关系 |
|---|---|
| `2026-07-19-dock-studio-model-adapter-design.md` | C1 基线；本规格升级 native 多模态 |
| `2026-08-06-seedream-gpt-image2-apimart-design.md` | ImageModelProfile 架构模板 |
| `2026-07-18-node-data-flow-refs-design.md` | I*/V*/A* 芯片语义 |
| `2026-07-19-c21-canvas-refs-design.md` | refs 透传与 refOrder |
