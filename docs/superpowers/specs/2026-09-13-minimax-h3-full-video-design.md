# MiniMax 官方 H3 全能力视频接入设计

> 日期：2026-09-13  
> 状态：已批准（含 BYOK §3.7；P0 实现计划见 `../plans/2026-09-14-minimax-h3-p0-video.md`）  
> 范围：经 **MiniMax Open Platform** 接入 **`MiniMax-H3` 全能力**（T2V / I2V / 首尾帧 / Reference / Context-IR / 768P→2K Regeneration）  
> 非目标：fal H3 Max 最小接入（见姊妹规格）、H3 Max Director / fal.live、自托管开源权重部署  
> 前置：`VideoProvider`、`videoModelProfiles`、Seedance 多模态 refs 先例（`2026-08-08-seedance-agnes-video-adapter-design.md`）  
> 上游：[Video Generation](https://platform.minimax.io/docs/guides/video-generation)、[Pay as you go](https://platform.minimax.io/docs/guides/pricing-paygo)

## 0. 决策摘要

| 项 | 结论 |
|----|------|
| 接入通道 | **MiniMax 官网**；默认 base `https://api.minimax.io` |
| 凭证 | **平台 `MINIMAX_API_KEY`（+ 可选 `MINIMAX_BASE_URL`）与用户 BYOK 双轨**（通道内配 apiKey + baseUrl）；见 §3.7 |
| 主模型 | catalog：`minimax-h3` → gateway `MiniMax-H3` |
| 可选同栈 | `minimax-h3-max` → `MiniMax-H3-Max`（**仅 T2V/I2V**，能力子集；可与 fal Max 对照，默认 **二期**） |
| Provider | `MiniMaxH3VideoProvider`（`VideoProvider` + 扩展内部方法处理 IR/Regeneration） |
| API 形态 | 异步：`POST /v2/video_generation` → `GET /v2/query/video_generation/{task_id}`；IR / Regeneration 独立 create |
| content[] | 官方 multimodal：`text` / `image_url` / `video_url` / `audio_url` + `role` |
| Dock | 模式：文生 / 图生 / 首尾帧 / **参考生成（新）**；IR、Regeneration 为显式动作（非默默替换主按钮） |
| 积分 | `视频生成` + 可选 `视频提示增强`（IR）、`视频超分再生`（Regeneration）；按时长×分辨率价目映射；**BYOK 计费对齐现网视频 BYOK** |
| 与 fal Max 规格关系 | **并行可选**；禁止同一请求双计费；默认平台视频仍可为 Agnes/Seedance，H3 为新增 |

## 1. 背景与目标

官方 H3 是 **能力完整** 的多模态视频模型（含参考音视频、Context-IR、2K regeneration）。适合成片质量与可控性，**不**承担 fal Max 的超实时叙事。

成功标准：

- Dock 可选 `MiniMax-H3`，四种生成模式可跑通并落节点。  
- Context-IR → 回填增强 prompt → 再生成，链路可测。  
- 768P 成片可一键 Regeneration 到 2K（权限与积分清晰）。  
- 无 key / 余额不足时失败可读、退款正确。

## 2. 范围

### 2.1 做（分期）

| 期 | 内容 |
|----|------|
| **P0** | T2V、I2V（首帧）、首尾帧；catalog + Provider + 积分；轮询与退款 |
| **P1** | Reference-to-video（≤9 图 / ≤3 视 / ≤3 音，合计 ≤12）；Dock「参考生成」模式 + caps |
| **P2** | H3-Context-IR 任务 + UI「增强提示」；Regeneration 768P→2K |
| **P3（可选）** | 平台 catalog 增加 `minimax-h3-max`（官网 Max，仅 T2V/I2V） |

### 2.2 不做

- fal 端点、Director、直播  
- 用文生图口头「放大」冒充 Regeneration  
- 把 H3 设为唯一默认（除非另开产品决策）  
- Token Plan / 订阅 key 双轨（一期只 Pay-as-you-go API Key）

## 3. 上游契约（MiniMax）

### 3.1 模型与输出规格

| | MiniMax-H3 | MiniMax-H3-Max（可选） |
|--|------------|----------------------|
| 分辨率 | **768P / 2K** | 480P / 768P |
| 时长 | **4–15** 整数秒 | 5–15 |
| 模式 | T2V、I2V、首尾帧、Reference | 仅 T2V、I2V |

### 3.2 生成任务 `POST /v2/video_generation`

Payload 核心：

```json
{
  "model": "MiniMax-H3",
  "content": [ /* 见下 */ ],
  "duration": 5,
  "resolution": "2K",
  "ratio": "16:9"
}
```

**content[] 角色映射**

| 模式 | content 组成 |
|------|----------------|
| T2V | `{type:text,text}`；**ratio 必填且不可 adaptive** |
| I2V | text + `image_url` `role=first_frame`；ratio 由图像决定（adaptive） |
| 首尾帧 | text + first_frame + last_frame |
| Reference | text + `role=reference_image\|reference_video\|reference_audio` 多项 |

输入限制（实现校验，失败 400）：

- 图：边长 [256,5760]，比例 2:5–5:2，≤30MB/张  
- 视频：≤3，单段 [2,15]s，合计 ≤15s，≤50MB  
- 音频：≤3，单段 [2,15]s，≤15MB  
- 混合文件 ≤12；prompt ≤7000 字符  

### 3.3 查询

`GET /v2/query/video_generation/{task_id}`  
`task.status`: `succeeded` → `task.content.url`；`failed`/`cancelled` → 抛错退款。  
建议 poll **10s**（官方推荐），`maxPollMs` ≥ 15–20min。

### 3.4 Context-IR

- Create H3-Context-IR（独立 endpoint，见官方 API 索引）  
- 成功：`content.prompt` 增强稿；**不产视频**  
- UI：用户确认后写入 Dock prompt，再调 P0/P1 生成  

### 3.5 Regeneration

- 源须为 **本模型产出的 768P** 规格视频  
- 请求复现原 `content` + `role=base_video` 的源视频  
- 输出 2K；积分走「视频超分再生」  

### 3.6 官方价目（积分映射用，USD）

| 项 | 价 |
|----|-----|
| H3 768P 输出 | $0.08 / s |
| H3 2K 输出 | $0.13 / s |
| H3-Max 480P / 768P | $0.05 / $0.08 / s |
| 参考图 | 前 5 张免；其后 $0.04/张 |
| 参考视频输入 | 按输出分辨率同档 $/s |
| Regeneration 768→2K | $0.05 / s 输出 + 材料再计规则 |
| Context-IR | $0.90 / M in + $3.60 / M out |

### 3.7 凭证：平台 env + 用户 BYOK

用户可在 **自定义 BYOK / Provider 通道** 中配置 **API Key + Base URL**，与 Agnes、APIMart 视频通道同一套产品与数据模型。

| 选型 | 凭证来源 |
|------|----------|
| `platform::minimax-h3`（及 P3 的 `platform::minimax-h3-max`） | `MINIMAX_API_KEY`；base 默认 `https://api.minimax.io`（`MINIMAX_BASE_URL` 可覆盖） |
| 用户通道 `channelId::MiniMax-H3`（或 catalog modelKey） | 该通道的 **apiKey** + **baseUrl**（用户填写官方或兼容网关） |

硬约束：

1. **`ProviderResolver` 解析结果优先**：`createVideoProvider` / `MiniMaxH3VideoProvider` 必须吃 resolved `apiKey`+`baseUrl`，禁止只读进程 env 而绕过 BYOK。  
2. **鉴权头**：`Authorization: Bearer ${apiKey}`（官方 Open Platform）。  
3. **baseUrl**：`safeOutboundUrl`；路径拼接为 `{base}/v2/video_generation` 等（注意 base 是否已含 `/v2`——实现时归一化，规格要求 **单测锁定**）。  
4. **计费**：`source === 'user'` 时对齐现网视频 BYOK（§5.4）；平台路径才按 §5.1–5.3 扣平台点。  
5. **IR / Regeneration** 与主生成 **共用同一套凭证解析**（同一通道 Key）。  
6. metadata：`credentialSource`、`channelId`（若有）。

## 4. 本仓库架构

```text
VideoDockPanel
  modes: text_to_video | image_to_video | first_last_frame | reference_to_video
  actions: enhance_prompt (IR) | regenerate_2k
    → Nest generateVideo / new studio endpoints for IR & regen
    → ProviderResolver（platform MINIMAX_* 或 BYOK 通道）
    → MiniMaxH3VideoProvider({ apiKey, baseUrl })
    → {baseUrl}/v2/...
```

### 4.1 Provider 职责

```ts
class MiniMaxH3VideoProvider implements VideoProvider {
  generate(prompt, options): Promise<{ url }>
  // 内部或并列导出：
  enhancePrompt(input): Promise<{ prompt: string; taskId: string }>
  regenerate2k(input): Promise<{ url: string; taskId: string }>
}
```

`generate` 根据 `options.refWire` / `videoMode` / refs 组装 `content[]`。

### 4.2 Profile

```ts
refWire: 'minimax_h3_content'  // 新枚举
responseMode: 'minimax_poll'
minDuration: 4
maxDuration: 15
allowedResolutions: ['768p', '2k']
maxImageRefs: 9
maxVideoRefs: 3
maxAudioRefs: 3
```

Capabilities：

- `supportsFirstLastFrame: true`  
- `supportsVideoRef / AudioRef: true`（P1）  
- `supports4K: false`（2K ≠ 4K；UI 显示 2K）  
- 新增可选：`supportsContextIr` / `supportsRegen2k`（P2）

### 4.3 Catalog

| modelKey | displayName | gateway |
|----------|-------------|---------|
| `minimax-h3` | MiniMax H3 | `MiniMax-H3` |
| `minimax-h3-max`（P3） | MiniMax H3 Max | `MiniMax-H3-Max` |

平台 channel：新增 env `MINIMAX_API_KEY` + `MINIMAX_BASE_URL`（默认 `https://api.minimax.io`）；`ProviderResolver` 对 `platform::minimax-h3` 走该凭证。  
用户 BYOK：在通道设置里填同一模型族的 Key/Base，选型 `channelId::…` 时走通道凭证（§3.7）。

### 4.4 Nest API

| 路径 | 用途 |
|------|------|
| 现有 `material/generate-video` / studio video | P0/P1 `generate` |
| `POST /studio/video/context-ir`（名可调） | P2 IR |
| `POST /studio/video/regenerate-2k` | P2 Regeneration |

Agent：同 service；tool 名建议 `generate_video` 已存在则扩参数，或 `enhance_video_prompt` / `regenerate_video_2k`。

### 4.5 Dock UX

- 模型选 `MiniMax H3` 后：模式四选一（P1 起四模式；P0 三模式）。  
- 「增强提示」：busy → 回填 prompt（可 diff 预览 P2 简化为直接替换+toast）。  
- 「生成 2K」：仅当当前节点 metadata `resolution=768P` 且 `provider=minimax-h3` 时可用。  
- Reference 模式：复用 Dock refs 芯片（I*/V*/A*），校验数量上限。

## 5. 积分档位

### 5.1 主生成（`视频生成`）

将官方 $/s 映射为积分（一期锁表，可配置）：

定义 **基准**：现网 `videoCredits(duration)` 视为「通用视频」价。  
H3 使用：

```text
points = ceil(durationSeconds * POINTS_PER_USD * usdPerSecond(resolution))
```

或更稳妥（与现网可比）：

| resolution | 相对现网 base 的系数（锁定） |
|------------|------------------------------|
| 768P | `base × 1.2` |
| 2K | `base × 1.8` |

另加参考材料附加（P1）：

- 参考图超过 5：每张 +`N` 点（建议 N=5，对齐 $0.04 量级）  
- 参考视频：按输入秒数加 `base` 同分辨率系数的一部分（规格实现时写死 `refVideoPointsPerSec`）

### 5.2 Context-IR（`视频提示增强`）

- 固定价 **15 点/次**（或按返回 token 粗估）；失败退款。  
- reason-map 增加匹配 → `video` category。

### 5.3 Regeneration（`视频超分再生`）

- `ceil(duration * factor2kRegen)`，建议与 2K 生成同档或略低（对齐 $0.05/s vs $0.13/s → **约 base×0.7**）。  
- reason-map：`视频超分再生` → video。

### 5.4 BYOK

用户自带 MiniMax Key（通道 `apiKey` + `baseUrl`）：

- **实现时对齐 Seedance / 现网视频 BYOK 分支，本规格不发明第三套。**  
- 典型行为：不扣或少扣平台「视频生成」点；上游余额/鉴权错误走 `classifyByokFailure`；已扣平台点的边界退款策略与现网一致。  
- UI：BYOK 通道可选 `minimax-h3`（及 P3 `minimax-h3-max`）；pull-models 若官方支持则复用通道「拉取模型」，否则 catalog 静态列表即可（P0 允许静态）。

## 6. 错误与合规

- 校验 content 上限，避免上游 400。  
- 内网 upload URL 必须 inline/公网。  
- 取消：若官方支持 cancel API，对接 `cancelGeneration`；否则超时即停轮询+退款策略写明。  
- 日志禁止打印完整 API Key。

## 7. 测试与验收

| 期 | 验收 |
|----|------|
| P0 | T2V 5s 768P；I2V；首尾帧；无 key 错误；扣退款；**BYOK 通道 Key 优先于平台 env** |
| P1 | Reference 含 1 视频+2 图；超限 400 |
| P2 | IR 回填；768 片 Regen 得 2K 新节点 |
| 回归 | Agnes / Seedance 路径无破坏 |

## 8. PR 拆分

| PR | 内容 |
|----|------|
| M1 | P0 Provider + catalog + credits + Dock 三模式 |
| M2 | P1 Reference |
| M3 | P2 IR + Regeneration |
| M4 | 可选官网 H3-Max |

**禁止**与 `fal-h3-max-video-min` 绑成同一大 PR（通道/密钥/能力面不同）。

## 9. 与 fal Max 规格对照

| | fal H3 Max 最小 | 本规格官方 H3 |
|--|-----------------|---------------|
| 密钥 | `FAL_KEY` | `MINIMAX_API_KEY` |
| 速度叙事 | 超实时（Max） | 常规异步 |
| 最高分辨率 | 768P | **2K** |
| Reference | 否 | **是（P1）** |
| IR / Regen | 否 | **是（P2）** |
| 推荐用途 | 快试、低延迟体验 | 成片可控、多模态参考 |

产品默认建议：**先落地 fal Max 最小验证体验**；**并行或紧随 M1 开官方 H3 P0**，避免用户误以为「H3=秒出片」。

## 10. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-09-13 | 初稿：官方 H3 全能力分期；积分与 content[] 映射锁定 |
| 2026-09-13 | 锁定 BYOK：用户通道可配 apiKey + baseUrl，与平台 MINIMAX_* 双轨 |
