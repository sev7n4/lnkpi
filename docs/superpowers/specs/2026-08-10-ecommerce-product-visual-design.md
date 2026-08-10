# 实物产品视觉出图 — 全行业通用四阶段闭环规格

> **状态**：一期实现中  
> **日期**：2026-08-10  
> **关联**：[2026-08-05-turnaround-image-pipeline-design.md](./2026-08-05-turnaround-image-pipeline-design.md)、[2026-08-08-image-upstream-capability-design.md](./2026-08-08-image-upstream-capability-design.md)、[2026-07-25-agent-topology-preview-hitl-design.md](./2026-07-25-agent-topology-preview-hitl-design.md)

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.9 |
| 产品分期 | **一期（本规格实现范围）**：仅 **出图**；**二期（规划）**：融入 **出视频** |
| Skill 名 | `ecommerce-product-visual`（工程名；**产品 scope = 全行业可销售实物**，见下） |
| `flow_mode` | `product_visual`（一期）；二期拟扩展为 `product_visual` 内混合 image + video |
| 实现计划 | [2026-08-10-ecommerce-product-visual.md](../plans/2026-08-10-ecommerce-product-visual.md)（**仅覆盖一期**） |

---

## 规格范围（必读）

### 本规格是什么

**一套面向「任何可销售、可推广、可营销的实物产品」的通用视觉生产编排。**

适用：**各行各业**的实物——消费品、3C、美妆、服饰、食品、机械工业品、零部件、建材、母婴、宠物等。用户上传**实拍**，系统走**同一套**四阶段流水线：

```
Phase 1 图源准入 → Phase 2 方案（类型×变体）→ Phase 3 并行生图 → Phase 4 定稿交付
```

> **产品分期：** 见下节 **§「产品分期：一期 / 二期」**。本文档实现与验收 **仅针对一期（出图）**；出视频属二期，一期架构须为其预留扩展口但 **不实现**。

**全行业标准相同的是编排；因行业/任务而异的只有 Phase 2「方案文本节点」的输出：**

| 可变项（仅 plan 决定） | 示例 |
|------------------------|------|
| **要生成哪些图片类型** | 电商：主图、详情图、模特展示、细节、卖点、推广海报；机械：外观图、规格标注、安装场景；包装：盒型、结构、缓冲示意 |
| **方案内关键要素** | 电商：卖点、渠道、风格；机械：尺寸/接口/安全警示；包装：材质、缓冲、物流 |

### 通用 vs 差异：边界（研发必读）

```
┌─────────────────────────────────────────────────────────────────┐
│  全行业通用层（实现一次，不按行业拆 Skill / flow）                  │
│  Phase 1 QA → 标准产品资产 │ Phase 2 方案门 │ Phase 3 并行 gen     │
│  Phase 4 按类型定稿 │ 每类型最终 1 张 │ 禁止 prompt 融合          │
└─────────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  方案节点产出层（LLM；manifest 仅为可选模板库）                     │
│  · 激活哪些 ImageType   · 每 scheme 的 key_elements / constraints │
└─────────────────────────────────────────────────────────────────┘
```

| 边界问题 | 结论 |
|----------|------|
| 按行业拆 Skill？ | **否**。一个 Skill；行业知识在 Skill `references/` + plan prompt |
| 按行业写死类型清单？ | **否**。模板库是示例；plan 可增删类型 |
| 电商/包装/机械是否不同产品？ | **否**。同一 `ImageType` 机制；`domain_tags` 仅描述 |
| 差异从哪来？ | **仅** `plan_product_visual` 结构化输出 |
| Campaign？ | 详情页营销全链路+固定 manifest；本规格是**实拍驱动、动态 visual** |

### 产品分期：一期 / 二期

| 分期 | 范围 | 产出媒介 | 本规格状态 |
|------|------|----------|------------|
| **一期** | 四阶段闭环 **仅出图** | `ImageType` → 图片节点（`target_type: image`） | **当前实现与验收范围** |
| **二期** | 在同一编排内 **融入出视频** | `VideoType` / 混合 plan → 视频节点（`target_type: video`） | **规划占位；一期不开发** |

**一期明确包含：**

- Phase 1~4 全链路，对象均为**静态图片**（含模特/场景/包装/空间等所有人感图，仍是 image gen）
- plan 动态规划 **图片类型** × 变体；Phase 3 并行 **image** gen；Phase 4 按类型定稿 **图片**
- CVS 三案例（电商保温杯 / 大闸蟹包装 / 室内装修）均为 **出图验证**

**一期明确不包含（禁止 scope creep）：**

- 产品短视频、主图视频、开箱视频、场景漫游视频等 **任何 video gen**
- `run_video_generation` / 视频 manifest 条目 / 视频定稿 UX
- 图生视频（I2V）、视频延长、视频配音 mux（Campaign 现有 video 能力 **不在此 Skill 一期复用**）

**二期方向（规划摘要，非一期交付）：**

```
同一 flow_mode / 同一四阶段骨架
  Phase 2 plan 可输出 ImageType[] + VideoType[]（或 MediaType 统一模型）
  Phase 3 **分两段 gen**（见 L13）：先 image 定稿 → 再 video（depends_on 已定稿图）
  Phase 4 按「媒介 × 类型」分组定稿（如：主图静帧 + 15s 展示短视频）
```

| 二期示例产出 | 说明 |
|--------------|------|
| 产品展示短视频 | 模特手持产品 5~15s |
| 包装开箱视频 | 大闸蟹礼盒送礼场景动态展示 |
| 空间漫游 / 装修效果视频 | 人在客厅中的短镜头 |

**一期为二期预留（实现时遵循，避免返工）：**

- plan 结构化 schema 使用 **`media_types[]` 或留 `target_type` 字段**，勿写死全局仅 image
- `split_product_visual` / manifest item 支持 `target_type: image | video` 枚举（一期只实例化 image）
- Phase 4 交付 UI 按 **类型分组** 而非写死「图片卡片」布局，便于二期加视频预览轨

### 本规格不是什么

| 排除项 | 说明 |
|--------|------|
| ❌ 某一行业 vertical | 机械、包装、美妆等 = plan 输出差异，非独立产品线 |
| ❌ 固定全局产出清单 | 不存在「必须出主图+详情+包装」 |
| ❌ 行业规则引擎 | 禁止 `if 机械 then 出规格图` |
| ❌ Campaign / Atomic 替代 | 见 §5.5 |
| ❌ 非实物 / 无实拍主路径 | 纯概念、无图 → Atomic / 文生图 |
| ❌ **一期做出视频** | 短视频/I2V/视频定稿均为 **二期**；一期 AC/CVS **不包含** video |

### 与 lnkpi 现有能力边界

```
                    ┌─────────────────────────────────────┐
                    │  ecommerce-product-visual（本规格）  │
                    │  实拍 QA → 标准资产 → 动态类型×变体  │
                    │  → 并行生图 → 按类型定稿              │
                    │  产出：plan 动态决定的各类型 visual（跨行业） │
                    └─────────────────────────────────────┘
                           互补              互补
              ┌────────────────────┐   ┌────────────────────┐
              │ enterprise-marketing│   │ atomic-create      │
              │ 详情页营销全链路     │   │ 单图快出、变体      │
              │ 固定 manifest+文案门 │   │ 无 QA 闸、无类型定稿│
              └────────────────────┘   └────────────────────┘
```

| 维度 | Campaign | Atomic | **本规格** |
|------|----------|--------|------------|
| 入口 | 营销方案描述 | 单句出图 | **实拍 + 自然语言需求** |
| Phase 1 QA | 无 | 无 | **有（硬闸口）** |
| 产出类型 | 固定 manifest 子集 | 用户点名 1~N item | **plan 动态规划** |
| 变体模型 | essentially 1:1 | 新节点/ regenerate | **类型 × 1~3 变体** |
| 定稿 | 画布进度 | 无专门定稿 UX | **每类型 1 张 + 默认推荐** |
| 典型场景 | 详情页全链路 | 单张快出 | **实拍 → 跨行业 visual 套图** |

---

### 已确认决策（2026-08-10）

| # | 决策 | 说明 |
|---|------|------|
| **L0** | **Scope = 全行业实物产品 visual** | 可销售、可推广、可营销的**实物**；编排一套；差异仅在 plan 输出的类型与关键要素 |
| **L1** | **图源质量优先** | Phase 1 硬闸口 |
| **L2** | **图片类型由方案节点动态规划** | 非全局固定清单；行业差异体现在 plan 激活的类型子集 |
| **L3** | **每类型 1~3 变体** | 类型 × 变体；禁止融合 |
| **L4** | **每类型最终 1 张** | Phase 3 候选 → Phase 4 定稿 |
| **L5** | **定稿：推荐 + 可覆盖** | 默认 recommended |
| **L6** | **单一 Skill** | `ecommerce-product-visual`；不按行业拆 Skill |
| **L7** | **修订 ≤3 轮** | 超限强制生图 |
| **L8** | **LLM 推理意图与行业要素** | 禁止行业关键词硬路由 |
| **L9** | **关键要素在 scheme 内表达** | 电商卖点、机械规格、包装材质等均为 `key_elements` / constraints，非独立子系统 |
| **L10** | **人物氛围（CVS 基线要求）** | 三类经典验证场景的期望交付宜含**人参与的氛围感**（模特展示、手持、空间中使用等）；服务于「与人产生关联」的营销目标 |
| **L11** | **模特来源双通道** | ① 系统 AI 生成模特；② 流程中提示用户上传自定义模特图（侧栏 @ref），gen 时 attach 为 ref |
| **L12** | **一期仅出图** | 本规格实现范围 = 一期；出视频为二期，一期不验收 video |
| **L13** | **二期 Video 入口 = C（B 默认）** | 两种入口均支持；**默认**同 thread 续做 video（B）；utterance 同时要图+视频（A）→ 一次 plan、**两段 gen**（先 image 定稿再 video）；路由由 LLM + 是否已有 `delivery_selections` 推断，禁止关键词硬切 |

---

## 零、原始业务需求（用户提供）

> 以下为产品方最初提交的完整需求原文（** originating 场景以包装/物流为主**）。  
> **实现 scope 以本文「规格范围」为准**：原文中的包装/物流表述 = 示例 utterance 与示例产出类型，**不等于系统仅服务包装**。

### 0.1 场景概述

**用户角色：** 电商卖家 / 产品运营人员

**核心痛点：** 用户手上有实物产品（如一串巨峰葡萄），但缺乏专业设计能力和标准产品图，希望 AI 能直接根据「随手拍」的照片，快速生成一套符合物流运输标准的电商包装视觉稿。

**核心原则：** 系统必须优先保证「图源质量」，否则后续生成的成图毫无意义。

> **抽象后的通用痛点：** 实拍产品 → 标准产品资产 → **跨行业 visual 成图**（类型与关键要素由 plan 决定）。

### 0.2 完整用户旅程（分四步走）

#### 第一步：上传与准入审核（Phase 1）

**用户做什么：** 上传实拍 + 视觉/营销需求（自然语言）。

> **示例 utterance（同一 flow，不同行业）：**
> - 电商：「做天猫主图、详情图、模特展示、卖点图、推广海报。」
> - 机械：「出外观主图和带尺寸标注的规格图、安装场景。」
> - 包装：「设计物流包装，运输不能压坏。」
> - 混合：「主图 + 场景 + 包装效果图。」
> - 通用：「帮我出几张适合推广的产品图。」

**系统做什么：** 质检 → seed + 四视图 → Phase 2（**与行业无关**）。

#### 第二步：方案策划与选择（Phase 2）

**系统做什么：** **方案文本节点**输出（**行业差异集中在此**）：

1. **`visual_intent`** — 品类/行业推断、用户约束  
2. **`image_types[]`** — 本任务要出哪些图（主图/规格图/包装图等，**因任务而异**）  
3. **每类型 schemes** — 含 **`key_elements`**（卖点、规格、材质等，**因行业而异**）+ 1~3 变体 + 推荐  

用户可单选/多选（同类型）、revise；≤3 轮。

#### 第三步：并行生图（Phase 3）

对每个选中的 `(类型, 变体)` 并行 gen；prompt 由 intent + scheme 合成，**非硬编码词表**。

#### 第四步：定稿交付（Phase 4）

按类型分组展示；默认 recommended；可切换候选；支持单图微调。

### 0.3 核心业务规则（原文铁律）

| 铁律 | 说明 |
|------|------|
| 中止彻底性 | 「我重新拍」须清 state、画布、附件 |
| 多选定义 | 同类型多变体并行候选；**严禁融合** |
| 修订 ≤3 轮 | 超限强制进 Phase 3 |
| 意图一致 | 约束与用户 utterance 一致；未提不臆造 |

### 0.4 讨论澄清（2026-08-10）

| # | 澄清 |
|---|------|
| R1 | 三视图 → 工程用四视图 pipeline |
| R2 | 方案 C1/C2 → **图片类型 × 变体** |
| R3 | 多选 → 同类型候选；每类型最终 1 张 |
| R4 | 定稿 → 默认 recommended，可覆盖 |
| R5 | 无固定产出类型清单 |
| R6 | 物流示例句 ≠ 系统边界 |
| R7 | **Scope = 全行业实物 visual**；包装/电商/机械均为 plan 类型示例 |
| R8 | **差异仅在方案节点**：类型清单 + 关键要素；编排不分叉 |

---

## 一、图片类型与行业差异

### 1.1 原则

- **编排全行业一套**；**类型与关键要素仅因 plan 而异**  
- manifest = 可选模板库，非运行时全集  
- plan 激活 0~N 种 `ImageType`；`domain_tags` 仅描述，不路由  

### 1.2 方案节点产出的两类差异（核心）

| 差异项 | 说明 | 因行业而异的例子 |
|--------|------|------------------|
| **图片类型** | plan 决定「这次出哪些图」 | 电商：主图、详情、模特、细节、卖点、海报；机械：规格标注、工况场景；包装：盒型、结构示意 |
| **关键要素** | 每 scheme 的 `key_elements` + constraints | 电商：卖点、渠道规范；机械：尺寸/接口/安全警示；包装：材质、缓冲 |

> 上表为产品说明，**禁止** `switch(industry)` 硬编码。

### 1.3 行业 → 类型与要素对照（plan 推理参考，非路由表）

| 行业/场景 | plan 可能激活的类型 | scheme `key_elements` 侧重 |
|-----------|---------------------|----------------------------|
| 消费品电商 | 主图、详情图、模特展示、细节、卖点图、推广海报 | 卖点、促销、渠道比例、风格 |
| 美妆 | 质地特写、卖点、氛围融合 | 肤感、光影、合规宣称 |
| 服饰 | 模特上身、街拍场景、面料细节 | 版型、穿搭场景 |
| 机械/工业 | 外观主图、规格标注、安装/工况场景 | 尺寸接口、材质、安全警示 |
| 包装 | 包装主图、结构/缓冲、3D 盒、开箱 | 材质、缓冲、物流（仅 intent 相关时） |
| 建材/五金 | 主图、应用场景、规格对比 | 参数可视化、适用场景 |
| 室内装修设计 | 空间效果图、材质/软装搭配、产品置入场景、细节（材质特写） | 风格（北欧/现代等）、色调、采光、功能分区、材质清单 |
| 模糊 | 品类 `default_type_set` | 通用 visual 要素，不臆造行业字段 |

### 1.4 类型模板库（optional seed）

| `domain_tags` | `type_id` | label 示例 |
|---------------|-----------|------------|
| ecommerce | `hero_main` | 电商主图 |
| ecommerce | `detail_page` | 详情图 |
| ecommerce | `model_display` | 模特展示图 |
| ecommerce | `detail_macro` | 产品细节图 |
| ecommerce | `selling_point` | 卖点图 |
| ecommerce | `promo_poster` | 推广海报 |
| ecommerce | `scene_lifestyle` | 场景图 |
| ecommerce | `model_holding_product` | 模特手持 / 使用效果图 |
| packaging | `packaging_hero` | 包装主图 |
| packaging | `model_holding_pack` | 模特手持礼盒 / 包装效果图 |
| packaging | `packaging_gift_scene` | 送礼/开箱氛围（含人物） |
| packaging | `packaging_structure` | 结构/缓冲示意 |
| industrial | `spec_annotated` | 规格标注图 |
| industrial | `installation_scene` | 安装/工况场景 |
| generic | `render_3d` | 3D 效果图 |
| interior | `space_effect_render` | 空间效果图 |
| interior | `material_board` | 材质/软装搭配板 |
| interior | `space_with_people` | 空间效果图（含人物生活场景） |
| interior | `product_in_space` | 产品置入空间（可含使用者） |
| interior | `layout_plan_visual` | 布局示意 / 平面风格图 |

plan 可新增库外类型；dynamic split 校验拓扑。

### 1.5 `key_elements`（scheme 内行业语义载体）

```json
{
  "scheme_id": "c1",
  "name": "规格标注-A型",
  "key_elements": {
    "selling_points": ["静音"],
    "specs_to_show": ["长宽高", "接口型号"],
    "materials": ["304不锈钢"],
    "compliance_notes": ["安全警示区"],
    "style": ["工业准确"],
    "human_presence": true,
    "model_source": "generated"
  },
  "prompt": "…"
}
```

字段均为 optional；LLM 按上下文填充；**无行业枚举校验**。

### 1.6 混合任务示例

用户：「做主图、场景图，再加一个物流包装效果图」

plan 激活：`hero_main` + `scene_lifestyle` + `packaging_hero`（3 类型）  
最终交付：3 张（每类型 1 张定稿）

### 1.7 典型使用场景示例

下列场景均走 **同一四阶段 flow**（`ecommerce-product-visual`）；差异仅在于 LLM 推理出的 `visual_intent` 与 plan 激活的 **图片类型 / 变体**。表格仅供产品、研发、eval 对齐，**不是**硬编码路由表。

#### 场景 A — 生鲜上架（纯电商）

| 项 | 内容 |
|----|------|
| **品类** | 巨峰葡萄 |
| **用户 utterance** | 「这是刚拍的葡萄，帮我做天猫主图和一张厨房场景图，要突出新鲜和水珠。」 |
| **Phase 1** | 质检通过 → 白底主图 + 四视图 |
| **plan 激活类型** | `hero_main`、`scene_lifestyle` |
| **Phase 2 要点** | 主图可能有 2~3 变体（白底居中 / 带卖点文案区 / 俯拍）；场景若仅 1 套则静默 |
| **最终交付** | 2 张：主图 1 + 场景 1 |
| **不应出现** | 用户未提包装 → plan **不含** `packaging_*` |

#### 场景 B — 3C 数码（主图 + 细节 + 3D）

| 项 | 内容 |
|----|------|
| **品类** | 蓝牙耳机 |
| **用户 utterance** | 「用这张实拍出电商主图、一张接口细节特写，再来一张 3D 渲染效果图，风格简约科技风。」 |
| **plan 激活类型** | `hero_main`、`detail_macro`、`render_3d` |
| **Phase 2 要点** | 3D 类型或提供 2 变体（俯视角 / 45° 悬浮）；主图推荐「白底 + 轻微反射」 |
| **最终交付** | 3 张 |
| **意图标签** | `primary_goal: mixed_ecommerce`，`output_categories: ["ecommerce"]` |

#### 场景 C — 美妆护肤（细节 + 氛围融合）

| 项 | 内容 |
|----|------|
| **品类** | 精华液 |
| **用户 utterance** | 「帮我出详情页用的质地特写，再加一张带光影氛围的产品融合图，偏高端感。」 |
| **plan 激活类型** | `detail_macro`、`product_blend` |
| **Phase 2 要点** | 融合图 2~3 变体（大理石台面 / 植物点缀 / 极简纯色）供对比 |
| **最终交付** | 2 张 |

#### 场景 D — 服饰（场景生活方式）

| 项 | 内容 |
|----|------|
| **品类** | 冬季羽绒服 |
| **用户 utterance** | 「生成用户在户外街拍的穿搭场景图，要体现保暖，不要白底。」 |
| **plan 激活类型** | `scene_lifestyle`（可能仅 1 类型） |
| **Phase 2 要点** | 场景 2~3 变体（街拍 / 滑雪场 / 通勤）；**不要求**再出白底主图（除非 plan 推断 listing 需要） |
| **最终交付** | 1 张（或用户后续 revise 加主图） |

#### 场景 E — 大促 / 店招（Banner）

| 项 | 内容 |
|----|------|
| **品类** | 家居收纳盒 |
| **用户 utterance** | 「做一张 618 大促 Banner，强调买二免一，颜色跟品牌蓝一致。」 |
| **plan 激活类型** | `banner`（或 plan 命名为「大促横幅」的自定义 type） |
| **Phase 2 要点** | 2 变体：文案左排版 / 文案右排版；推荐含明确促销信息布局 |
| **最终交付** | 1 张 |

#### 场景 F — 礼盒节日（包装为主 + 可选主图）

| 项 | 内容 |
|----|------|
| **品类** | 茶叶礼盒 |
| **用户 utterance** | 「设计春节礼盒包装视觉，红色金色，同时给一张适合京东首图的礼盒主图。」 |
| **plan 激活类型** | `packaging_gift`、`hero_main` |
| **Phase 2 要点** | 礼盒包装 2~3 变体；主图与包装视觉风格一致 |
| **最终交付** | 2 张 |
| **意图标签** | `output_categories: ["ecommerce", "packaging"]` |

#### 场景 G — 物流包装（ originating 示例，纯包装）

| 项 | 内容 |
|----|------|
| **品类** | 巨峰葡萄 |
| **用户 utterance** | 「请设计包装图，线上物流销售，运输过程不能压坏。」 |
| **plan 激活类型** | `packaging_hero`、可选 `packaging_structure`（缓冲剖面） |
| **Phase 2 要点** | 包装 2~3 变体（极简缓冲 / 开窗 / 环保纸浆）；**仅因 intent 含物流**才在 prompt 侧重复缓冲/固定结构 |
| **最终交付** | 1~2 张（取决于 plan 是否拆结构示意） |

#### 场景 H — 上新全套（电商 + 包装混合）

| 项 | 内容 |
|----|------|
| **品类** | 手工皂 |
| **用户 utterance** | 「新产品上架，帮我出主图、场景图、细节图，还有外包装盒效果图，整体自然手工风。」 |
| **plan 激活类型** | `hero_main`、`scene_lifestyle`、`detail_macro`、`packaging_hero` |
| **Phase 2 要点** | 类型多 → 仅对关键类型（如主图、包装）出多变体；细节/场景可单变体静默 |
| **最终交付** | 4 张（每类型 1 张定稿） |
| **备注** | 见 **附录 A** JSON 结构；与本规格混合任务一致 |

#### 场景 I — 模糊需求（通用缺省）

| 项 | 内容 |
|----|------|
| **品类** | 未知 / 用户未说明 |
| **用户 utterance** | 「帮我出几张这个产品的电商图。」 |
| **系统行为** | LLM 从实拍推断品类 → `primary_goal: generic_ecommerce` → 默认激活常见 trio：`hero_main` + `scene_lifestyle` + `detail_macro` |
| **Phase 2 要点** | 可 clarify 一句渠道（天猫/拼多多/独立站）；**不**强行加包装类型 |
| **最终交付** | 通常 3 张 |

#### 场景 K — 机械工业品（规格 + 工况）

| 项 | 内容 |
|----|------|
| **品类** | 工业水泵 |
| **用户 utterance** | 「这是实物拍的照片，帮我出外观主图、一张带尺寸标注的规格图，再加一张工厂机房安装场景图。」 |
| **plan 激活类型** | `hero_main`、`spec_annotated`、`installation_scene` |
| **关键要素** | 规格图 scheme 的 `key_elements.specs_to_show`；场景图强调工况真实 |
| **最终交付** | 3 张 |
| **要点** | **与场景 A 同一 flow**；差异仅在 plan 输出的类型与 key_elements |

#### 场景 J — 图源不合格（流程分支，非产出类型）

| 项 | 内容 |
|----|------|
| **用户 utterance** | 「做主图和场景图」（与场景 A 相同意图） |
| **Phase 1** | 上传图模糊或杂底 → 弹窗 → 用户选「生成标准白底图」→ 补 seed 后 **仍按场景 A 意图** 进入 Phase 2 |
| **要点** | QA 与产出类型无关；补救后 intent 不因 Phase 1 分支而改变 |

---

**场景与能力边界速查**

| 场景 | 走本 Skill | 更适合 Campaign / Atomic 的情况 |
|------|------------|--------------------------------|
| A~I | ✓ 实拍 + 多类型 / plan 诉求 | — |
| 详情页 14 节点全链路 + 长文案 | 可部分重叠 | **Campaign** 更完整 |
| 「只要一张白底图」 | 可以但偏重 | **Atomic** 更轻 |
| 无实拍、纯文案想象产品 | ✗ | Atomic / 文生图 |

---

## 二、核心概念模型

### 2.1 `ProductVisualTask`

```
ProductVisualTask
├── Phase1Assets        # white_bg + product_turnaround（所有类型共享 seed）
├── visual_intent       # §2.3
├── image_types[]       # plan 动态实例化
│   └── ImageType
│       ├── type_id, type_label, domain_tags[]   # 如 ["ecommerce","packaging"]
│       ├── schemes[].key_elements{}             # 行业关键要素（§1.4）
│       ├── schemes[1..3]
│       ├── selected_scheme_ids[]
│       └── finalized_scheme_id   # 默认 = recommended
└── scheme_revision_count
```

### 2.2 数量规则

| 项 | 规则 |
|----|------|
| 类型数 | plan 动态；受 `max_downstream` 限制 |
| 每类型变体 | 1~3；仅 1 时静默选中 |
| Phase 3 gen 次数 | Σ(每类型选中变体数) |
| 最终交付 | = 类型数（每类型 exactly 1 张） |

### 2.3 `visual_intent`（LLM 推理，非规则）

```json
{
  "industry_context": "consumer_electronics | apparel | food | industrial | packaging | …",
  "primary_goal": "mixed | hero_listing | spec_visual | packaging_design | generic | …",
  "domain_tags": ["ecommerce", "industrial"],
  "user_stated_constraints": ["突出新鲜"],
  "inferred_constraints": ["水果类，建议水珠光泽"],
  "output_types_requested": ["主图", "规格标注图"],
  "default_type_set_applied": false,
  "style_hints": ["简洁"],
  "confidence": 0.88
}
```

| 原则 | 说明 |
|------|------|
| 软分类 | `industry_context` / `domain_tags` **不**触发硬路由 |
| 缺省 | 模糊 utterance → 从实拍+品类推断 `default_type_set` |
| 不臆造 | 未提包装/规格 → plan 不激活对应类型、不填无关 key_elements |
| 可追溯 | UI：「系统理解：…」 |

---

## 三、四阶段工程设计

### Phase 1 — 图源准入

| 项 | 说明 |
|----|------|
| 输入 | 侧栏附件 + utterance（任意电商/包装/混合） |
| 质检 | 清晰度、白底 |
| 合格 | seed + 四视图 → Phase 2 |
| 不合格 | HITL：「我重新拍」/「生成标准白底图」 |
| UX 文案 | 弹窗用「成图效果」等泛化表述，不写死「包装图」 |

**新建：** `await_image_qa`、`image_qa_check`、`image_qa_remedy`

### Phase 2 — 方案策划

1. LLM → `visual_intent`  
2. LLM → `image_types[]` + schemes（含 `domain_tags`、`key_elements`）  
3. 若某类型仅 1 变体 → 静默；否则 → 分组选择卡片  
4. revise ≤3 轮  

**澄清问法示例（LLM 生成，非固定选项树）：** 「更侧重 listing 主图还是包装结构？」

### Phase 3 — 并行生图（一期：仅 image）

- manifest key：`{type_id}__{scheme_id}`；**`target_type` 固定为 `image`（一期）**
- `depends_on`: `[white_bg, product_turnaround]` + plan 声明的跨类型依赖  
- `gen_scheduler` Send fan-out → **`gen_node`（image）**；二期再增 `video_node`（**仅在 image 定稿后** dispatch，见 L13 / 附录 B）  
- `prompt_hint` = f(scheme.prompt, scheme.key_elements, visual_intent)  

### Phase 4 — 定稿交付

- 按 **图片类型** 分组（电商类与包装类同一 UI 组件）  
- 默认 recommended；切换不 regen  
- 「微调重绘」仅当前类型定稿变体  
- 「确认全部定稿」→ `done`  

---

## 四、核心业务规则（铁律）

### 4.1 中止彻底性

清除：`product_visual_plan`、`visual_intent`、`image_qa_result`、Phase 1 画布节点、侧栏附件、thread refs。

### 4.2 多选 ≠ 融合

同类型多变体 = 多张独立 gen；禁止 merge prompt。

### 4.3 修订 ≤3 轮

超限提示并强制 Phase 3。

### 4.4 意图与 prompt

- **做：** LLM 按 intent 合成 prompt  
- **不做：** 全局物流词表；关键词 if-else 路由  
- **常识：** 仅 context 相关时写 negative_hints（如用户提易碎+包装才强调缓冲）

### 4.5 图源一致性

所有类型 gen attach 白底 + 四视图；复用 `buildImageRefConsistencyBlock()`。

---

## 五、技术架构

### 5.1 图编排

```
flow_mode: product_visual
intake → image_qa_gate → [await_image_qa]
  → plan_product_visual → [await_scheme_select]
  → split_product_visual → [await_topo]
  → start_gen → gen_scheduler ⇄ gen_node → collect_gen
  → delivery_summary → done
```

### 5.2 Skill 与 manifest

| 资产 | 路径（建议） |
|------|-------------|
| Skill | `services/agent-runtime/skills/ecommerce-product-visual/` |
| 类型模板库 | `assets/canvas-manifest.yaml`（跨行业 optional 条目） |
| split | `split_product_visual`：按 plan 实例化，非全量展开 |

### 5.3 状态字段

| 字段 | 说明 |
|------|------|
| `product_visual_plan` | `visual_intent` + `image_types[]` |
| `image_qa_result` | `pass` \| `fail` \| `remediated` |
| `scheme_revision_count` | int |
| `phase1_asset_keys` | `[white_bg, product_turnaround]` |

### 5.4 前端

| 模块 | 变更 |
|------|------|
| `agentInterruptGate.ts` | `image_qa`, `scheme_select`, `delivery_confirm` |
| `AgentSideRail.vue` | QA 弹窗；**跨行业**统一的类型分组选择卡 |
| `ProductVisualDeliveryCard.vue` | Phase 4 按类型定稿 |

### 5.5 路由（与 Campaign / Atomic）

| 用户信号 | 路由 |
|----------|------|
| 实拍 + 多类型/visual/plan 诉求 | **本 Skill** |
| 详情页营销方案、全链路、fix manifest | Campaign |
| 单张快出、变体、regenerate | Atomic |
| 含糊且可 either/or | clarify（LLM），**非**关键词硬切 |

---

## 六、子项目拆分

> **以下均为一期（出图）范围。**

| ID | 范围 | 优先级 |
|----|------|--------|
| P1-QA | 图源准入 + 标准产品资产 | P0 |
| P2-TypeScheme | visual_intent + 动态类型 + 选择卡片 | P0 |
| P3-Gen | dynamic split + 并行 **image** gen + intent-aware prompt | P0 |
| P4-Delivery | 按类型定稿 + 切换 + 微调 | P1 |
| **P5-Video** | plan VideoType + video gen + 视频定稿 | **二期，不在一期** |

---

## 七、验收标准

### Phase 1

- **AC-1** 合格白底实拍 + 任意 utterance → 无 QA 弹窗，有四视图，进 Phase 2  
- **AC-2** 不合格 + 「我重新拍」→ 无残留  
- **AC-3** 不合格 + AI 补图 → seed 就绪，进 Phase 2  

### 类型与 intent（跨行业）

- **AC-4a 纯电商** Given「天猫主图+详情+模特+卖点+海报」→ plan 激活对应 ecommerce 类型，**无** packaging / industrial 类型  
- **AC-4b 纯包装** Given §0.2 物流包装句 → plan 含 packaging 类型，prompt 与 intent 一致  
- **AC-4c 混合** Given「主图+包装效果图」→ plan 同时含 `hero_main` 与 `packaging_*`  
- **AC-4d 通用不臆造** Given「出几张电商图」→ 默认电商类型集，无强行包装/物流段落  

- **AC-4e 机械** Given 场景 K utterance → plan 含 `spec_annotated` 等工业类型，**无**强行电商卖点图  
- **AC-4f 跨行业同 flow** Given 场景 A 与 K → 同一 `flow_mode: product_visual`，仅 plan JSON 不同  

- **AC-5** 某类型 1 变体 → 无选择 UI  
- **AC-6** 同类型多选 → 并行候选，prompt 不融合  
- **AC-7** 多候选 → 默认 recommended，可切换  
- **AC-8** 全流程完成 → 交付张数 = 类型数  
- **AC-9** 第 4 次 revise → 强制 Phase 3  
- **AC-10** eval 须覆盖 **§十 CVS-01 / CVS-02 / CVS-03** 三个经典场景（必跑）  
- **AC-11** 每个 CVS 均走同一 `flow_mode: product_visual`；仅 plan 类型与 key_elements 不同  
- **AC-12 人感基线** 三个 CVS 最终交付各 **≥1 张含人物**；plan 含对应人感类型  
- **AC-13 模特双通道** CVS-01 跑两轮：无模特 ref（AI 生成）+ 有模特 @I2（attach 用户模特），均成功交付  
- **AC-14 一期无 video** Given 任意 CVS utterance → plan 与 manifest **仅** `target_type: image`；不触发 video gen  

---

## 八、风险

| 风险 | 缓解 |
|------|------|
| 与 Campaign 混淆 | §规格范围 边界表 + routing 表 + Skill description |
| 团队误读为电商/包装专用 | 标题「实物产品」+ §1.2 行业表 + 机械场景 K + AC-4e |
| intent 偏差 | 「系统理解」+ revise |
| dynamic split 环 | `precompute_gen_order` |
| 一期 scope creep 做 video | L12 + AC-14 + §产品分期；二期单独立项 |

---

## 附录 B：二期出视频（规划占位，非一期实现）

> 详细规格待一期稳定后另起 `…-product-visual-video-design.md`；此处锁定与一期的衔接假设及 **L13 入口策略**。

### B.1 已确认决策 L13 — Video 入口策略

**产品承诺：C（两种入口都支持）；体验重心：B（先图后视频）。**

| 模式 | 用户行为 | 系统行为 |
|------|----------|----------|
| **B — 续做（默认）** | 一期 image 定稿后，同 thread：「给主图和手持图各做 15s 短视频」 | 跳过 Phase 1 QA（已有 seed + 定稿）；plan 仅输出 `video_types[]`；video manifest `depends_on` 指向已定稿 image key |
| **A — 一次说要图+视频** | 首轮 utterance 同时含 listing 图 + 短视频诉求 | **一次 plan**（`image_types[]` + `video_types[]`）；**两段 gen**：Phase 3a image → Phase 4a image 定稿 → Phase 3b video → Phase 4b video 定稿；**禁止** image 与 video 同一 superstep 并行 |
| **推断规则** | — | LLM 读 utterance + checkpoint 是否已有 `delivery_selections` / `phase1_asset_keys`；**禁止**行业/媒介关键词 if-else 硬路由 |

```
入口推断（二期，LLM + state，非规则引擎）
  已有 image 定稿 + utterance 仅 video → 模式 B（续做）
  utterance 同时要图+video → 模式 A（一次 plan，两段 gen）
  仅有实拍、首次任务、utterance 含 video → 模式 A 变体（先 QA→image 定稿→video）
```

**为何默认 B、A 走两段 gen：** 视频强依赖静帧 identity（I2V）；先定稿图再 gen video，成本与返工面更可控；与一期 Phase 4 定稿 natural checkpoint 一致。

### B.2 技术衔接（与 LangGraph 边界）

| 层级 | 机制 | 二期用法 |
|------|------|----------|
| **宏观** | `conditional_edges` + `flow_mode` | 仍 `product_visual`；续做时条件边跳过 QA |
| **中观** | plan / split / HITL state | 混合 plan；video item `depends_on` 已定稿 image |
| **微观** | `Command(goto=[Send(...)])` | `gen_scheduler` 扩展 Send `video_node`；**仅** video 段调度，不与 image 同批 Send |

> CS-9：`Command` 用于图内并行 Send；**不**用 Command 切换整条 flow 或替代 HITL。

### B.3 二期能力摘要

| 项 | 二期预期 |
|----|----------|
| plan 输出 | `image_types[]` + `video_types[]`（或统一 `media_types[]` + `target_type`） |
| 示例视频类型 | `product_showreel`、`packaging_unbox_video`、`space_walkthrough` |
| Phase 3 | 分 **3a（image）** / **3b（video）**；3b 在 image 定稿后；`gen_scheduler` Send `video_node` |
| Phase 4 | 分组定稿支持视频预览、时长标注；仍 **每类型 1 个定稿产物**（1 图或 1 片） |
| 一期成果作输入 | video manifest `depends_on` → `{type_id}__{scheme_id}` 定稿 image（可选，非强制） |
| CVS 扩展 | 三案例各增 1 条可选 video 断言（二期 eval）；含 B 续做 + A 混合 utterance 子用例 |

---

## 九、后续步骤

1. 审阅本 spec（**一期 = 出图**）  
2. ~~`writing-plans` 产出 **一期** 实现计划~~ → [2026-08-10-ecommerce-product-visual.md](../plans/2026-08-10-ecommerce-product-visual.md)  
3. P1 → P4 开发（不含 P5-Video）  
4. 一期 CVS 通过后，再启动二期视频规格

---

## 十、经典验证场景（CVS — Agent 视觉出图效果测试）

> **用途：** 一期发版前 **必跑** 的三条 **出图** 基准用例（不含 video，见 L12 / AC-14）。  
> **约定：** CVS = Classic Validation Scenario；**不**单独拆 Skill / flow。

### 10.1 三案例总览

| ID | 领域 | 实拍主体 | 验证重点 |
|----|------|----------|----------|
| **CVS-01** | 电商 | 保温杯 | listing + **模特展示/手持** |
| **CVS-02** | 产品包装 | **大闸蟹（生鲜）** | 礼盒/冷链包装 + **模特手持礼盒** 送礼氛围 |
| **CVS-03** | 室内装修 | 客厅 + 沙发 | 空间/材质/置入 + **人在空间中** |

### 10.1.1 跨 CVS 原则：人物氛围与模特参与

三类经典场景的期望交付均强调 **「服务于人」**——让人能感知使用、赠送、生活的关联。

| 原则 | 说明 |
|------|------|
| **人感基线** | 每个 CVS 最终交付 **≥1 张含人物/模特**；plan 须含对应人感类型 |
| **典型类型** | `model_display`、`model_holding_product`、`model_holding_pack`、`packaging_gift_scene`、`space_with_people` |
| **模特 A — 系统生成** | 无用户模特 @ref 时，prompt 描述生成模特，**不阻断**流程 |
| **模特 B — 用户上传** | Phase 2 确认前或 Phase 3 前 **轻提示**：「可上传自定义模特照片」；上传后 attach 至人感类型 gen 节点 |
| **身份一致** | 同任务多张人感图锁定同一模特（user ref 优先；否则 scheme 内模特描述块复用） |

```
Phase 2 plan 含人感类型
  → 侧栏已有模特 @ref？
      ├─ 是 → model_source: user_ref，gen attach 模特图
      └─ 否 → 提示可上传；默认 model_source: generated
  → Phase 3 gen（产品 seed + 可选模特 ref）
```

### 10.2 CVS-01 — 电商（消费品 listing + 人感）

| 项 | 内容 |
|----|------|
| **测试 ID** | `CVS-01-ecommerce-listing` |
| **实拍输入** | 1 张保温杯实拍 @I1；**可选** 1 张自定义模特照 @I2 |
| **用户 utterance** | 「这是我们要上架的保温杯，帮我出一套电商推广图：天猫主图、详情图、**模特展示图**、**模特手持使用的效果图**、卖点图、推广海报。风格简约高级，强调 316 不锈钢和 12 小时保温。」 |
| **Phase 1 期望** | 质检通过 → 白底主图 + 四视图 |
| **plan 应激活类型（≥5）** | `hero_main`、`detail_page`、`model_display`、`model_holding_product`、`selling_point`、`promo_poster`（后两者可合并精简，但 **必须含 ≥1 人感类型**） |
| **人感 / 模特** | `model_display`：模特展示产品；`model_holding_product`：手持/饮用场景；无 @I2 时 AI 生成模特；有 @I2 时 attach 并提示「已采用您上传的模特」 |
| **`key_elements` 期望** | `selling_points` 保温/材质；`human_presence`: true；`model_source`: `generated` \| `user_ref` |
| **Phase 4 期望** | 按类型定稿；**至少 1 张含人物** 的成图进入最终交付集 |
| **负向断言** | 全套纯白底静物、**零人物**；plan 激活 `packaging_*` |

### 10.3 CVS-02 — 产品包装（生鲜大闸蟹 + 人感）

| 项 | 内容 |
|----|------|
| **测试 ID** | `CVS-02-product-packaging-crab` |
| **实拍输入** | 大闸蟹实拍 @I1；**可选** 送礼人物/模特参考 @I2 |
| **用户 utterance** | 「这是我们中秋要卖的大闸蟹，帮我设计礼盒和快递运输包装视觉，要保鲜防损。出包装效果图、冷链/缓冲结构示意，再加一张 **模特手持礼盒的送礼效果图**，要有中秋节日氛围。」 |
| **Phase 1 期望** | 生鲜实拍 → seed + 四视图（杂底可测 QA 补图） |
| **plan 应激活类型** | `packaging_hero`；`packaging_structure`（冷链/缓冲）；`model_holding_pack` 或 `packaging_gift_scene`（**必须**） |
| **人感 / 模特** | 手持礼盒图：无 @I2 → AI 生成节日送礼人物；有 @I2 → attach 用户模特 |
| **`key_elements` 期望** | 生鲜/冷链/防损；中秋送礼；`human_presence`: true |
| **Phase 4 期望** | 2~3 张定稿；**≥1 张含人物** |
| **负向断言** | 陶瓷杯等非生鲜语境；全套无人物；纯 listing 促销类型 |

### 10.4 CVS-03 — 室内装修设计（空间 + 人在场）

| 项 | 内容 |
|----|------|
| **测试 ID** | `CVS-03-interior-design` |
| **实拍输入** | 客厅 @I1；沙发 @I2；**可选** 人物/模特参考 @I3 |
| **用户 utterance** | 「这是待装修客厅，出 **有人在里面的** 现代简约空间效果图、材质软装搭配板，沙发置入效果，最好有 **一位女性在客厅使用沙发的真实生活感**。暖白原木色调。」 |
| **Phase 1 期望** | 空间实拍 QA（清晰度优先；白底规则放宽，见特验点） |
| **plan 应激活类型** | `space_with_people`（**含人**，非空镜）；`material_board`；`product_in_space`（可含使用者） |
| **人感 / 模特** | 空间图须含人物生活姿态；无 @I3 → AI 生成；有 @I3 → attach |
| **Phase 4 期望** | 3 张定稿；**≥1 张明确含人物** |
| **负向断言** | 三张全无人的纯空镜；电商主图/包装描述 |

> **CVS-03 特验点：** 空间实拍 Phase 1 QA 见实现 plan。

### 10.5 跨 CVS 通用通过标准

每条 CVS 均须满足：

| # | 检查项 |
|---|--------|
| G1 | 同一 `flow_mode: product_visual`，未误路由 Campaign / Atomic |
| G2 | Phase 1→4 状态机完整；abort 清干净（CVS-02 杂底子用例） |
| G3 | plan 类型与用户 utterance **不错配**（见各 CVS 负向断言） |
| G4 | 每类型最终 1 张定稿；recommended 默认生效且可切换 |
| G5 | 同类型多选时 prompt **不融合** |
| G6 | 成图与 scheme 摘要可对应；seed 产品 identity 不明显漂移 |
| G7 | **人感基线**：每个 CVS 交付 **≥1 张含人物** |
| G8 | **模特双通道**：无 ref 时 AI 生成不阻断；有 @ref 时 attach 且 UI 反馈 |

### 10.6 建议 eval 集结构（YAML 骨架）

```yaml
# services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set.yaml
schema_version: 1
cases:
  - id: CVS-01-ecommerce-listing
    utterance: "…"  # §10.2
    attachments: [fixture/cvs01-thermos.jpg]
    optional_attachments: [fixture/cvs01-model.jpg]
    assert_plan_types_include: [hero_main, model_display, model_holding_product]
    assert_human_presence_in_delivery: true
    assert_plan_types_exclude: [packaging_hero]
  - id: CVS-02-product-packaging-crab
    utterance: "…"  # §10.3 大闸蟹
    attachments: [fixture/cvs02-hairy-crab.jpg]
    optional_attachments: [fixture/cvs02-gift-model.jpg]
    assert_plan_types_include: [packaging_hero, model_holding_pack]
    assert_human_presence_in_delivery: true
    assert_plan_types_exclude: [promo_poster]
  - id: CVS-03-interior-design
    utterance: "…"  # §10.4
    attachments: [fixture/cvs03-living-room.jpg, fixture/cvs03-sofa.jpg]
    optional_attachments: [fixture/cvs03-occupant-ref.jpg]
    assert_plan_types_include: [space_with_people, material_board, product_in_space]
    assert_human_presence_in_delivery: true
    assert_plan_types_exclude: [packaging_hero, promo_poster]
  # 子用例：CVS-01/02/03 各跑一轮「用户上传模特 @ref」与「纯 AI 模特」
```

### 10.7 与 §1.7 其他示例场景的关系

| 集合 | 用途 |
|------|------|
| **§十 CVS（3 条）** | **发版必跑** 经典基线：电商 / 包装 / 室内装修 |
| **§1.7 场景 A~K** | 扩展参考、行业补充（机械、美妆等），**非**发版阻塞项（除非 eval 扩容） |

---

## 附录 A：Plan 输出完整示例（混合任务）

```json
{
  "visual_intent": {
    "industry_context": "food",
    "primary_goal": "mixed",
    "domain_tags": ["ecommerce", "packaging"],
    "user_stated_constraints": ["突出新鲜", "物流不破坏"],
    "output_types_requested": ["主图", "场景图", "包装效果图"],
    "confidence": 0.91
  },
  "image_types": [
    {
      "type_id": "hero_main",
      "type_label": "电商主图",
      "domain_tags": ["ecommerce"],
      "schemes": [
        { "scheme_id": "c1", "name": "白底居中", "recommended": true, "prompt": "…" }
      ]
    },
    {
      "type_id": "scene_lifestyle",
      "type_label": "场景图",
      "domain_tags": ["ecommerce"],
      "schemes": [
        { "scheme_id": "c1", "name": "厨房场景", "recommended": true, "prompt": "…" }
      ]
    },
    {
      "type_id": "packaging_hero",
      "type_label": "包装效果图",
      "domain_tags": ["packaging"],
      "schemes": [
        { "scheme_id": "c1", "name": "缓冲纸盒", "recommended": false, "prompt": "…" },
        { "scheme_id": "c2", "name": "开窗盒", "recommended": true, "prompt": "…" }
      ]
    }
  ]
}
```

最终交付 3 张：主图 1 + 场景 1 + 包装 1（包装默认 c2）。
