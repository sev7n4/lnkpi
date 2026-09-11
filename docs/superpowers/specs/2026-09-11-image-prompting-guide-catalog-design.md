# Image Prompting Guide Catalog（设计文档）

> 状态：§1–§4 已定稿并写入  
> 日期：2026-09-11  
> 范围：将 OpenAI API《Image prompting》指南（生成类场景 + 编辑类 intent）嵌入本项目工作流  
> 上游参考：https://developers.openai.com/api/docs/guides/image-prompting  
> 相关既存：`packages/agent/src/prompt-modes/`（7 种 promptMode）、`imageEditProfiles`、RefineSidePanel 去污预设、atomic `prompt-mode-taxonomy.yaml`

## 决策摘要

| 项 | 选择 |
|---|---|
| 官方资产范围 | API《Image prompting》生成类 9 + 编辑类 8；非 ChatGPT Poster/Merch 产品 Templates |
| 本期落地 | **P0**：fundamentals + G3 + G1 + E3 + E4 + E5 |
| 产品路径 | **Dock 先行**；Agent **仅 taxonomy 钩子**（写 guide id，不强制自动出图/多轮编辑） |
| 架构 | **方案 2**：双轨 Catalog（generation_scene / edit_intent），与现有 7 个 `promptMode` 并存 |
| 模型策略 | **本期 B**：仍用 `image2`；参数契约 + capability 降级 |
| Image 2.5 | **另开专项**接入 Flare/Sunburst；本规格 **附录** 约束验证与迭代门禁 |
| 不做 | 17 个新 promptMode、假透明底、ChatGPT Templates/Sketch、Agent 全自动多轮编辑流水线 |

---

## §1 架构与数据模型

### 1.1 目标

在不更换 Image 2.5 模型的前提下，把官方指南的 P0 场景嵌进工作流：

1. Catalog（场景/intent 资产）
2. Dock 可选
3. 参数契约与降级
4. Agent taxonomy 钩子
5. 规格附录指导日后 Image 2.5 验证迭代

### 1.2 双轨 Catalog

新建共享包模块（Web / Server / Agent 共用），建议路径：

`packages/shared/src/imagePromptingGuide/`

```
catalog.ts
types.ts
fundamentals.ts
scenes/
  g3-exact-text.ts
  g1-style-lighting.ts
intents/
  e3-identity-clothing.ts
  e4-combine-refs.ts
  e5-transparent-cutout.ts
```

- **不**把编辑 intent 塞进 `PromptModeId`。
- 生成 scene **可以**引用现有 `promptMode`（如未来 G6 → `storyboard`），但 P0 以独立 scene/intent 为主。

### 1.3 核心类型

```ts
type GuideKind = 'generation_scene' | 'edit_intent'

interface ParamContract {
  size?: string
  quality?: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  background?: 'auto' | 'opaque' | 'transparent'
  outputFormat?: 'png' | 'webp' | 'jpeg'
}

interface CapabilityGate {
  requiresTransparentBackground?: boolean
  minRefImages?: number
  maxRefImages?: number
  requiresSubjectRef?: boolean
}

interface GenerationScene {
  id: 'g3_exact_text' | 'g1_style_lighting' | string
  kind: 'generation_scene'
  label: string
  description: string
  fundamentalsRefs: string[]
  promptScaffold: string
  fewShot?: { user: string; assistant: string }
  preferredParams: ParamContract
  capability: CapabilityGate
  /** null = 仅预填，不改 classify */
  expandViaPromptMode?: PromptModeId | null
}

interface EditIntent {
  id: 'e3_identity_clothing' | 'e4_combine_refs' | 'e5_transparent_cutout' | string
  kind: 'edit_intent'
  label: string
  description: string
  changePreserveTemplate: string
  refRoles: Array<{ role: string; required: boolean; hint: string }>
  preferredParams: ParamContract
  capability: CapabilityGate
}
```

### 1.4 数据流

```
[Dock 选 scene/intent]
  → node.data.guideSceneId / guideEditIntentId（编辑会话可只挂会话元数据）
  → 预填 scaffold 或 change/preserve 模板
  → resolveGuideRequest(guide, profile, userOverrides)
       ├─ ok → 合并参数到生成/编辑请求
       └─ unsupported → UI 禁用 + reason（尤其 E5）

[Prompt 扩写]（generation_scene 且 expandViaPromptMode 有值）
  → 现有 generatePrompt + scene system 片段 + fundamentals

[Image 生成 / Image Edit]
  → 仍走 image2 / imageEditProfiles
  → 仅附加可映射的 preferredParams

[Agent taxonomy 钩子]
  → utterance → guideSceneId | guideEditIntentId
  → 本期不强制自动出图 / 连环编辑
```

### 1.5 P0 收录清单

| ID | 类型 | Dock 入口 |
|----|------|-----------|
| `fundamentals` | 共享规则 | 隐式注入，无独立按钮 |
| `g3_exact_text` | 生成 | Prompt Dock（Image Dock 可镜像） |
| `g1_style_lighting` | 生成 | 同上 |
| `e3_identity_clothing` | 编辑 | Refine 侧栏 intent 芯片 |
| `e4_combine_refs` | 编辑 | 同上 |
| `e5_transparent_cutout` | 编辑 | 同上；无透明底则禁用 |

### 1.6 本期明确不做

- 接入 `gpt-image-2.5-flare` / `gpt-image-2.5-sunburst`
- 一次做完 G2–G9 / E1–E8 全量
- 把 17 个场景都加成新 `promptMode`
- Agent 全自动多轮编辑流水线

---

## §2 Dock UX 与交互

### 2.1 入口拆分

| 类型 | 入口 | 交互 |
|------|------|------|
| 生成 scene（G3 / G1） | Prompt Dock 为主；Image Dock 可「套用场景」 | 轻量选择器，非大向导 |
| 编辑 intent（E3 / E4 / E5） | RefineSidePanel（对齐现有去污预设） | 点选 → 填入模板 |
| fundamentals | 无按钮 | 服务端隐式并入 |

### 2.2 生成侧

1. 工具栏增加「场景模板」芯片：`精确文字`、`风格与光线`。
2. 选中后写入 `guideSceneId`：
   - prompt 为空 → 填入 `promptScaffold`（可替换占位）
   - prompt 非空 → **不覆盖**，只挂 sceneId + 提示「已套用场景约束」
3. 「生成提示词」：
   - 有 `expandViaPromptMode` → 现有扩写 + scene 片段 + fundamentals
   - 无 → 仅预填
4. Image Dock 套用时映射 `preferredParams` → 现有 aspect / resolution；失败则保留用户参数并弱提示。

### 2.3 编辑侧

1. 去污预设旁增加 intent 芯片：`换装保身份` / `多参考合成` / `透明抠图`。
2. 选中后：填入 `changePreserveTemplate`；展示 `refRoles` 提示；记录 `guideEditIntentId`。
3. Capability 门禁：
   - E5 无透明底 → disabled + tooltip 指向 Image 2.5 专项后启用
   - E3/E4 参考不足 → 可选中，应用时拦截
4. 本期 intent **不强制** mask；E5 以整图抠图 + `background=transparent` 为主。

### 2.4 状态与兼容

- 已选模板显示可清除标签；清除不自动清空用户 prompt。
- 降级/禁用一律明示原因；禁止假棋盘格透明。
- `promptMode` 与 `guideSceneId` 可并存。
- 三视图 hint、商业分镜预览、去污预设行为不变；intent 与去污并列，后点覆盖 prompt 模板。

### 2.5 刻意不做的 UX

- 多步 Wizard / 全屏模板画廊
- ChatGPT Poster/Merch Templates
- 首屏塞满 17 个场景

---

## §3 参数契约、降级与 Agent taxonomy 钩子

### 3.1 参数解析

```ts
resolveGuideRequest(guideId, currentProfile, userOverrides)
  → { params, applied: string[], skipped: string[], blocked?: { reason: string } }
```

优先级：**blocked 门禁 > 用户显式覆盖 > scene preferred > 模型/系统默认**。

| 契约字段 | 本期（image2）行为 |
|----------|-------------------|
| size / 画幅 | 映射 aspect + resolution；失败则 skipped |
| quality | provider 支持则带上；否则 skipped（P0 不用 forceQuality） |
| background=transparent | capability 探测；不支持则 E5 blocked |
| outputFormat=png | 与透明底绑定；随 E5 blocked |

### 3.2 降级表

| 情况 | UI | API |
|------|----|-----|
| E5 无透明底 | 禁用 + 明确文案 | 不发假透明请求 |
| size 映射失败 | 弱提示保留当前画幅 | 用用户当前参数 |
| quality 不支持 | 不阻断 | 省略字段 |
| E3/E4 缺参考 | 应用时拦截 | 不发请求 |
| 未知 guide id | 当无模板 | 忽略 |

### 3.3 Capability 探测

在 `imageModelProfiles` / `imageEditProfiles` 增加可选能力位，例如：

```ts
capabilities: {
  transparentBackground: false, // 验证 APIMart 后可改 true
  qualityParam: true,
  maxRefImages: number,
}
```

Catalog 只声明需求；是否满足看 profile。Image 2.5 专项改 profile 即可解锁 UI，无需改 Catalog/Dock。

### 3.4 Agent taxonomy 钩子

新增平行 taxonomy（镜像 `prompt-mode-taxonomy.yaml`），例如 `image-prompting-guide-taxonomy.yaml`，Python 侧 `resolve_guide_scene` / `resolve_guide_edit_intent`。

P0 触发词（示意，实现时保守宁可漏报）：

| ID | 关键词示例 |
|----|------------|
| `g3_exact_text` | 精确文字、标语必须、tagline、不要多余字 |
| `g1_style_lighting` | 光影、胶片感、35mm、candid |
| `e3_identity_clothing` | 换装、只换衣服、保留脸、试穿 |
| `e4_combine_refs` | 合成、放到场景、图1图2、combine |
| `e5_transparent_cutout` | 抠图、透明底、去背景、cutout |

本期行为：

1. 命中则写入 `guideSceneId` / `guideEditIntentId`
2. 不自动连环出图/多轮编辑
3. 与 `prompt_mode` 并存：guide 不覆盖 mode
4. E5 命中但 capability 不足 → 澄清或仅挂 id 显示禁用态
5. yaml 同步进 atomic-create skill assets

---

## §4 错误处理、测试与分期边界

### 4.1 错误处理原则

- 未知 guide id：静默当未选模板
- E5 blocked：UI + 请求层双重校验
- 扩写失败：不因 scene 片段导致整链崩溃；可降级仅 scaffold
- **不静默改图意**（尤其不假透明、不清空用户 prompt）

### 4.2 测试（本期必做）

1. Catalog：P0 注册完整；`resolveGuideRequest` 三态
2. Capability：`transparentBackground` false→E5 blocked；true→可 applied
3. taxonomy：中英命中；与 prompt_mode 并存
4. Dock：空 prompt 预填；非空不覆盖；清除标签不丢 prompt；Refine 填模板
5. 回归：7 promptMode、三视图 pipeline、去污预设

不做：全量视觉金样人工打分（留给 Image 2.5 附录流程）。

### 4.3 分期

| 期次 | 内容 |
|------|------|
| 本期 | Catalog 骨架 + fundamentals + P0 + Dock + 参数契约/降级 + Agent 钩子 + 本附录 |
| 下期 A | Catalog 补全其余 G/E；按需映射现有 mode |
| 下期 B | Image 2.5 模型接入专项（见附录） |
| 不做 | ChatGPT Templates/Sketch、17 新 promptMode、Agent 全自动多轮编辑 |

### 4.4 文件落点

| 区域 | 路径/职责 |
|------|-----------|
| shared | `packages/shared/src/imagePromptingGuide/*` |
| agent | 扩写叠加 scene；taxonomy yaml |
| web | Prompt/Image Dock 场景选择；RefineSidePanel intent |
| agent-runtime | `resolve_guide_*` + skill assets 同步 |
| docs | 本设计 + 附录 |

### 4.5 成功标准

- Dock 可选 P0，行为符合 §2
- E5 无透明能力时稳定禁用；有能力时改 profile 即启用
- Agent 仅挂 id，不改变现有自动出图主路径
- 附录可直接开 Image 2.5 专项，验收项无需再争论

---

## 附录 A：Image 2.5 模型接入 — 验证与迭代门禁

> 本期不实现模型接线；专项开工时以本附录为验收契约。

### A.1 目标模型

| 模型 | 角色 |
|------|------|
| `gpt-image-2.5-flare`（或网关等价） | 速度优先；质量接近/对标 GPT Image 2 |
| `gpt-image-2.5-sunburst`（或网关等价） | 质量优先 |

参数与 prompt 解耦：`quality` / `size` / `background` 走 API，不塞进自然语言 prompt。

### A.2 基线包（Baseline Pack）

在切换模型前，用 **image2 + 本期 Catalog** 固化基线：

| 场景 | 最少金样数 | 必备输入 |
|------|------------|----------|
| G3 精确文字 | 3 | 含引号文案 +「出现一次/禁止多余字」 |
| G1 风格光线 | 3 | 主体 + 光/镜头/质感 + 排除重修图 |
| E3 换装保身份 | 3 | 人物图 + ≥1 服装参考 |
| E4 多参考合成 | 3 | 场景图 + 主体图 + 落点说明 |
| E5 透明抠图 | 3 | 产品图；断言真实 alpha（非棋盘格像素） |

每条金样记录：prompt、参考图、期望断言、当前 image2 输出（或哈希/URL）、当时 params。

### A.3 验收维度

对比候选模型 vs image2 基线时，至少检查：

1. 指令遵循（改/保边界）
2. 身份 / 产品几何保真
3. 文字准确与多余字
4. 透明通道（E5）：解码后 alpha；发丝/边缘/阴影
5. 无多余改动（背景、构图、光）
6. 一致性：同请求重复 N 次的漂移
7. 延迟与失败率 / 重试成本

### A.4 切换门禁（官方迁移顺序产品化）

1. 固定 prompt、参考图、尺寸、output format，先比模型。
2. 若 image2 已满足质量 → 先测 **Flare** 是否保质降延迟。
3. 若 image2 不满足复杂用例 → 先测 **Sunburst** 达标，再回头测 Flare。
4. 质量达标后再调 `quality` 档位；一次只改一个变量。
5. 按 **workflow** 灰度（先 P0 edit intents，再 generation scenes）；保留 image2 回滚。
6. 通过后将 profile `capabilities.transparentBackground`（等）置 true，跑附录回归：E5 从 blocked → enabled。

### A.5 解锁与回滚

- Catalog / Dock **不**硬编码 2.5 model id。
- 解锁只改 profile capability + 默认 model key。
- 回滚：默认 profile 回到 image2；E5 若失去透明能力自动回到 disabled。

### A.6 专项交付物清单

- [ ] `studioModelCatalog` + `imageModelProfiles` / `imageEditProfiles` 条目
- [ ] generation-adapter / image-provider 接线与计费
- [ ] 基线包目录与自动化/半自动对比记录
- [ ] capability 解锁 PR + E5 回归绿
- [ ] 灰度与回滚 runbook（可附在专项 plan）

---

## 官方场景全表（供下期 A 填 Catalog）

### 生成类（9）

1. Control style and lighting → P0 `g1_style_lighting`
2. Explain a process visually
3. Render exact text → P0 `g3_exact_text`
4. Design a reusable logo（强依赖 transparent）
5. Historical / real-world context
6. Story → comic strip（可映射 storyboard）
7. Interface preview
8. Scientific / educational visuals
9. Slides / diagrams / charts

### 编辑类（8）

1. Translate while preserving layout
2. Transfer a visual style
3. Preserve identity and change clothing → P0 `e3_identity_clothing`
4. Combine references → P0 `e4_combine_refs`
5. Transparent product cutout → P0 `e5_transparent_cutout`
6. Drawing → realistic
7. Remove an object
8. Insert a person into a scene

---

## Spec Self-Review

- [x] 无 TBD/TODO 占位要求
- [x] 生成/编辑双轨与「不塞进 promptMode」一致
- [x] 本期范围与附录 2.5 专项边界清晰
- [x] E5 降级与 capability 解锁路径无歧义
- [x] Agent 钩子「只写 id」无歧义
