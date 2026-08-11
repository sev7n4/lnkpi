# Agent 对话体验提升 — 实物产品视觉出图（product_visual v2）

> **状态**：草案待审  
> **日期**：2026-08-11  
> **触发**：CVS-02 / CVS-02-AB 巨峰葡萄生产 UAT 体验审视（13 类问题）  
> **读者**：产品、前端、Agent Runtime、Prompt 工程  
> **非范围**：具体 Vue 组件实现、硬编码文案常量表（实现应走 **规格驱动的模板 + envelope**）

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.0 |
| 适用范围 | `flow_mode: product_visual` + `product_visual_scheme_v2=true`；**Presentation 层规范可复用**至 Campaign / atomic |
| 前置规格 | [2026-08-06-agent-sidebar-copy-design.md](./2026-08-06-agent-sidebar-copy-design.md)（侧栏文案 v1） |
|  | [2026-07-25-agent-task-progress-card-design.md](./2026-07-25-agent-task-progress-card-design.md)（任务进度卡） |
|  | [2026-08-11-product-visual-phase2-scheme-ssot-design.md](./2026-08-11-product-visual-phase2-scheme-ssot-design.md)（方案层 L1/L2/L3） |
|  | [2026-08-11-product-visual-phase2-scheme-ssot-uat.md](./2026-08-11-product-visual-phase2-scheme-ssot-uat.md)（UAT 旅程） |

---

## 〇、与既有「输出标准化规范」的关系

本文 **迭代** [侧栏 Assistant 文案规范](./2026-08-06-agent-sidebar-copy-design.md)，不推翻其原则：

| 既有原则 | 本文扩展 |
|----------|----------|
| 用户语言优先 | 增加 **阶段步骤条 + 呈现组件选型表** |
| 一轮一气泡、阶段替换 | 增加 **门控专用 envelope**（卡片/表格与 prose 分离） |
| 内外分离 | 增加 **machine payload 隐藏清单**（含 `__macro_scheme_decision__` 等） |
| 进度可感知 | 与 **任务进度卡** 对齐；product_visual 出图阶段复用 `task_list` / `task_update` |
| 说一次 | 各阶段 **信息只出现一次**；上下文通过 **摘要回显** 衔接，不重复粘贴长文 |

**实现约束（规格驱动，非写死 UI）：**

- Runtime 输出 **结构化 envelope**（JSON 字段 + markdown 槽位），Web 按 `presentation_kind` 选组件。
- 文案模板存放于 Skill 资产 / `sidebar_copy` 扩展模块，**版本化**（如 `product-visual-copy/1.0.0.yaml`）。
- LLM 生成的 **行业 prose** 仍走自由文本，但须包在 **固定章节标题** 内（见 §4）。

---

## 一、用户旅程与步骤条（全局上下文衔接）

侧栏 **持久步骤条**（非门控时才完整展示；门控时高亮当前步）：

| Step | 阶段 ID | 用户语言标签 | 典型呈现 |
|------|---------|--------------|----------|
| 1 | `image_qa` | 检查产品图 | 友好提示 + 选项按钮 |
| 2 | `scheme_draft` | 理解需求 · 出方案 | 结构化 prose |
| 3 | `macro_select` | 选宏观风格 | **卡片**（多选） |
| 4 | `ssot_persist` | 方案落盘 | 单行确认 + 画布定位 |
| 5 | `shot_plan` | 定构图清单 | **表格** |
| 6 | `topo_preview` | 预览出图计划 | **卡片列表** + 可选折叠 mermaid |
| 7 | `generating` | 出图中 | **任务进度卡** |
| 8 | `delivery` | 选定稿 | **卡片**（按 shot 分组） |
| 9 | `done` | 交付完成 | **交付清单表格** |

**上下文衔接规则（§3.3）：** 每个门控消息的 **首段** 必须含 `需求摘要`（从 `visual_intent` 渲染，≤120 字），使同 thread 多轮话术时用户知道「当前按哪条需求执行」。

---

## 二、呈现组件选型（卡片 / 表格 / 提示 / prose）

### 2.1 组件目录

| `presentation_kind` | 用途 | 何时用 | 禁止 |
|---------------------|------|--------|------|
| `prose_block` | 行业方案、解释说明 | 方案初稿、修订说明 | 夹带 JSON / 节点 type |
| `callout_info` | 单段友好提示 | 等待说明、勿切 tab、lazy seed 解释 | 红色恐吓式「异常」 |
| `callout_warn` | 可继续但需注意 | 识图软通过、部分出图失败 | 未给下一步动作 |
| `option_chips` | 2~4 个互斥/并列动作 | QA 门控、确认类 | 超过 4 个选项 |
| `macro_scheme_cards` | L1 宏观方案 | ≥2 套宏观方案 | 单套时出现 |
| `shot_table` | L2 shot 清单 | 拆解确认 | 裸 JSON 数组 |
| `topo_card_list` | 出图节点计划 | 拓扑门控默认 | 默认展示 mermaid 源码 |
| `topo_mermaid` | 技术拓扑 | **折叠**「查看技术拓扑」 | 作为唯一预览 |
| `task_progress_card` | 出图执行 | confirm 后至终局 | 与散文进度重复刷屏 |
| `delivery_cards` | Phase 4 定稿 | 候选切换 | 内部 shot_id 作标题 |
| `delivery_summary_table` | 终局交付 | `done` 阶段 | 运维式「成功 5 失败 0」 |
| `stepper` | 旅程定位 | 所有门控顶部 | — |
| `context_recap` | 需求摘要条 | 每个门控首段 | 重复粘贴全文方案 |

### 2.2 表格 vs 卡片 决策树

```
是否要选择/切换/多选？
  ├─ 是 → 选项 ≤4 且字段少 → option_chips
  ├─ 是 → 宏观方案（含推荐/理由/摘要）→ macro_scheme_cards
  ├─ 是 → 定稿候选（含缩略图）→ delivery_cards
  └─ 否 → 是否多行结构化清单？
        ├─ 是 → shot 清单 / 交付汇总 → shot_table / delivery_summary_table
        └─ 否 → prose_block 或 callout_*
```

### 2.3 Machine payload 隐藏（侧栏不可见）

以下 **仅** 写入 user message（供 resume）或 state，**禁止**作为 assistant 可见正文：

- `__macro_scheme_decision__{...}`
- `__scheme_decision__{...}`
- `__delivery_decision__{...}`
- `flow_mode`、`phase`、`shot_id` 裸键名（表内可用中文列名代替）
- mermaid 源码（除非用户展开「技术拓扑」）
- 「识图模型返回格式异常」等 **内部错误 type**（须映射为用户语言，见问题 #1）

---

## 三、Agent 输出内容标准化（product_visual v2）

### 3.1 Envelope 结构（规格层，非代码）

每条 assistant 门控/阶段消息 = **一层 envelope + 可选 LLM prose 槽位**：

```yaml
# 逻辑结构示意 — 实现可为 SSE data 或 AIMessage additional_kwargs
presentation:
  kind: macro_scheme_cards | shot_table | ...
  stepper:
    current: macro_select
    completed: [image_qa, scheme_draft]
  context_recap: "巨峰葡萄礼盒：礼盒主视觉、快递防压结构、手持送礼场景"
  body: ...           # 组件专用 payload
  primary_action:
    label: "确认宏观方案"
    message: "__macro_scheme_decision__..."  # 用户不可见，chip 发送
  secondary_actions: [...]
```

### 3.2 方案初稿 prose 章节（LLM 须遵守）

`scheme_draft` 阶段 LLM 输出 **必须** 含以下 Markdown 标题（顺序固定）：

```markdown
## 我理解您的需求
（≤3 句，复述用户 utterance，不含风格名除非用户明确提到）

## 设计方向摘要
（3~5 条 bullet，行业语言）

## 完整方案说明
（长文 prose，≥200 字，可展开）

## 接下来请您
（一句指引：若有多套风格将在下方卡片中选择）
```

### 3.3 上下文衔接字段

| 字段 | 来源 | 用于 |
|------|------|------|
| `context_recap` | `visual_intent` 渲染 | 各门控首段 |
| `effective_utterance` | 当前轮 utterance；topic switch 时覆盖旧轮 | LLM + 摘要 |
| `selected_macro_ids` | state | shot 表、定稿卡角标 |
| `user_request_labels` | 从 utterance 抽取的场景短语 | 定稿分组标题 |
| `expected_delivery_count` | 编排层计算 | 拓扑/定稿/结束语 |

**Thread 污染防护：** 当检测到同 thread 存在 **矛盾 utterance**（如先「两套都要」后纯口语），`context_recap` 以 **最后一次用户发送的完整需求** 为准，并在 `callout_info` 中注明：「已按您最新描述执行；风格请在下方卡片选择。」

---

## 四、问题清单（13 类 · 逐条记录）

> 每条含：**问题 ID**、**UAT 现象**、**优先级**、**呈现规格**、**上下文衔接**、**验收标准**  
> 实现映射列供研发排期，**本文档不规定具体文件改动**。

---

### 问题 #1 — 识图 QA：失败文案技术化、选项与事实不符

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-01` |
| **现象** | 「识图模型返回格式异常」+「清晰度尚可」并存；用户只能点「已是白底图，继续使用」 |
| **优先级** | **P0** |
| **根因** | 内部 error type 直出；未区分 **服务失败** vs **质量不合格** |

**呈现规格：**

| 场景 | `presentation_kind` | 正文规范 |
|------|---------------------|----------|
| 质量不合格 | `callout_warn` + `option_chips` | 标题「产品图需要处理」；列表：清晰度 / 白底 / 产品可识别（✓/✗ 人话） |
| 服务失败（格式异常/超时） | `callout_info` + `option_chips` | 标题「自动识图暂时不可用」；说明「图片本身看起来可用」；选项：**「就用这张图，继续」** / 重拍 / 生成白底 |
| 软通过 | 无门控或单行 `callout_info` | 「已采用您上传的产品图，开始出方案」 |

**上下文衔接：** 附 **附件缩略图** + 文件名；`context_recap` 不含识图技术词。

**验收：** 果园实拍图不再出现「格式异常」作为主标题；UAT-P1-002 通过。

---

### 问题 #2 — 「确认出图」按钮文案重复、步骤不可辨

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-02` |
| **现象** | Shot 确认与拓扑门控均为「确认出图」；历史中难以区分 |
| **优先级** | **P0** |

**呈现规格：**

| 门控 | 主按钮文案 | 副说明（`callout_info`） |
|------|------------|-------------------------|
| `await_shot_confirm` | **确认构图，生成预览** | 「共 N 个构图任务；确认后将编排出图顺序，尚未开始生成。」 |
| `await_topo` | **开始出图（约 X 分钟）** | 「方案已写入画布；确认后将生成白底、四视图及 M 张场景图。」 |

**组件：** 两阶段均展示 `stepper`（高亮 5 / 6）。

**上下文衔接：** 按钮上方 `shot_table` 摘要前 3 行。

**验收：** 用户不看历史即可说出「当前是构图确认还是真正出图」。

---

### 问题 #3 — A+B 双选后预期不清（张数、分配方式）

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-03` |
| **现象** | 选 A+B 后仅 3 个 shot；定稿卡「主视觉·A / 开箱·B / 送礼·A」；用户以为每套各 3 张 |
| **优先级** | **P0** |

**呈现规格：**

| 时机 | 组件 | 内容 |
|------|------|------|
| 宏观确认前 | `macro_scheme_cards` 底栏 | `callout_info`：**「已选 K 套风格 → 预计场景图 P 张（说明分配策略）」** |
| 分配策略 A（当前：混排） | 同上 | 「不同构图将分别采用 A/B 风格，并非每个场景各出 2 张。」 |
| 分配策略 B（全量，规格 L1 多选） | `shot_table` | 列：`场景` / `方案` / `说明`；行数 = K × 场景数 |
| SSOT 落盘后 | 画布节点 prose | 强制 `## 方案 A` + `## 方案 B` 两节 |

**上下文衔接：** `expected_delivery_count` 与 `selected_macro_ids` 同步更新；定稿/结束语数字一致。

**验收：** UAT-CVS-02-AB Step 2~4；用户能回答「一共定稿几张、哪张是哪套」。

---

### 问题 #4 — 同 thread 历史话术污染有效需求

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-04` |
| **现象** | thread 内既有「红金/牛皮纸两套都要」又有口语版；摘要混乱 |
| **优先级** | **P0** |

**呈现规格：**

| 组件 | 内容 |
|------|------|
| `context_recap` | 仅 **当前有效需求**（`effective_utterance` 提炼） |
| `callout_info`（可选） | 「已按您最新描述执行；风格请在卡片中选择，无需在话术里指定。」 |
| `option_chips`（可选） | 「以本轮需求为准」→ 重置 macro/shot 草案 |

**上下文衔接：** 见 §3.3；与 [context-engineering](./2026-08-06-agent-context-engineering-design.md) topic switch 策略一致。

**验收：** 口语话术 + 卡片双选后，方案 prose 不出现用户未说的风格名。

---

### 问题 #5 — 方案长文不可扫读

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-05` |
| **现象** | Phase 2a 大段 wall of text，卡片前缺少结构 |
| **优先级** | **P1** |

**呈现规格：**

| 部分 | 组件 |
|------|------|
| 首屏 | `prose_block` 仅渲染 §3.2 前 **两节**（需求 + 摘要） |
| 全文 | 默认折叠「展开完整方案」 |
| 宏观卡片 | `macro_scheme_cards`：`summary` ≤80 字 + 标签（如 `#轻奢` `#牛皮纸`）+ `recommend_reason` 独立行 |

**上下文衔接：** `## 接下来请您` 指向下方卡片。

**验收：** UAT-P2-001；卡片可在 10 秒内扫读决策。

---

### 问题 #6 — 拓扑预览 Mermaid 对运营用户不友好

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-06` |
| **现象** | 侧栏默认展示 mermaid 源码 |
| **优先级** | **P1** |

**呈现规格：**

| 默认 | 折叠 |
|------|------|
| `topo_card_list`：图标 + 中文节点名 + 依赖箭头（卡片竖排） | `topo_mermaid` |
| 底栏：`callout_info` 预计 **张数 / 耗时 / 积分** | — |

**表格（可选）：**

| 将生成 | 类型 | 说明 |
|--------|------|------|
| 白底主图 | 基础 | Phase1 |
| … | … | … |

**上下文衔接：** 点击行 → 画布定位（已有「在画布中定位」需与表行绑定）。

**验收：** UAT-P3-003；默认视图无 `flowchart LR` 字样。

---

### 问题 #7 — 出图等待进度不透明

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-07` |
| **现象** | 仅「节点出图中」；切 tab 风险未解释 |
| **优先级** | **P1** |

**呈现规格：**

| 组件 | 字段 |
|------|------|
| `task_progress_card` | 每行：中文 title、`running/done/failed`、可选 `重试 1/2` |
| 顶部 `callout_info` | 「出图进行中（约 X 分钟），请勿关闭或切换标签页」 |
| 进度摘要 | 「已完成 a/b · 正在生成：{current_title}」 |

**上下文衔接：** task 行 title 与 `shot_table` 中文名一致。

**验收：** 对齐 [任务进度卡规格](./2026-07-25-agent-task-progress-card-design.md)；UAT 全程可见 a/b。

---

### 问题 #8 — 定稿门控缺少与用户原话的对照

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-08` |
| **现象** | `packaging_hero__1` 等技术名；用户难映射「礼盒/防压/送人」 |
| **优先级** | **P1** |

**呈现规格：**

| 组件 | 结构 |
|------|------|
| `delivery_cards` | 分组标题 = `user_request_labels[i]`（用户语言） |
| 卡片 subtitle | `[方案A] 礼盒主视觉`（macro + shot 中文） |
| 角标 | 「推荐」于默认候选 |
| 底栏 | 「确认后将交付 **N** 张定稿图」 |

**上下文衔接：** `user_request_labels` 来自 utterance 抽取，存 state 供 Phase 4 复用。

**验收：** UAT-P4-001；定稿界面不需读 shot_id。

---

### 问题 #9 — 结束语像运维日志

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-09` |
| **现象** | 「流程结束。合计：成功 5，失败/跳过 0」 |
| **优先级** | **P1** |

**呈现规格：**

| 组件 | 内容 |
|------|------|
| `delivery_summary_table` | 列：交付项 / 方案 / 画布定位 |
| `prose_block` 首句 | 「✅ 您的 {产品名} 视觉稿已就绪」 |
| `option_chips` | 「在画布中定位全部」「导出打包（二期）」 |
| 次要 | 基础资产（白底/四视图）单独小节，**不与定稿混淆** |

**禁止：** 以「成功 5 失败 0」作为唯一结束语。

**验收：** 用户 5 秒内能列出定稿清单。

---

### 问题 #10 — 门控过多导致「说了又停」疲劳

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-10` |
| **现象** | QA → 宏观 → shot → 拓扑 → 定稿，约 4 次硬停 |
| **优先级** | **P2** |

**呈现规格（产品策略，分阶段落地）：**

| 策略 | 说明 |
|------|------|
| 合并 shot + topo | 单页：`shot_table` + 简版 `topo_card_list` + 按钮「确认构图并开始出图」 |
| 快速模式（可选） | 单套宏观 + QA 通过 + 高置信 intent → `callout_info` 提供「少确认快速出图」 |
| 修订计数 | 「还可修订方案 2 次」于 `scheme_draft` 门控 |

**验收：** 默认路径硬停 ≤3 次（P2 目标）。

---

### 问题 #11 — 侧栏与画布信息分工不清

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-11` |
| **现象** | 方案先在侧栏后在 SSOT；shot 在侧栏、构图在画布；「展开 19 项」 buried |
| **优先级** | **P2** |

**呈现规格：**

| 规则 | 说明 |
|------|------|
| 门控三段式 | 上：`context_recap`；中：决策组件；下：主按钮 |
| 画布产出 | 默认展示最近 5 项 + 「展开全部」 |
| SSOT | 侧栏仅 **摘要 + 定位按钮**，全文在画布 |
| machine 隐藏 | §2.3 |

**验收：** 单次门控内完成决策，无需来回滚动找按钮。

---

### 问题 #12 — 「重新拍摄上传」后 dead-end

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-12` |
| **现象** | 点重拍 → 「请重新上传后再试」→ 对话停滞 |
| **优先级** | **P2** |

**呈现规格：**

| 步骤 | 组件 |
|------|------|
| 点重拍 | `callout_info` + 高亮上传区（Web chrome） |
| 文案 | 「请上传新照片，上传完成后点 **继续**」 |
| 上传完成 | `option_chips`：**「继续」** 自动携带原 `effective_utterance` |
| 状态 | 清空 SSOT/shot；toast「已重置视觉方案，保留您的需求描述」 |

**上下文衔接：** retake 不清空 `visual_intent` / `effective_utterance`。

**验收：** UAT-P1-004 无需用户重打话术。

---

### 问题 #13 — 缺少话术与技能引导

| 子项 | 内容 |
|------|------|
| **ID** | `UX-PV-13` |
| **现象** | 用户在话术里写风格名；空状态无示例 |
| **优先级** | **P2** |

**呈现规格：**

| 位置 | 组件 |
|------|------|
| 技能空状态 | 3 条可点击 **示例话术**（礼盒 / Listing / 空间） |
| 宏观卡片上方 | `callout_info`：「风格在这里选；需求用口语描述即可。」 |
| 附件区 | 「建议清晰 product 图；白底更佳，非白底也可继续。」 |

**验收：** 新用户首次任务可不查文档完成 CVS-02。

---

## 五、分阶段消息模板索引（规格层）

> 完整字符串模板随 Skill 资产版本发布；此处定义 **槽位与组件**，供 Prompt / sidebar_copy 实现。

| 阶段 | `presentation_kind` | 必填槽位 | 主按钮 |
|------|---------------------|----------|--------|
| `image_qa` | callout + option_chips | checks[], thumbnail | 就用这张图，继续 |
| `scheme_draft` | prose_block | §3.2 四章 | （无，自动进入 macro） |
| `macro_select` | macro_scheme_cards | schemes[], max_select=2 | 确认宏观方案 |
| `ssot_persist` | callout_info | node_link | 在画布中查看方案 |
| `shot_confirm` | shot_table + stepper | shots[], expected_count | 确认构图，生成预览 |
| `topo_preview` | topo_card_list + stepper | nodes[], eta, credits | 开始出图（约 X 分钟） |
| `generating` | task_progress_card | items[], current | 取消生成 |
| `delivery` | delivery_cards | groups[], selections | 确认全部定稿 |
| `done` | delivery_summary_table + prose | finalized[], basics[] | 在画布中定位全部 |

---

## 六、优先级与交付映射

| 优先级 | 问题 ID | 建议迭代 |
|--------|---------|----------|
| **P0** | UX-PV-01 ~ 04 | 与 CVS-02-AB 下一版 UAT 同发 |
| **P1** | UX-PV-05 ~ 09 | 侧栏 copy v2 + interrupt envelope |
| **P2** | UX-PV-10 ~ 13 | Graph 合并门控 + 空状态引导 |

**Implementation Plan:** [2026-08-11-agent-conversation-ux-product-visual.md](../plans/2026-08-11-agent-conversation-ux-product-visual.md)

**运行中中断与改意图（后续）：** [2026-08-12-agent-mid-run-interrupt-design.md](./2026-08-12-agent-mid-run-interrupt-design.md) — v2.1 已补前端 SSE cancel；后端 cancel + 改意图协议待 Phase 1。

**研发分工（建议）：**

| 层 | 职责 |
|----|------|
| Runtime | envelope 字段、模板渲染、error type 映射、expected_delivery_count |
| Web | 按 `presentation_kind` 渲染；隐藏 machine payload |
| Skill/Prompt | §3.2 prose 章节约束、macro/shot 中文 label |
| QA | 本文 §四 验收标准 → 增补至 [UAT 文档](./2026-08-11-product-visual-phase2-scheme-ssot-uat.md) |

---

## 七、验收（文档级）

1. 13 类问题均在 §四 有 **ID + 呈现组件 + 验收句**。  
2. 任意新门控须查 §2 选型表，不得新增 ad-hoc Markdown 格式。  
3. 实现后 CVS-02 / CVS-02-AB 复跑：P0 四项 **全 Pass** 方可称「对话体验 v2 交付」。  
4. [侧栏文案规范 v1](./2026-08-06-agent-sidebar-copy-design.md) 保留；本文 **product_visual 专用章节** 冲突时以本文为准，通用原则以 v1 为准。

---

## 八、变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-08-11 | v1.0 | 初稿：13 类 UAT 问题清单 + 呈现组件规范 + envelope 结构；迭代 sidebar-copy |
