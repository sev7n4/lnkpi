# 实物产品视觉出图 — Phase 2 方案层 v1.1 TDD 用例规格

> **状态**：草案待审  
> **日期**：2026-08-11  
> **关联规格**：[2026-08-11-product-visual-phase2-scheme-ssot-design.md](./2026-08-11-product-visual-phase2-scheme-ssot-design.md)（v1.1）  
> **主规格**：[2026-08-10-ecommerce-product-visual-design.md](./2026-08-10-ecommerce-product-visual-design.md)（v1.9，Phase 3c/4 铁律仍适用）

| 字段 | 值 |
|------|-----|
| 文档版本 | v1.0 |
| 文档定位 | **Companion Test Spec**（不替代功能规格；实现时 **先写失败测试 → 再写代码**） |
| executable 落点 | `services/agent-runtime/tests/`、`eval-*-set.yaml`、`apps/web/**/*.test.ts`、`deploy/prod-*.py` |

---

## 〇、为何单独成文

| 合入规格 | 本文件（研发 TDD） | [UAT 用户验收](./2026-08-11-product-visual-phase2-scheme-ssot-uat.md) |
|----------|-------------------|----------------------------------------------------------------------|
| 规格臃肿 | 自动化用例 + pytest 映射 | **浏览器手工步骤 + 产品 Sign-off** |
| 读者 | 研发 / CI | 产品 / QA / 演示验收 |

**规格 §七** 保留 AC-ID 摘要；本文件展开 **研发自动化** 场景；**最终用户是否满意** 以 UAT 为准。

---

## 一、TDD 测试金字塔

```
                    ┌─────────────────────┐
                    │ L4 生产 smoke       │  deploy/prod-product-visual-cvs-live.py
                    ├─────────────────────┤
                    │ L3 CVS / 图集成     │  test_eval_cvs_set_v2.py, subgraph interrupt
                    ├─────────────────────┤
                    │ L2 节点单测         │  test_*_v2.py（每 LangGraph 节点）
                    ├─────────────────────┤
                    │ L1 纯函数 / 模型    │  parsers, routes, limits, resume classify
                    └─────────────────────┘
                              ▲
                         先写 L1/L2，再 L3，最后 L4
```

### 1.1 测试分层定义

| 层级 | 说明 | Mock 策略 |
|------|------|-----------|
| **L1** | 无 I/O 或仅解析 JSON/YAML | 无 LLM、无 nest |
| **L2** | 单节点 `node(state)` | FakeLLM 固定双输出；FakeNest 记录 tool calls |
| **L3** | 编译 subgraph + `interrupt_before` 逐步 resume | FakeLLM + FakeNest；CVS fixture |
| **L4** | 生产 HTTP / 浏览器路径 | 真实环境；可选 `--dry-run` |

### 1.2 TDD 执行顺序（每个 Task）

1. 从本文件取 **Case ID** → 写 **失败** pytest / vitest  
2. 运行确认 **FAIL**（原因符合预期）  
3. 最小实现使 **PASS**  
4. 回归同 Phase 已有用例  
5. 更新 `eval-cvs-set-v2.yaml`（若属 L3 金标）

### 1.3 Feature Flag 测试矩阵

| `product_visual_scheme_v2` | 预期路径 | 必测 |
|----------------------------|----------|------|
| `true`（默认） | v1.1 全流程 | 本文件 **全部 v2 Case** |
| `false` | legacy JSON plan | **LEG-*** 回归子集，防退化 |

---

## 二、用例命名与字段

**Case ID 格式：** `{PHASE}-{AREA}-{SEQ}` 或 `{CVS}-{SUB}`

每条用例包含：

| 字段 | 说明 |
|------|------|
| **Maps** | 规格规则 R-* / AC-* |
| **Layer** | L1–L4 |
| **Priority** | P0 阻塞发布 / P1 应覆盖 / P2 增强 |
| **File** | 目标测试文件（实现时创建） |
| **Given / When / Then** | BDD 三段 |

---

## 三、Phase 0 — 路由与 Feature Flag

| Case ID | Maps | Pri | Layer | File |
|---------|------|-----|-------|------|
| P0-ROUTE-001 | — | P0 | L1 | `test_product_visual_route.py` |
| P0-ROUTE-002 | — | P0 | L1 | 同上 |
| P0-FLAG-001 | §八 | P0 | L2 | `test_product_visual_v2_flag.py` |

### P0-ROUTE-001 实拍 + 多类型诉求 → product_visual

- **Given** `requested_skill_id=ecommerce-product-visual`，附件 `role=product`
- **When** `decide_route(utterance="做主图和包装效果图")`
- **Then** `flow_mode=product_visual`，`skill_id=ecommerce-product-visual`

### P0-ROUTE-002 单句改图 → 非 product_visual

- **Given** 附件 product，utterance「把背景换成白色」
- **When** `decide_route`
- **Then** `flow_mode != product_visual`（atomic 等）

### P0-FLAG-001 v2=true 走 dialog_draft 图节点

- **Given** env `product_visual_scheme_v2=true`
- **When** QA pass 后查 conditional edge
- **Then** 下一节点为 `dialog_draft`，**非** `plan_product_visual`

### P0-FLAG-002 v2=false 走 legacy plan（LEG）

- **Given** `product_visual_scheme_v2=false`
- **When** QA pass
- **Then** 下一节点仍为 `plan_product_visual`

---

## 四、Phase 1 — Vision QA 与 Seed 时机

| Case ID | Maps | Pri | Layer |
|---------|------|-----|-------|
| P1-VQA-001 | R-Vision-QA, AC-P1-VISION | P0 | L2 |
| P1-VQA-002 | R-Vision-QA | P0 | L2 |
| P1-VQA-003 | R-Vision-QA | P1 | L2 |
| P1-VQA-004 | §2.3 CVS-03 | P0 | L2 |
| P1-HITL-001 | R-Vision-QA | P0 | L2 |
| P1-HITL-002 | R-Abort-Clean | P0 | L2 |
| P1-HITL-003 | R-Vision-QA | P0 | L2 |
| P1-SEED-001 | §2.3 lazy | P0 | L3 |
| P1-SEED-002 | §2.3 eager | P1 | L3 |
| P1-SEED-003 | AC-P1-LAZY-SEED | P0 | L3 |

**File（Phase 1 聚合）：** `tests/test_product_visual_vision_qa_v2.py`

### P1-VQA-001 Vision 必须启用

- **Given** FakeVisionLLM 返回 `{pass: true, reason: "识别为大闸蟹，清晰度足够"}`
- **When** `vision_qa_check(state)` with product ref
- **Then** `image_qa_result=pass`，metadata `visionUsed=true`  
- **Neg** 若 LLM 未调用 vision → **FAIL**

### P1-VQA-002 识图 fail → await_image_qa

- **Given** Vision 返回 `{pass: false, reason: "主体不完整"}`
- **When** `vision_qa_check`
- **Then** `phase=await_image_qa`，消息含理由摘要

### P1-VQA-003 仅启发式不得单独 pass（回归）

- **Given** 无 vision 调用，metadata sharpness=0.9, has_white_bg=true
- **When** v2 path `vision_qa_check`
- **Then** **不得** `pass`（必须走 vision 或显式降级 flag）

### P1-VQA-004 室内场景白底放宽

- **Given** CVS-03 utterance 含「室内/装修」，`scene_kind=interior`
- **When** vision pass + 无白底
- **Then** `image_qa_result=pass`（继承 v1.9 AC）

### P1-HITL-001 生成标准白底图

- **Given** `await_image_qa`，用户「生成标准白底图」
- **When** `classify_image_qa_decision` → remedy
- **Then** 路由 remediate；**不**进入 dialog_draft 直至 remediated

### P1-HITL-002 RETAKE 清 state

- **Given** 已有 `plan_node_id`、`shot_manifest`
- **When** 用户「我重新拍摄上传」
- **Then** `R-Abort-Clean` 字段均为 null；nest 收到删除 SSOT/L2/seed 指令

### P1-HITL-003 QA 通过后 lazy 默认不进 seed

- **Given** `requires_standard_product_assets=false`（默认）
- **When** vision QA pass
- **Then** 下一节点 `dialog_draft`；**无** `phase1_seed_eager` 调用

### P1-SEED-001 lazy seed 在 orchestrate 之后

- **Given** CVS-02 完整路径 stub
- **When** trace nest calls 顺序
- **Then** `canvas_ssot_commit` 早于 `run_image_generation(white_bg)`  
- **Maps** AC-P1-LAZY-SEED

### P1-SEED-002 eager seed 强依赖 listing

- **Given** utterance「先出白底主图和四视图」，LLM 设 `requires_standard_product_assets=true`
- **When** QA pass
- **Then** `phase1_seed_eager` 在 `dialog_draft` **之前**执行

### P1-SEED-003 lazy 仅生成 shot 声明的 ref

- **Given** shot 仅需 `white_bg`，无 turnaround ref
- **When** `phase1_seed_lazy`
- **Then** 只 gen `white_bg`，**不** gen `product_turnaround`

---

## 五、Phase 2 — 对话框草案 / 宏观选择 / SSOT

| Case ID | Maps | Pri | Layer |
|---------|------|-----|-------|
| P2-DRAFT-001 | R-Dialog-Draft, AC-P2-DIALOG | P0 | L2 |
| P2-DRAFT-002 | R-Dialog-Draft | P0 | L2 |
| P2-DRAFT-003 | R-Dialog-Draft, AC-P2-DUAL-OUTPUT | P0 | L2 |
| P2-DRAFT-004 | R-Dialog-Draft | P1 | L2 |
| P2-NOCANVAS-001 | R-No-Draft-Canvas, AC-P2-NO-DRAFT-CANVAS | P0 | L3 |
| P2-NOCANVAS-002 | R-No-Draft-Canvas | P0 | L3 |
| P2-MACRO-001 | R-Macro-Scheme-Select | P0 | L2 |
| P2-MACRO-002 | R-Macro-Scheme-Select | P0 | L2 |
| P2-MACRO-003 | §1.4 A+B | P0 | L3 |
| P2-MACRO-004 | §1.4 上限 | P1 | L2 |
| P2-MACRO-005 | R-Macro-Scheme-Select | P0 | L2 |
| P2-MACRO-006 | §1.4 合并叙事例外 | P2 | L2 |
| P2-REVISE-001 | R-Macro-Scheme-Select, L7 | P0 | L3 |
| P2-REVISE-002 | L7 超限 | P0 | L3 |
| P2-SSOT-001 | R-Canvas-SSOT, AC-P2-SSOT | P0 | L3 |
| P2-SSOT-002 | R-Canvas-SSOT | P0 | L3 |
| P2-SSOT-003 | §5 SSOT 编辑 | P1 | L3 |

**File：** `tests/test_product_visual_dialog_v2.py`，`tests/test_product_visual_macro_select_v2.py`

### P2-DRAFT-001 对话框 prose 非 JSON

- **Given** CVS-02 utterance + 大闸蟹 fixture ref
- **When** `dialog_draft` with FakeLLM
- **Then** 最后 AIMessage content 长度 ≥200，**不**以 `{` 开头 JSON；**非** JSON-only

### P2-DRAFT-002 双输出同次 LLM

- **Given** FakeLLM 返回 `{draft_prose, macro_schemes:[A,B,C]}`
- **When** `dialog_draft`
- **Then** state 同时有 prose 消息与 `macro_schemes[]`；**无**第二次 plan LLM 调用

### P2-DRAFT-003 卡片与 macro_schemes 一致

- **Given** macro_schemes 中 B.recommended=true
- **When** 前端 `defaultMacroSelections(state)`
- **Then** 默认勾选 B；`recommend_reason` 非空

### P2-DRAFT-004 prose 体裁含行业要素

- **Given** CVS-02
- **When** draft prose
- **Then** 含包装/冷链/中秋等 **至少 2 类** key topic（关键词或 embedding fixture 断言）

### P2-NOCANVAS-001 确认前 zero upsert

- **Given** 路径停在 `await_macro_scheme_select`
- **When** 统计 FakeNest `upsert_prompt_node` 调用
- **Then** 次数 = 0

### P2-NOCANVAS-002 2a 阶段禁止 JSON plan 节点

- **Given** dialog_draft 完成，未 confirm
- **Then** 无 content 含 `"image_types"` 的 upsert

### P2-MACRO-001 单方案跳过 HITL

- **Given** `macro_schemes.length === 1`
- **When** `route_after_dialog_draft`
- **Then** 直接 `canvas_ssot_commit`，**不** interrupt `await_macro_scheme_select`

### P2-MACRO-002 多方案 interrupt

- **Given** macro_schemes ≥2
- **When** dialog_draft 完成
- **Then** `phase=await_macro_scheme_select`，graph interrupt

### P2-MACRO-003 A+B 并行保留 SSOT 分节

- **Given** 用户选 `["A","B"]`
- **When** `canvas_ssot_commit`
- **Then** upsert content 含 `## 方案 A` 与 `## 方案 B`；**非**单段 merged（默认策略 B）

### P2-MACRO-004 超过 2 个 macro 拒绝

- **Given** 用户尝试选 A+B+C
- **When** `apply_macro_scheme_decision`
- **Then** 错误提示；保持 await 状态

### P2-MACRO-005 推荐方案唯一默认

- **Given** A/B/C 中 A、C recommended=true（非法双推荐）
- **When** parse macro_schemes
- **Then** 校验失败或归一化为 1 个 recommended

### P2-MACRO-006 用户要求融合时 merged 标题

- **Given** utterance「把 A 和 B 合成一套方案」
- **When** ssot commit
- **Then** content 标题含 `merged` 或等价标记

### P2-REVISE-001 修订回 2a 清画布

- **Given** 已有 SSOT + L2 nodes
- **When** 用户 revise 第 1 次
- **Then** `scheme_revision_count=1`；清除 SSOT/L2；重新 dialog_draft

### P2-REVISE-002 第 4 次修订强制推荐

- **Given** `scheme_revision_count=3`
- **When** 再次 revise
- **Then** 强制 `canvas_ssot_commit` 推荐方案；消息含超限说明

### P2-SSOT-001 确认后 plan_node_id 存在

- **When** macro confirm
- **Then** `plan_node_id` 非空；nest upsert content 为 prose

### P2-SSOT-002 checkpoint 与画布冲突以画布为准

- **Given** checkpoint shot_manifest 与 SSOT 节点 content 不一致
- **When** `decompose_from_ssot`
- **Then** 以 **画布 SSOT** 为准重新 decompose

### P2-SSOT-003 用户编辑 SSOT 触发重拆

- **Given** 用户改 SSOT 节点 content（canvas sync event）
- **When** resume「重新拆解」
- **Then** 重跑 3a→3b；**不**回 2a（macro 未变）

---

## 六、Phase 3 — 拆解 / 合成 / 编排 / 生图

| Case ID | Maps | Pri | Layer |
|---------|------|-----|-------|
| P3-DEC-001 | R-Shot-Decompose, AC-P2-MACRO | P0 | L2 |
| P3-DEC-002 | §1.5 不臆造 | P0 | L2 |
| P3-DEC-003 | §1.5 1:N type:shot | P1 | L2 |
| P3-DEC-004 | §1.5 命名 | P0 | L1 |
| P3-DEC-005 | §1.4 macro_scheme_id | P0 | L2 |
| P3-DEC-006 | AC-LIMIT | P0 | L1 |
| P3-CONF-001 | R-Shot-Confirm, AC-P3-SHOT-CONFIRM | P0 | L3 |
| P3-CONF-002 | R-Shot-Confirm | P1 | L3 |
| P3-SYN-001 | R-Prompt-Synthesize, AC-P3-SYNTH | P0 | L2 |
| P3-SYN-002 | R-Prompt-Synthesize | P0 | L2 |
| P3-ORCH-001 | R-Per-Shot-Orchestration, AC-P3-ORCH | P0 | L3 |
| P3-ORCH-002 | R-Per-Shot-Orchestration | P0 | L2 |
| P3-ORCH-003 | §3 禁止扁平 deps | P0 | L2 |
| P3-ORCH-004 | O4 跨 shot 依赖 | P1 | L3 |
| P3-VAR-001 | R-Shot-Variant | P0 | L2 |
| P3-VAR-002 | 铁律 禁止融合 | P0 | L2 |
| P3-GEN-001 | Phase 3c | P0 | L3 |
| P3-GEN-002 | partial failure | P1 | L3 |

**File：** `tests/test_product_visual_decompose_v2.py`，`test_product_visual_synthesize_v2.py`，`test_product_visual_orchestrate_v2.py`

### P3-DEC-001 CVS-02 最少 3 shots

- **Given** CVS-02 SSOT fixture（大闸蟹包装 prose）
- **When** `decompose_from_ssot`
- **Then** shot_manifest 含 type：`packaging_hero`、`packaging_structure`、`model_holding_pack`（shot_id 后缀 `__1` 起）

### P3-DEC-002 未提包装不出 packaging_*

- **Given** CVS-01 保温杯 utterance **无** packaging 词
- **When** decompose
- **Then** shot type_ids **不含** `packaging_*`

### P3-DEC-003 同 type 多 shot

- **Given** SSOT 含「详情页分上下两屏」
- **When** decompose
- **Then** 存在 `detail_page__1` 与 `detail_page__2`

### P3-DEC-004 shot_id 格式校验

- **When** parse shot_manifest
- **Then** 全部匹配 `^[a-z0-9_]+__\d+$`；拒绝裸 `c1`

### P3-DEC-005 A+B 各带 macro_scheme_id

- **Given** SSOT 两节 A/B
- **When** decompose
- **Then** 每条 shot 有 `macro_scheme_id` in `{A,B}`

### P3-DEC-006 downstream 计数 ≤12

- **Given** 8 shots × 2 variants + 2 seed
- **When** validate_downstream_limit
- **Then** 拒绝或截断并提示用户

### P3-CONF-001 shot 清单在 topo 前展示

- **Given** decompose 完成
- **When** interrupt 合并 UI payload
- **Then** 含 shot 表（type_id, label, macro_scheme_id, refs 摘要）

### P3-CONF-002 删减 shot 局部重编排

- **Given** 用户去掉 `packaging_structure__1`
- **When** resume confirm
- **Then** 重跑 synthesize+orchestrate；**不**回 2c

### P3-SYN-001 prompt_hint ≠ shot prose

- **Given** shot 文本为构图描述
- **When** `synthesize_gen_prompt`
- **Then** 出图节点 `prompt_hint` 非空且 **不等于** shot prose 原文

### P3-SYN-002 synthesize 消费 visual_intent 缓存

- **Given** visual_intent.style_hints
- **When** synthesize
- **Then** prompt_hint 体现 style（fixture substring 断言）

### P3-ORCH-001 model_holding_pack refs

- **Given** shot `model_holding_pack__1`
- **When** orchestrate attach_refs
- **Then** ref 含 shot 文本 node_id + white_bg node_id

### P3-ORCH-002 detail_macro refs turnaround

- **Given** shot `detail_macro__1`
- **When** orchestrate
- **Then** refs 含 `product_turnaround`，**不含**无关 seed

### P3-ORCH-003 禁止全量 [white_bg, turnaround]

- **Given** 3 个不同 shot manifest
- **When** orchestrate
- **Then** **并非**所有 item depends_on 相同二元组

### P3-ORCH-004 跨 shot ref 默认拒绝

- **Given** decompose 产出 packaging_hero 依赖 model_holding 出图结果
- **When** orchestrate 无用户确认
- **Then** 校验失败或降级为 shot_confirm 必审

### P3-VAR-001 关键 shot 2 变体

- **Given** `variant_eligible=true`，variant_count=2
- **When** build gen manifest
- **Then** keys `packaging_hero__1__v1`, `packaging_hero__1__v2`

### P3-VAR-002 禁止 prompt 融合

- **Given** 2 variants
- **When** gen_node 调用
- **Then** 两次 gen prompt **不相同**；无 merge 字段

### P3-GEN-001 并行 fan-out

- **Given** 5 shots ×1 variant
- **When** gen_scheduler
- **Then** Send 5 次；collect 5 结果

### P3-GEN-002 部分失败仍进 delivery

- **Given** 3 gen 中 1 fail
- **When** collect_gen
- **Then** delivery_summary 含 partial；UI 可「确认已完成」

---

## 七、Phase 4 — 定稿交付

| Case ID | Maps | Pri | Layer |
|---------|------|-----|-------|
| P4-DEL-001 | R-Phase4-Delivery, AC-P4-SHOT-DELIVERY | P0 | L2 |
| P4-DEL-002 | R-Phase4-Delivery | P0 | L2 |
| P4-DEL-003 | R-Phase4-Delivery | P0 | L2 |
| P4-DEL-004 | 微调重绘 | P1 | L3 |
| P4-DEL-005 | rollup UI | P1 | L1 |

**File：** `tests/test_product_visual_delivery_v2.py`，`apps/web/.../ProductVisualDeliveryCard.test.ts`

### P4-DEL-001 分组键 shot_id

- **Given** 3 shots 各 1 url
- **When** delivery_summary
- **Then** `delivery_selections` keys 为 shot_id

### P4-DEL-002 每 shot 最终 1 url

- **Given** shot 有 v1,v2 两候选
- **When** 用户 confirm delivery
- **Then** 每 shot_id exactly 1 finalized url

### P4-DEL-003 切换候选不 regen

- **Given** 用户 switch v1→v2
- **When** 查 gen 调用次数
- **Then** 无新增 run_image_generation

### P4-DEL-004 微调仅当前 shot

- **When** refine shot A
- **Then** 仅 A 的 gen 重跑；B 不变

### P4-DEL-005 type_id rollup 展示

- **Given** UI rollup 模式
- **When** render delivery card
- **Then** 同 type_id 下多 shot 分组显示

---

## 八、CVS 经典场景（L3 金标）

Executable：`services/agent-runtime/skills/ecommerce-product-visual/eval-cvs-set-v2.yaml`  
Runner：`tests/test_eval_cvs_set_v2.py`

| Case ID | 基于 | v2 扩展断言 |
|---------|------|-------------|
| CVS-01-v2 | 保温杯 6 类 | prose_fixture；shots ⊇ hero_main, model_display；lazy seed |
| CVS-02-v2 | 大闸蟹包装 | macro≥2 或单套；shots ⊇ packaging_hero/structure/model_holding_pack；visionUsed |
| CVS-02-AB-v2 | 选 A+B | SSOT 两节；shots 带 A/B macro_scheme_id；downstream≤12 |
| CVS-03-v2 | 客厅装修 | 无 white_bg seed；space_with_people shot；QA 白底放宽 |
| CVS-03-interior-sub | 同上 | shot refs 无强制 white_bg |

### CVS-02-v2 Given/When/Then（P0 阻塞）

- **Given** utterance（eval 原文）+ fixture 大闸蟹 product ref  
- **When** dry-run graph 至 decompose（LLM=fixture）  
- **Then**  
  - dialog prose ≥200 字  
  - `shot_manifest` ≥3 且 type 覆盖包装/结构/模特  
  - 2c 前 upsert=0；2c 后 SSOT prose  
  - lazy：`white_bg` gen 在 SSOT 之后  

### CVS-01-v2

- **Then** shots ≥6 type 覆盖；**exclude** packaging_*；human_presence shot 存在

---

## 九、前端 / HITL 用例（Vitest）

**File：** `apps/web/src/components/agent/agentInterruptGate.test.ts`，`ProductVisualMacroCard.test.ts`，`ProductVisualShotConfirm.test.ts`

| Case ID | Maps | Pri |
|---------|------|-----|
| FE-GATE-001 | await_macro_scheme_select | P0 |
| FE-GATE-002 | shot/topo 合并 | P1 |
| FE-MACRO-001 | A+B checkbox max 2 | P0 |
| FE-MACRO-002 | recommend_reason 展示 | P1 |
| FE-SHOT-001 | shot 表渲染 | P0 |
| FE-SSOT-001 | 重新拆解 CTA | P1 |
| FE-DEL-001 | shot 定稿切换 | P0 |

### FE-MACRO-001

- **When** 用户勾选第 3 个 macro
- **Then** 阻止提交；toast 提示最多 2 个

### FE-GATE-001

- **When** phase=`await_macro_scheme_select`
- **Then** chipSet=`macro_scheme_select`（非 legacy scheme_select）

---

## 十、修订 / 中止 / 边界 / 负向

| Case ID | 场景 | Pri |
|---------|------|-----|
| EDGE-001 | 无附件仅 utterance | P1 |
| EDGE-002 | 附件无 role=product | P0 |
| EDGE-003 | max_shots_per_macro=8 截断 | P1 |
| EDGE-004 | 空 macro_schemes LLM 失败 | P0 |
| EDGE-005 | decompose 空 SSOT | P0 |
| EDGE-006 | synthesize LLM 失败重试 | P1 |
| EDGE-007 | topo 拒绝「取消出图」 | P1 |
| EDGE-008 | delivery 未选满 shot | P0 |
| NEG-001 | 2a 输出 JSON-only | P0 必须 FAIL |
| NEG-002 | 2c 前 upsert | P0 必须 FAIL |
| NEG-003 | shot prose 直接 gen | P0 必须 FAIL |
| NEG-004 | 变体 prompt 合并 | P0 必须 FAIL |
| NEG-005 | v2 路径调用 plan_product_visual | P0 必须 FAIL |

### EDGE-002 资产库引用缺 role

- **Given** 资产库选图无 role=product（浏览器路径回归）
- **When** vision QA + draft
- **Then** 仍应识图 pass 或提示绑定 product role；**不应** silent 拆成 1 类型

---

## 十一、生产 Smoke（L4）

**File：** `deploy/prod-product-visual-cvs-v2-live.py`

| Case ID | 说明 | Pri |
|---------|------|-----|
| PROD-001 | CVS-02-v2 全路径至 await_delivery | P0 |
| PROD-002 | SSOT 节点存在且 prose | P0 |
| PROD-003 | shot_manifest ≥3 | P0 |
| PROD-004 | 定稿门控 shot 分组 | P1 |

---

## 十二、AC-ID → Case 映射总表

| AC-ID（规格 §七） | Case IDs |
|-------------------|----------|
| AC-P1-VISION | P1-VQA-001 |
| AC-P1-LAZY-SEED | P1-SEED-001, P1-HITL-003, CVS-02-v2 |
| AC-P2-DIALOG | P2-DRAFT-001, P2-DRAFT-004 |
| AC-P2-DUAL-OUTPUT | P2-DRAFT-002, P2-DRAFT-003 |
| AC-P2-NO-DRAFT-CANVAS | P2-NOCANVAS-001, NEG-002 |
| AC-P2-SSOT | P2-SSOT-001, P2-MACRO-003, CVS-02-v2 |
| AC-P2-MACRO | P2-MACRO-001/002, P3-DEC-001, CVS-02-v2 |
| AC-P3-SHOT-MANIFEST | P3-DEC-001, P3-DEC-004, CVS-02-v2 |
| AC-P3-SYNTH | P3-SYN-001, NEG-003 |
| AC-P3-ORCH | P3-ORCH-001, P3-ORCH-003 |
| AC-P3-SHOT-CONFIRM | P3-CONF-001, FE-SHOT-001 |
| AC-P4-SHOT-DELIVERY | P4-DEL-001/002, FE-DEL-001 |
| AC-LIMIT | P3-DEC-006, P2-MACRO-004 |

**R-* 规则覆盖：** 本文件 Case 全集覆盖规格 §三 全部 R-*（含 R-Abort-Clean → P1-HITL-002）。

---

## 十三、实现清单（executable 产物）

实现阶段按序新增：

| 产物 | 说明 |
|------|------|
| `eval-cvs-set-v2.yaml` | CVS 金标 + prose/shot fixtures |
| `tests/test_eval_cvs_set_v2.py` | L3 runner |
| `tests/test_product_visual_*_v2.py` | Phase 分文件单测 |
| `tests/fixtures/product_visual_v2/` | SSOT prose、macro_schemes、shot_manifest JSON |
| `apps/web/.../*.test.ts` | FE HITL |
| `deploy/prod-product-visual-cvs-v2-live.py` | L4 |

### 13.1 Fixture 目录结构（建议）

```
tests/fixtures/product_visual_v2/
  cvs02-ssot-scheme-a.prose.txt
  cvs02-macro-schemes.json
  cvs02-shot-manifest.json
  cvs01-ssot.prose.txt
  dialog-draft-dual-output.json
```

---

## 十四、发布门禁（Definition of Done）

- [ ] 所有 **P0** Case（约 45+）pytest/vitest **PASS**
- [ ] **NEG-*** 负向用例 CI 必跑
- [ ] `eval-cvs-set-v2.yaml` 三案例 dry-run PASS
- [ ] LEG-* legacy flag 回归 PASS
- [ ] PROD-001~003 smoke PASS（发版前）
- [ ] 规格 §七 AC-ID 均可映射到至少 1 个 PASS 用例

---

## 十五、与规格文档的同步

| 变更类型 | 更新哪份 |
|----------|----------|
| 新增业务规则 R-* | 先改 **规格 v1.1** → 再本文件补 Case |
| 新增边界/负向 | 可直接本文件 → 评审后回写规格 AC |
| CVS utterance 变更 | 同时改 `eval-cvs-set-v2.yaml` + 本文件 §八 |

**规格侧交叉引用：** 见 [2026-08-11-product-visual-phase2-scheme-ssot-design.md §七](./2026-08-11-product-visual-phase2-scheme-ssot-design.md) 末尾链接本文件。
