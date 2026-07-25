# Agent 一致性链（产品四视图 + 模特链）（设计）

> 状态：**待确认**（2026-07-25）  
> 日期：2026-07-25  
> 前置：  
> - `2026-07-25-agent-topology-preview-hitl-design.md`（A：方案门 / await_topo / 出图门）  
> - `2026-07-23-agent-runtime-langgraph-design.md`（Runtime / depends_on 拓扑出图）  
> 范围（本期 **B**）：产品链 + 模特链 + **3 视频节点**（产品/场景/人景）；manifest `chain`/`role`；出图前同链 ref；文案不进视频 depends_on  
> 非范围：**C** Dock/画布手工后「执行生图」；真·身份锁 / ControlNet API  

路线图：A（已合并）→ **B（本文）** → C。

---

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 范围 | **双链一起做**（产品 + 模特） |
| 三视图形态 | **1 个节点**；单张拼图 **4 格**：最左近景特写 + 正 / 侧 / 背 |
| 产品拓扑 | `white_bg` → `product_turnaround` → 主图/细节/场景/Banner/品牌（强一致依赖四视图 ± 白底） |
| 模特拓扑 | `model_portrait` → `model_turnaround` → `model_lifestyle`（对齐四格规则；替换旧单一 `model`） |
| 视频层 | **3 节点**：`video_product` / `video_scene` / `video_lifestyle`；依赖链末端图资产 |
| 文案与视频 | `copy_main` **只进视频 prompt/旁白**，**不**进入视频 `depends_on` / 图像 ref |
| 实现路径 | **方案 B**：manifest 扩键 + `chain`/`role` 元数据；`orchestrate_gen` 出图前刷同链 ref |
| 与 A | 仍经 await_topo 确认出图；Mermaid 来自 depends_on；trimmed 用依赖闭包 |

---

## 1. Manifest 节点与依赖

### 1.1 元数据

每个 `canvas-manifest` item 可选：

| 字段 | 取值 | 含义 |
| --- | --- | --- |
| `chain` | `product` \| `model` \| 省略 | 所属一致性链 |
| `role` | `seed` \| `turnaround` \| `downstream` \| 省略 | 链内角色 |

无链节点（如 `copy_main`）：不填 `chain`/`role`。

`SplitManifestItem`（Runtime state）同步携带这两字段，供 `orchestrate_gen` / Mermaid 使用。

### 1.2 产品链 `chain: product`

| key | title | role | depends_on（示意） | gen_mode |
| --- | --- | --- | --- | --- |
| `white_bg` | 白底图 | seed | [] | t2i |
| `product_turnaround` | 产品四视图 | turnaround | [white_bg] | i2i |
| `hero_main` | 主图 | downstream | [product_turnaround, white_bg] | i2i |
| `detail_cut` | 细节/剖面 | downstream | [product_turnaround, white_bg] | i2i |
| `scene` | 场景图 | downstream | [product_turnaround] | i2i |
| `banner` | Banner | downstream | [product_turnaround] | i2i |
| `brand` | 品牌图 | downstream | [product_turnaround] | i2i |

> 原单一 `show_video` **废弃**，改由 §1.4 三个视频节点承担。

### 1.3 模特链 `chain: model`

| key | title | role | depends_on | gen_mode |
| --- | --- | --- | --- | --- |
| `model_portrait` | 模特定妆 | seed | [] | t2i |
| `model_turnaround` | 模特四视图 | turnaround | [model_portrait] | i2i |
| `model_lifestyle` | 人景 | downstream | [model_turnaround, model_portrait] | i2i |

**迁移**：删除（或废弃）旧 key `model`；Skill 正文与 plan 资产列表改用新标题。

### 1.4 视频层（3 节点）

| key | title | 内容定位 | depends_on | gen_mode | chain/role |
| --- | --- | --- | --- | --- | --- |
| `video_product` | 产品展示视频 | 纯产品（四视图/白底旋转展示） | [product_turnaround, white_bg] | v_ref | `product` / `downstream` |
| `video_scene` | 场景氛围视频 | 空间/氛围运镜 | [scene, product_turnaround] | v_ref | `product` / `downstream` |
| `video_lifestyle` | 人景生活方式视频 | 产品 + 模特 + 场景 | [model_lifestyle, product_turnaround, scene] | v_ref | 跨链下游：`chain` 可标 `model` 或以无 chain + 显式 depends_on 为准 |

**文案规则**：`copy_main` **不**出现在任一视频的 `depends_on` / `refOrder`；旁白或字幕诉求写入该视频的 `prompt_hint_template`（可由 plan 摘要注入文案要点）。

**refOrder（视频）**：在 §2.1 规则上，按 `depends_on` 拓扑序附加图像 nodeId（跳过缺失）；`plan_node` 可选置前。`video_lifestyle` 优先顺序示意：`[plan, product_turnaround, scene, model_lifestyle]`。

### 1.5 其他

- `copy_main`：仍独立，无 chain。  
- `auto_generate`：image/video 默认真；文案 false（与 A 一致）。

---

## 2. 出图 ref 装配与 prompt

### 2.1 refOrder 规则

`split` 时初连 refs；**`orchestrate_gen` 在每次 `run_image_generation` / `run_video_generation` 之前再刷一次**（保证 seed/turnaround 已成功）：

| role | refOrder（nodeId，跳过缺失） |
| --- | --- |
| seed | `[plan_node_id]`（可选） |
| turnaround | `[plan_node_id, seed_node_id]` |
| downstream | `[plan_node_id, seed_node_id, turnaround_node_id]` |
| 无 chain | 现状：`[plan_node_id, …depends_on nodeIds]` |

同链解析：按 item.`chain` 查找同 manifest 中 `role=seed` / `role=turnaround` 的 key → node_id。

### 2.2 四视图 prompt 模板（产品 / 模特各一份）

强制写入 `prompt_hint_template`（可再经 plan/split 轻量替换品类词）：

- 单张拼图、**横排 4 格**：最左 **近景特写**，后 **正 / 侧 / 背**  
- 同一主体锁定（产品：同 SKU/材质/比例；模特：同脸/发型/服装）  
- 干净背景、商业摄影；禁止每格换主体  
- 明确「四格同框、一次出图」

### 2.3 下游 prompt

- 产品下游：强调与四视图同一产品身份；i2i 吃 turnaround（± 白底）  
- 人景：同一模特身份 + 场景互动；ref = 定妆 + 四视图  

### 2.4 失败

- seed / turnaround 失败 → 同链下游 `dependency_failed`（沿用现有依赖失败逻辑）  
- **不做** 独立身份锁 API；一致性 = ref 顺序 + prompt 约束  

---

## 3. trimmed / 与 A 兼容 / 任务卡

### 3.1 trimmed

- 仍用「选 key + depends_on 闭包」；`chain`/`role` 不另开裁剪算法。  
- 推荐默认保留：`copy_main` + 产品 `white_bg` → `product_turnaround` → `hero_main`（± `detail_cut` / `video_product`）。  
- 模特链：full 全量；trimmed 可整链省略，或只要人景则闭包带上定妆+四视图。  
- 禁止留下下游却裁掉同链 turnaround（闭包保证）。

### 3.2 与 A（拓扑预览 HITL）

- 方案确认前不写画布；确认后 split 出骨架 + Mermaid（边=depends_on，自然呈现双链）。  
- `await_topo` NL 改拓扑后重发 Mermaid；确认出图后才 orchestrate。  
- 任务卡：每 key 一项（含四视图 / 定妆 / 人景）；状态机不变。

### 3.3 非范围（C 及以后）

- 用户 Dock/画布手工增删改后再「执行生图」  
- ControlNet / IP-Adapter / 人脸锁等模型侧能力  

---

## 4. 实现要点（文件级）

| 区域 | 改动 |
| --- | --- |
| `skills/.../canvas-manifest.yaml` | 扩键、depends_on、`chain`/`role`、四视图 prompt |
| `skills/.../SKILL.md` | 资产说明与旧 `model` 迁移 |
| `app/graph/state.py` | `SplitManifestItem` 增加 `chain` / `role` |
| `app/graph/nodes/split.py` | 透传元数据；初连 refs 可按 §2 规则 |
| `app/graph/nodes/orchestrate_gen.py` | 出图前按 chain/role 刷 `attach_refs` |
| `app/graph/topo_trim.py` / 测试 | 闭包覆盖新产品/模特键 |
| 测试 | manifest 依赖图；orchestrate ref 顺序；dependency_failed |

前端 chips / await_topo 控制流 **无需**为 B 大改（除非任务卡 title 映射）。

---

## 5. 成功标准

1. Manifest 含产品/模特双链；旧 `model` 已迁移。  
2. Mermaid / 画布 depends_on 符合 §1。  
3. 出图顺序 seed → turnaround → downstream；下游 refOrder 含同链 seed+turnaround。  
4. seed/turnaround 失败时下游 `dependency_failed`。  
5. full 与 trimmed 各通一条（trimmed 至少产品 seed→四视图→主图）。  
6. 四视图 prompt 含「四格：特写+正侧背」约束。  
7. 存在且仅这三类视频键；`copy_main` 不在视频 depends_on 中；人景视频依赖含 `model_lifestyle` + `product_turnaround` + `scene`。  

---

## 6. 文档同步

- 本文为 B 的权威规格。  
- `2026-07-25-agent-topology-preview-hitl-design.md` §8 指向本文。  
- `2026-07-23-agent-runtime-langgraph-design.md` 资产表中 `model` 行更新为三键链。  
