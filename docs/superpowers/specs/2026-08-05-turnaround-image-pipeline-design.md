# 角色设定图（多视图）智能二段式出图 — 产品与设计规格

> **状态**：P0 开发中  
> **日期**：2026-08-05  
> **关联**：[2026-08-03-atomic-studio-intent-design.md](./2026-08-03-atomic-studio-intent-design.md)、[2026-07-17-prompt-node-intent-templates-design.md](./2026-07-17-prompt-node-intent-templates-design.md)、PR #139（凡含「提示词」→ prompt 节点）

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.0 |
| 文档定位 | 多视图 utterance 的产品行为、路由、验收标准 |
| 实现计划 | [2026-08-05-turnaround-image-pipeline.md](../plans/2026-08-05-turnaround-image-pipeline.md) |

### 已确认决策（2026-08-05）

| # | 决策 | 说明 |
|---|------|------|
| **T1** | 多视图类 utterance **走智能二段式闭环** | 内部：character_turnaround 扩写 → 出图；对用户：**一步完成** |
| **T2** | 用户仍见 **单 image 节点** | 扩写结果写入节点字段，不在画布默认展示 prompt 子节点（P2 可选双节点） |
| **T3** | 含「提示词」的多视图句 **仍走 prompt-only** | 与 PR #139 一致：用户明确要文案时不自动出图 |
| **T4** | 多视图出图画幅 **2:1** | 禁止默认 16:9 宽屏单图 |
| **T5** | **轻提示**说明未用账户默认画幅 | 侧栏一句，无确认门、无弹窗 |
| **T6** | 分辨率沿用账户档位；**1K 软抬 2K** | 四格每格更清晰；轻提示中说明 |
| **T7** | 节点写入 `imageAspect` / `imageResolution` 实际值 | 便于重试与排查 |

---

## 一、问题陈述

### 1.1 现状（2026-08-05 生产实证）

用户输入「山海经吞金兽的三视图，CG风格」时：

| 现象 | 根因 |
|------|------|
| 系统回复「已创建 **image** 节点」 | utterance 无「提示词」→ `parse_atomic_target_type` → `image` |
| 未按四格模版出图 | image 路径原句直传 `generateImage`，未调用 `character_turnaround` |
| 非白底、非近景+正/侧/背 | 无模版约束；模型自由理解「三视图」为 3 格 |
| record `aspectRatio: 16:9`, `1024×576` | 默认宽屏单图，不适合四格拼图 |

生产 record 样例：`cmsfeo2pl02fhl901g8w2p6sw`（type=image, prompt=用户原句）。

### 1.2 用户预期

> 说「三视图 / 四视图 / 角色设定图」→ 直接得到**标准四格角色设定参考图**（白底、同一角色、面部近景 + 正/侧/背全身），**无需**说「提示词」、**无需**手动复制 prompt。

### 1.3 与现有能力的关系

| 路径 | 触发 | 现状 | 本规格 |
|------|------|------|--------|
| prompt-only | 含「提示词」 | prompt 节点 + `run_prompt_generation` | **不变** |
| image-direct | 普通主图/海报 | 原句直出 | **不变** |
| **turnaround_pipeline** | 多视图词且无「提示词」 | ❌ 等同 image-direct | **新增** |

`character_turnaround` 模版已存在于 `packages/agent` + `services/agent-runtime/app/tools/prompt_templates.py`，本规格将其**接入 image 出图链路**。

---

## 二、产品目标

| ID | 目标 |
|----|------|
| **G1** | 多视图类 utterance 自动走「模版扩写 → 出图」闭环 |
| **G2** | 用户感知为**一步完成**（单 image 节点 + 最终图） |
| **G3** | 扩写结果可追溯、可编辑、可重试（P1 UI） |
| **G4** | 非人物角色（神兽、机甲、道具等）同样适用 |

### 非目标（P0）

- 画布默认展示 prompt 子节点（留给 P2 power user 模式）
- 改动普通海报/主图的 image 直出路径
- 保证 100% 模型服从四格构图（v1 以 prompt 质量 + 画幅为主；构图失败 P2 加重试）

---

## 三、用户故事

> **作为**创作者，**当**我说「山海经吞金兽的三视图，CG 风格」，**我希望**系统直接给我一张四格角色设定参考图（白底、同一角色、近景 + 正/侧/背），**而不需要**我先说「提示词」或自己把 prompt 复制到 image 节点。

**对外命名建议**：侧栏/节点文案优先使用「**角色设定图（四格）**」，减少「三视图 vs 四格」语义冲突（模版为近景 + 正/侧/背 = 4 格）。

---

## 四、路由规则（AC-R）

### 4.1 路由表

| ID | 用户说法示例 | 路由 | 节点类型 | 是否出图 |
|----|-------------|------|---------|---------|
| **R1** | 山海经吞金兽的三视图，CG 风格 | `turnaround_pipeline` | image | ✅ 自动 |
| **R2** | 年轻女性模特四视图 | turnaround_pipeline | image | ✅ |
| **R3** | 角色设定图 / turnaround / 模特定妆图 | turnaround_pipeline | image | ✅ |
| **R4** | …三视图的**提示词** | `prompt_only` | prompt | ❌ 仅文本 |
| **R5** | 生成一张产品主图 | `image_direct` | image | ✅ 直出 |
| **R6** | 分镜提示词 | prompt_only | prompt | ❌ |

### 4.2 触发词（与 `packages/agent/src/prompt-modes/classify.ts` heuristic 对齐）

```
三视图|四视图|多视图|turnaround|角色设定|模特定妆|正侧背|模特图|
q版|q萌|chibi|二头身|洛丽塔|lolita|婚纱|战术|军事|牛仔|皮克斯|绘本|水彩
```

**判定逻辑**：

1. 若 utterance **含「提示词」** → `prompt_only`（PR #139，优先级最高）
2. 否则若命中上述触发词 → `turnaround_pipeline`
3. 否则 → 现有 `parse_atomic_target_type` 逻辑（image/text/video/…）

### 4.3 taxonomy 扩展（`intent-taxonomy.yaml`）

新增 `pipelines.turnaround_image`：

```yaml
turnaround_image:
  description: 多视图类 utterance 内部扩写 character_turnaround 后出图
  target_type: image
  prompt_mode: character_turnaround
  aspect_ratio: "2:1"
  studio_sequence:
    - run_prompt_expansion   # 内部，非独立 prompt 节点
    - run_image_generation
```

---

## 五、系统行为（AC-B）

### 5.1 内部二段式（对用户不可见）

```
utterance
  → [B1] is_turnaround_image_intent(utterance) == true
  → [B2] classifyPromptMode → character_turnaround
  → [B3] generatePromptContent → 四格结构化中文 prompt（单段）
  → [B4] generateImage(expandedPrompt, aspectRatio=2:1)
  → [B5] 写入 image 节点（url + 元数据）
```

### 5.2 image 节点字段

| 字段 | 含义 | 写入时机 |
|------|------|---------|
| `prompt` | 用户原话 | 建节点时 |
| `expandedPrompt` 或 `content` | LLM 扩写后的完整生图 prompt | 出图前 |
| `promptMode` | `character_turnaround` | 扩写后 |
| `pipeline` | `turnaround_image` | 建节点/出图时（便于排查） |
| `url` | 最终图片 | 出图完成 |
| `generationRecordId` | 出图 record | 出图完成 |

约定：

- **`prompt` 始终保留用户原句**，禁止用扩写结果覆盖。
- 下游 image 生成 **必须使用 `expandedPrompt`**，不得使用原句。
- 与 prompt 节点一致：`content` 有则优先用于展示扩写结果（P1 UI 折叠区）。

### 5.3 画幅规则（AC-B3）

| 条件 | aspectRatio | size 策略 |
|------|-------------|-----------|
| `pipeline=turnaround_image` | **2:1** | 长边 = 分辨率档位（见 §5.3.1） |
| `image_direct` | 用户/账户默认（通常 16:9） | 不变 |

**轻提示（T5）**：当账户默认画幅 ≠ 2:1 时，侧栏追加一句：

> 四格设定图已使用 **2:1** 画幅（非您的默认 {defaultAspect}）。

不弹窗、不二次确认。

#### 5.3.1 分辨率（T6）

| 账户默认档位 | turnaround 实际档位 | 2:1 像素（长边） |
|-------------|-------------------|-----------------|
| 1K | **2K（软抬）** | 2048×1024 |
| 2K | 2K | 2048×1024 |
| 4K | 4K | 4096×2048 |

**轻提示（T6 补充）**：当 1K 软抬 2K 时追加：

> 为保证四格清晰度，已按 **2K** 输出（高于您的默认 1K）。

节点 `data.imageResolution` 写入**实际使用值**（T7）。

### 5.4 用户可见回复文案（AC-B4）

```
原子创作：image 节点 — {title}
已按角色设定图模版扩写并出图；四格横排使用 2:1 画幅（非默认 {defaultAspect}）。
「{title}」生成完成。（record: xxx）
```

若 1K 软抬 2K，合并为一句：

```
…；画幅 2:1，分辨率 2K（四格清晰度优化，高于默认 1K）。
```

P1 可选：节点标签 `2:1 · 设定图`，hover 说明专用比例。

### 5.5 扩写 content 质量要求（AC-B5）

扩写结果须满足（与 `character-turnaround.ts` system 一致）：

- [ ] 含「画面分为四格布局」
- [ ] 第一格：近景 / 面部特写
- [ ] 第二～四格：正面 / 侧面 / 背面全身
- [ ] 背景默认「纯白背景」（赛博朋克 / 3D 等预设除外）
- [ ] 同一角色、同一服装发型，禁止每格换人
- [ ] 支持非人物（神兽、机甲、道具等）— system prompt 须 explicit 支持

### 5.6 失败降级（AC-B6）

| 场景 | 行为 |
|------|------|
| 扩写失败 | 节点 `status=error`；文案「提示词扩写失败，请重试或简化描述」 |
| 扩写成功、出图失败 | 保留 `expandedPrompt`；支持同节点重试出图（regenerate） |
| 出图完成但构图不像四格 | v1 接受；P2 提供「编辑提示词并重试」 |

---

## 六、实现落点（研发指引）

| 层 | 文件 | 改动 |
|----|------|------|
| **agent-runtime** | `app/graph/atomic_intent.py` | `is_turnaround_image_intent()`；`build_atomic_spec()` 增加 `pipeline: turnaround_image` |
| **agent-runtime** | `skills/atomic-create/intent-taxonomy.yaml` | 触发词 + pipeline 定义 |
| **agent-runtime** | `eval-intent-set.yaml` / tests | 新增 R1–R3 case |
| **apps/server** | `agent-canvas-tools.service.ts` | `startImageGeneration`：若 pipeline → 先 `generatePromptFromUserInput` → 再 `generateImage` |
| **packages/agent** | `modes/character-turnaround.ts` | system 补充非人物/神兽支持 |
| **deploy** | `prod-atomic-studio-verify.py` | 新增 turnaround smoke case |

**推荐主实现点**：`apps/server` 的 `startImageGeneration`（或抽取 `runTurnaroundImageGeneration`），避免 agent-runtime 编排两次 nest 调用的复杂度。

**agent-runtime 职责**：仅负责识别 pipeline 并将 `pipeline` 写入 `atomic_spec` / 节点 data；不在 Python 侧重复扩写逻辑。

---

## 七、验收用例（AC-T）

### T1 核心回归（生产 bug case）

**输入**：`山海经吞金兽的三视图，CG风格`

**期望**：

- [ ] 创建 **image** 节点（非 prompt）
- [ ] `record.type = image`
- [ ] 节点含 `expandedPrompt`，含四格描述 + 白底
- [ ] `aspectRatio` ≠ 16:9（应为 2:1 或 4:1）
- [ ] 侧栏回复含「角色设定图模版」或等价表述
- [ ] 传给 image API 的 prompt ≠ 用户原句

### T2 纯提示词路径不变

**输入**：`年轻女性模特三视图的提示词`

**期望**：

- [ ] prompt 节点
- [ ] **不**自动出图

### T3 普通出图不变

**输入**：`帮我生成一张蓝牙耳机主图`

**期望**：

- [ ] image 直出，无扩写步骤
- [ ] 无 `pipeline=turnaround_image`

### T4 非人物

**输入**：`赛博朋克机甲 turnaround，3D 渲染`

**期望**：

- [ ] turnaround_pipeline
- [ ] expandedPrompt 描述机甲，非强行套人类模特预设

### T5 自动化

- [ ] `test_atomic_create_intent.py`：turnaround utterance → `target_type=image` + `pipeline=turnaround_image`
- [ ] `test_atomic_create_intent.py`：含「提示词」→ 仍为 prompt，无 pipeline
- [ ] 生产 smoke：`deploy/prod-atomic-studio-verify.py` 新增 case PASS

---

## 八、分期

| 阶段 | 范围 | 交付 |
|------|------|------|
| **P0** | R1–R3 路由 + 二段式出图 + 2:1 画幅 + 节点存 expandedPrompt | 修复当前生产 bug |
| **P1** | UI 折叠「查看/编辑提示词」+ 仅重试出图 | 可控性与可调试 |
| **P2** | 可选双节点（prompt → image 可见链）；「仅要提示词不出图」快捷说法 | Power user |

**P0 PR 范围**：本规格 §四～§七 + 实现计划 Task 1–5。

---

## 九、成功指标

| 指标 | 目标 |
|------|------|
| 多视图类 utterance 走原句直出 image 的比例 | **0%**（P0 上线后） |
| 生产 smoke turnaround case | **PASS** |
| 用户需说「提示词」才能得到四格模版 | **否** |
| expandedPrompt 含四格结构关键词率 | **≥95%**（eval / 抽样） |

---

## 附录 A：与 PR #139 路由的关系

| utterance | PR #139 | 本规格 |
|-----------|---------|--------|
| 分镜**提示词** | prompt | prompt（不变） |
| 三视图**提示词** | prompt | prompt（不变） |
| 三视图（无提示词） | image 直出 ❌ | **turnaround_pipeline** ✅ |
| 产品主图 | image 直出 | 不变 |

## 附录 B：相关代码索引

- 模版：`packages/agent/src/prompt-modes/modes/character-turnaround.ts`
- 预设：`packages/agent/src/prompt-modes/modes/character-turnaround-presets.ts`
- 分类：`packages/agent/src/prompt-modes/classify.ts`
- 生成：`packages/agent/src/prompt-modes/generate.ts`
- 路由：`services/agent-runtime/app/graph/atomic_intent.py`
- 出图：`apps/server/src/agent/agent-canvas-tools.service.ts` → `startImageGeneration`
