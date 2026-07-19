# Dock Studio 模型对接适配层（C1 产品与技术规格）

> 状态：**实现完成 / 待网关实测**（§1–§4 已落地；附录 gateway 兼容性清单待人工实测更新）  
> 日期：2026-07-19  
> 范围：**C1** — 普通 studio 主路径（text / image / video / audio）参数与芯片（T*/I*）真实进入模型；Audio 扩模型与语音参数卡；统一模型目录  
> 前置：`2026-07-18-node-data-flow-refs-design.md`（前端芯片与文本合并已落地）  
> 后续轮次：**C2** shot/scene composer 旁路统一；**C3** V* 消费；**C4** A* ASR/音色参考  

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 本轮代号 | **C1**（全量愿景 C 的第一子迭代） |
| 架构 | **Studio 生成适配层 + 模型能力表**（方案 2） |
| 模型选择 UI | **只选模型**；供应商由目录自动映射，无二级供应商选择 |
| API 接入 | **暂定统一 OpenAI-compatible 网关**（`OPENAI_BASE_URL` + Key）；兼容性单列追踪 |
| 多图 I* | **原生多模态优先**；不支持则显式降级并记 metadata |
| Audio 参数 | emotion / language / speed / **volume** / **pitch** 合成一卡；能 native 则 native，否则文案前缀 / metadata |
| Audio 音色 | **随模型切换列表**（静态配置表） |
| Text/Image/Video | 固定产品模型目录；`*Model` **必须透传**到 provider（或能力表降级路径） |
| 参考图上传 | 禁止 `blob:` 出站；先持久化 URL |
| 明确不做 | C2/C3/C4；独立官方 SDK 直连；自动级联生成 |

---

## 1. 目标与非目标

### 1.1 目标

打通普通 studio 主路径：dock 底部参数与芯片引用（本轮消费 **T\*** 文本合并 + **I\*** 图片参考）在生成时按能力表**真实进入模型**；不支持项**显式降级并写入 metadata**，禁止静默丢弃。

### 1.2 非目标

| 能力 | 说明 |
| --- | --- |
| C2 shot / scene composer 旁路统一 | 下轮 |
| C3 视频芯片 V* 抽帧 / 理解 | 下轮 |
| C4 音频芯片 A* ASR / 音色克隆 | 下轮；A* 仍可展示，生成侧可不消费（与 2026-07-18 规格一致） |
| 按供应商拆独立官方 SDK | 与「暂定统一网关」冲突；网关验证后再评估 |
| 自动级联生成 / 可连性强制拦截 | 不做 |

### 1.3 验收标准

1. **Audio**：可选 Seed Audio 1.0 / MiniMax Speech 2.8 HD；音色随模型切换；一卡含 emotion/language/speed/volume/pitch（默认可用）；请求带 model + 能力内参数；不支持项进前缀或 metadata，可查。  
2. **Image**：`imageModel`、size（比例+分辨率）、`n` 进入 ImageProvider；多张 I* 走原生参考路径（否则降级并记 metadata）。  
3. **Video**：主参考图进入 provider `options.image`；其余图写入合并 prompt；duration/aspect/resolution 生效；crop 按能力表。  
4. **Text**：保持文本合并 + 多图 vision；`textModel` 进入 TextProvider。  
5. **参考图**：上传经持久化，无 `blob:` 出站。  
6. **追踪附录**：各 `gatewayModelId` 与字段兼容性「待实测」清单可更新。  

---

## 2. 架构与数据流

### 2.1 组件边界

```text
Dock UI (Text/Image/Video/Audio)
  → node.data（参数落盘）
  → useNodeGeneration + studio-api
  → StudioController DTO
  → StudioService
  → StudioGenerationAdapter（新）
       ├─ studioModelCatalog / modelCapabilities
       ├─ build*Request（按模态）
       └─ applyUnsupportedAsPromptPrefix
  → Text / Image / Video / Audio Provider
       └─ OpenAI-compatible 网关（暂定）
```

职责：

- **Catalog**：displayName ↔ modelKey ↔ gatewayModelId ↔ 默认参数 ↔ voices[]  
- **Capabilities**：字段级 `native` | `promptPrefix` | `metadataOnly`  
- **Adapter**：合并 refs 之后、调用 provider 之前，统一做映射与降级  
- **Provider**：尽量薄；接收已解析的 native 选项，不散落业务 if/else  

### 2.2 数据流（按模态）

**Text**  
`local prompt + T* mergeRefs + I* vision` → `textModel` → gateway chat/completions（或现有 text/vision 路径）。

**Image**  
`merged prompt + I* references` → `imageModel` + `size` + `n` → image provider；多图优先原生输入。

**Video**  
`merged prompt` + `referenceImages[0]` → `options.image`；其余 I* → prompt；`videoModel` + duration/aspect/resolution[/crop]。

**Audio**  
`merged text`（含 promptPrefix）+ `audioModel` + voice/speed/volume/pitch[/emotion] → TTS 兼容请求。

### 2.3 参考图持久化

Dock 内上传必须走现有 `persistMediaUrl` / `fileToPersistedPayload`（或等价）；写入 `referenceImageUrl` / localRefs 的必须是可被服务端与外部模型访问的 URL。生成前若检测到 `blob:`，阻断并提示。

---

## 3. 模型目录（只选模型）

内部存 **modelKey**；UI 显示 **displayName**；出站用 **gatewayModelId**（初值可与 modelKey 相同，实测后修正）。

### 3.1 Text

| displayName | modelKey |
| --- | --- |
| Gemini 3.1 Flash | `gemini-3.1-flash` |
| DeepSeek V4 | `deepseek-v4` |
| GPT 5.5 | `gpt-5.5` |

### 3.2 Image

| displayName | modelKey |
| --- | --- |
| Image2 | `image2` |
| Navo Pro | `navo-pro` |
| Seedream 5.0 Pro | `seedream-5.0-pro` |
| Midjourney 8.1 | `midjourney-8.1` |

### 3.3 Video

| displayName | modelKey |
| --- | --- |
| Seedance 2.0 Min | `seedance-2.0-min` |
| Happyhose 1.1 | `happyhose-1.1` |
| Wan 2.7 | `wan-2.7` |

> 备注：`happyhose-1.1` 为产品给定名称；若网关实际为 Hailuo/海螺 等，仅改 `gatewayModelId` 映射，不改 UI 文案（除非产品更名）。

### 3.4 Audio

| displayName | modelKey |
| --- | --- |
| Seed Audio 1.0 | `seed-audio-1.0` |
| MiniMax Speech 2.8 HD | `minimax-speech-2.8-hd` |

### 3.5 选择规则

1. 用户选择的 modelKey **必须**进入对应 provider 请求（或能力表声明的降级）。  
2. 环境变量只提供**默认** modelKey；**不得静默覆盖**用户选择。  
3. 未知 / 非法 modelKey → 回退该模态默认模型，metadata 记 `modelFallback`。  
4. `providerBinding` 本轮统一标注为 `gateway-openai-compat`（追踪用）。  

---

## 4. UI 与节点字段

### 4.1 通用

- 复用 / 收敛 `UniversalModelSelector`（及同类），数据源改为共享 `studioModelCatalog`。  
- 切换模型时：不兼容的 voice/参数回退到该模型默认值。  

### 4.2 Audio Dock

| 控件 | node.data 字段 | 默认 |
| --- | --- | --- |
| 模型 | `audioModel` | `minimax-speech-2.8-hd`（可配置） |
| 音色（随模型） | `audioVoice` | 该模型 voices[0] |
| 情绪 | `audioEmotion` | `neutral` |
| 语言 | `audioLanguage` | `zh` |
| 语速 | `audioSpeed` | `1.0`（范围建议 0.5–2.0） |
| 音量 | `audioVolume` | `1.0`（范围建议按能力表，MiniMax 常见 (0,10]） |
| 音调 | `audioPitch` | `0`（范围建议按能力表，MiniMax 常见 [-12,12]） |

情绪 / 语言 / 语速 / 音量 / 音调合成 **一张语音参数卡**（在现有 `AudioVoiceSettingsSelector` 上扩展）。

### 4.3 Text / Image / Video

- 模型选项收敛为 §3 目录。  
- Image：保留比例 / 分辨率 / 张数。  
- Video：保留时长 / 比例 / 分辨率 / crop；图生视频主参考 → `options.image`。  
- 落盘：`textModel` / `imageModel` / `videoModel` 使用 modelKey。  

### 4.4 API DTO 扩展（Audio）

在现有 `GenerateAudioDto` 上增加（名称以实现为准，需前后端一致）：

- `model`（audioModel）  
- `voice`, `emotion`, `language`, `speed`（已有则保留）  
- `volume`, `pitch`（新增）  

Image / Video / Text：确保 `model` 与现有分辨率/张数/时长等字段继续透传；Image service 调用 provider 时必须带 `modelId`。  

---

## 5. 能力表与降级

### 5.1 字段处置

| 处置 | 含义 |
| --- | --- |
| `native` | 写入网关/provider 请求体 |
| `promptPrefix` | 注入合并后文本前缀；metadata 记 `appliedAs: promptPrefix` |
| `metadataOnly` | 不进模型；metadata 记 `droppedFields` + 原因 |

禁止第三种「既不传也不记」。

### 5.2 建议初始能力（实测前可保守）

**minimax-speech-2.8-hd**（参考 MiniMax T2A 常见字段，经兼容网关时以实测为准）：

- native：`voice`（voice_id）、`speed`、`volume`（vol）、`pitch`；若网关暴露 `emotion` 则 native，否则 promptPrefix  
- language：优先网关 `language_boost` / 等价字段；否则 promptPrefix  

**seed-audio-1.0**：

- 未知字段默认 `promptPrefix` 或 `metadataOnly`，补齐附录后再改为 native  

**Image / Video 多图**：

- 原生多参考 → `refImageMode: native`  
- 仅首图 `options.image` → `refImageMode: primary_image`  
- 仅 URL 文本标记 → `refImageMode: prompt_url_tags`  

**Video crop**：native 则传；否则 metadataOnly（可选 prompt 备注）。  

### 5.3 GenerationRecord.metadata（建议）

`modelKey`, `gatewayModelId`, `nativeParams`, `promptPrefixApplied`, `droppedFields`, `refImageMode`, `referenceImageCount`, `modelFallback?`

### 5.4 错误

- 网关 4xx/5xx → 节点 `status=error` + 可读 `errorMessage`；metadata 可保留请求摘要（无密钥）。  
- `blob:` 参考图 → 生成前阻断。  

---

## 6. 测试

### 6.1 单元

- 能力表解析与 Audio/Image/Video 请求构建  
- Image `modelId` + size + n  
- Video `options.image`  
- 未知 modelKey 回退  
- promptPrefix 拼接  

### 6.2 契约

- studio-api ↔ Controller DTO 字段一致（含 volume/pitch/model）  

### 6.3 手工验收

- 四类 Dock 切换目录内模型并生成  
- Audio 参数卡默认值与随模型音色切换  
- 多图 I*、持久化参考图  
- 确认 shot/composer **不在**本轮验收范围（避免误测）  

---

## 7. 风险

| 风险 | 缓解 |
| --- | --- |
| 显示名 ≠ 网关 model id | catalog 三列映射；附录追踪 |
| 兼容网关对 MJ / Seedance 等支持不一 | 能力表 + metadata 可观测 |
| Happyhose 命名存疑 | 只改 gatewayModelId |
| C1 范围含多模态目录，实现量大 | 计划按任务拆分；网关实测不阻塞骨架 |

---

## 8. 附录：网关兼容性追踪（待实测）

> 本附录为活文档。实现骨架可先合入；每实测一行更新 Status。

| modelKey | gatewayModelId（初值） | 模态 | 实测状态 | 备注 |
| --- | --- | --- | --- | --- |
| `gemini-3.1-flash` | `gemini-3.1-flash` | text | 待实测 | |
| `deepseek-v4` | `deepseek-v4` | text | 待实测 | |
| `gpt-5.5` | `gpt-5.5` | text | 待实测 | |
| `image2` | `image2` | image | 待实测 | |
| `navo-pro` | `navo-pro` | image | 待实测 | |
| `seedream-5.0-pro` | `seedream-5.0-pro` | image | 待实测 | |
| `midjourney-8.1` | `midjourney-8.1` | image | 待实测 | |
| `seedance-2.0-min` | `seedance-2.0-min` | video | 待实测 | |
| `happyhose-1.1` | `happyhose-1.1` | video | 待实测 | 可能需映射真实 id |
| `wan-2.7` | `wan-2.7` | video | 待实测 | |
| `seed-audio-1.0` | `seed-audio-1.0` | audio | 待实测 | 字段能力待填 |
| `minimax-speech-2.8-hd` | `speech-2.8-hd` 或网关等价 | audio | 待实测 | speed/vol/pitch/emotion |

**追踪约定**：统一走 OpenAI-compatible 网关为**暂定**方案；若某模型必须官方 SDK，单开变更修订本规格 §0 / §2，不在 C1 静默分叉。

---

## 9. 与既有规格关系

- 继承 2026-07-18：T* 合并、I* 对 text 的 vision、手动点生成、A*/V* 展示可先于消费。  
- 修正落地缺口：Image model 未进 provider、Video 参考图未进 `options.image`、多图仅 I1、Audio 高级参数仅 metadata、blob 参考图、模型目录未产品化。  
