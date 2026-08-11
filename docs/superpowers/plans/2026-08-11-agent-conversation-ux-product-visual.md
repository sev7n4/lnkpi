# Agent 对话体验提升（product_visual v2）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [对话体验规格 v1.0](../specs/2026-08-11-agent-conversation-ux-product-visual-design.md) 落地 UX-PV-01～13，以 **presentation envelope（规格驱动）** 统一门控呈现，不硬编码 Vue 文案。

**Architecture:** Runtime 新增 `product_visual_v2/presentation.py` + `product_visual_copy.py` 渲染 envelope；`interrupt` SSE 携带 `presentation` 字段；Web 新增 `AgentPresentation*.vue` 按 `presentation_kind` 分发；Prompt 资产约束方案 prose 四章。P0 先改 copy/门控标签；P1 改呈现组件；P2 改 Graph 门控合并与空状态。

**Tech Stack:** LangGraph (Python 3.11+), pytest, Vue 3 + Vitest, Nest SSE proxy, Skill YAML 资产

**Spec:** [2026-08-11-agent-conversation-ux-product-visual-design.md](../specs/2026-08-11-agent-conversation-ux-product-visual-design.md)  
**前置:** [2026-08-11-product-visual-scheme-v2.md](./2026-08-11-product-visual-scheme-v2.md)（功能 v2 已合并）  
**UAT:** [2026-08-11-product-visual-phase2-scheme-ssot-uat.md](../specs/2026-08-11-product-visual-phase2-scheme-ssot-uat.md)

## Global Constraints

- 适用范围：`flow_mode: product_visual` + `product_visual_scheme_v2=true`
- **禁止** machine payload 出现在 assistant 可见正文：`__macro_scheme_decision__`、`__delivery_decision__`、裸 `shot_id` 标题、mermaid 源码（默认折叠）
- **禁止** 内部 error type 直出侧栏（如「识图模型返回格式异常」→ 映射为用户语言）
- 文案模板 **版本化** 于 Skill 资产；Python 仅读 YAML，Vue **不**写业务字符串常量（chip 标签从 envelope 读）
- 延续 [侧栏文案规范 v1](../specs/2026-08-06-agent-sidebar-copy-design.md)：`text_replace` 阶段替换；内外分离
- `max_macro_schemes_selected = 2`；SSOT A+B 须 `## 方案 A` + `## 方案 B`（已有 `build_ssot_prose`，需保证双选时两节齐全）
- Pre-PR 测试：`cd services/agent-runtime && uv run pytest tests/test_product_visual*.py tests/test_presentation*.py -v`  
  `cd apps/web && pnpm exec vitest run src/components/agent/agentInterruptGate.test.ts src/components/agent/presentation*.test.ts`

---

## 交付阶段总览

| 阶段 | 问题 ID | 里程碑 | 可独立验收 |
|------|---------|--------|------------|
| **P0** | UX-PV-01～04 | 门控文案 + 上下文 + A+B 预期 | CVS-02-AB 口语 UAT 四项 Pass |
| **P1** | UX-PV-05～09 | 呈现组件 + 进度卡 + 交付摘要 | UAT-P2/P3/P4 体验项 Pass |
| **P2** | UX-PV-10～13 | 门控合并 + 重拍续跑 + 空状态 | 硬停 ≤3 次；新用户零文档 CVS-02 |

**建议 PR 切分：** P0 → PR#1；P1 → PR#2；P2 → PR#3（Graph 变更独立，便于回滚）

---

## File Map

| File | Action | 职责 |
|------|--------|------|
| `services/agent-runtime/app/graph/product_visual_v2/presentation.py` | **Create** | envelope 构建、`presentation_kind`、stepper/context_recap |
| `services/agent-runtime/app/graph/product_visual_copy.py` | **Create** | 读 Skill YAML 模板、error type 映射、槽位填充 |
| `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml` | **Create** | 各阶段用户可见字符串（非代码） |
| `services/agent-runtime/app/graph/product_visual_v2/vision_qa.py` | Modify | QA 失败分类 → copy 键 |
| `services/agent-runtime/app/graph/nodes/image_qa_gate.py` | Modify | emit presentation + 软通过 |
| `services/agent-runtime/app/graph/nodes/macro_scheme_select_gate.py` | Modify | A+B 预期 copy |
| `services/agent-runtime/app/graph/nodes/await_topo.py` | Modify | 差异化 topo 文案 |
| `services/agent-runtime/app/graph/nodes/decompose_from_ssot.py` | Modify | shot_table envelope |
| `services/agent-runtime/app/graph/product_visual_v2/delivery.py` | Modify | done 摘要 + user_request_labels |
| `services/agent-runtime/app/graph/hitl_resume.py` | Modify | interrupt extra 含 `presentation` |
| `services/agent-runtime/app/runs.py` | Modify | thread-state 回传 presentation 字段 |
| `services/agent-runtime/app/graph/state.py` | Modify | `effective_utterance`, `user_request_labels`, `expected_delivery_count` |
| `services/agent-runtime/skills/.../prompts/dialog-draft/1.0.0.md` | Modify | §3.2 四章标题约束 |
| `services/agent-runtime/tests/test_presentation_envelope.py` | **Create** | envelope 纯函数测试 |
| `services/agent-runtime/tests/test_product_visual_qa_copy.py` | **Create** | UX-PV-01 映射测试 |
| `packages/agent/src/types.ts` | Modify | `PresentationEnvelope` 类型 |
| `apps/web/src/components/agent/presentation/types.ts` | **Create** | 与 Runtime 同构 TS 类型 |
| `apps/web/src/components/agent/presentation/AgentPresentationHost.vue` | **Create** | kind 分发器 |
| `apps/web/src/components/agent/presentation/AgentStepper.vue` | **Create** | 9 步步骤条 |
| `apps/web/src/components/agent/presentation/AgentContextRecap.vue` | **Create** | 需求摘要条 |
| `apps/web/src/components/agent/presentation/AgentTopoCardList.vue` | **Create** | 拓扑卡片列表 |
| `apps/web/src/components/agent/presentation/AgentDeliverySummaryTable.vue` | **Create** | 终局交付表 |
| `apps/web/src/components/agent/agentInterruptGate.ts` | Modify | presentation 解析、QA 选项改读 envelope |
| `apps/web/src/components/agent/AgentSideRail.vue` | Modify | 集成 Host；隐藏 machine 文本 |
| `apps/web/src/components/agent/ProductVisualDeliveryCard.vue` | Modify | user_request_labels 分组 |
| `docs/superpowers/specs/2026-08-11-product-visual-phase2-scheme-ssot-uat.md` | Modify | 增补 UX 验收项 |

---

## Phase P0 — 门控文案与上下文（UX-PV-01～04）

### Task P0-0: Presentation Envelope 基础设施

**Files:**
- Create: `services/agent-runtime/app/graph/product_visual_v2/presentation.py`
- Create: `services/agent-runtime/app/graph/product_visual_copy.py`
- Create: `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml`
- Create: `services/agent-runtime/tests/test_presentation_envelope.py`
- Modify: `services/agent-runtime/app/graph/hitl_resume.py`
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `packages/agent/src/types.ts`

**Interfaces:**
- **Produces:**
  ```python
  # presentation.py
  def build_presentation_envelope(
      *,
      kind: str,
      phase: str,
      state: dict[str, Any],
      copy: ProductVisualCopy,
  ) -> dict[str, Any]: ...

  # product_visual_copy.py
  class ProductVisualCopy:
      def get(self, key: str, **slots: str) -> str: ...
      def map_qa_failure(self, *, reason: str, vision_used: bool, metrics: dict) -> str: ...
  ```
- **Consumes:** `state["visual_intent"]`, `state["route_context"]["utterance"]`

- [ ] **Step 1: 写失败测试 — envelope 最小结构**

```python
# tests/test_presentation_envelope.py
from app.graph.product_visual_v2.presentation import build_presentation_envelope
from app.graph.product_visual_copy import ProductVisualCopy

def test_envelope_has_kind_stepper_context_recap():
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    env = build_presentation_envelope(
        kind="callout_info",
        phase="await_image_qa",
        state={"visual_intent": {"primary_goal": "巨峰葡萄礼盒"}, "route_context": {"utterance": "..."}},
        copy=copy,
    )
    assert env["kind"] == "callout_info"
    assert env["stepper"]["current"] == "image_qa"
    assert "context_recap" in env
    assert len(env["context_recap"]) <= 120
```

- [ ] **Step 2: 运行测试确认 FAIL**

Run: `cd services/agent-runtime && uv run pytest tests/test_presentation_envelope.py -v`  
Expected: FAIL `ModuleNotFoundError`

- [ ] **Step 3: 实现 presentation.py + copy loader + YAML 骨架**

`1.0.0.yaml` 至少含键：
```yaml
qa:
  service_unavailable_title: "自动识图暂时不可用"
  service_unavailable_body: "图片本身看起来可用，您可确认继续。"
  quality_fail_title: "产品图需要处理"
  confirm_use_image: "就用这张图，继续"
shot_confirm:
  primary_label: "确认构图，生成预览"
  hint: "共 {n} 个构图任务；确认后将编排出图顺序，尚未开始生成。"
topo:
  primary_label: "开始出图（约 {eta_min} 分钟）"
  hint: "方案已写入画布；确认后将生成白底、四视图及 {scene_count} 张场景图。"
macro:
  ab_hint_mixed: "已选 {k} 套风格 → 预计场景图 {p} 张。不同构图将分别采用 A/B 风格，并非每个场景各出 2 张。"
context:
  latest_utterance_note: "已按您最新描述执行；风格请在下方卡片选择，无需在话术里指定。"
```

- [ ] **Step 4: 扩展 interrupt SSE**

`hitl_resume.interrupt_event_payload` 增加可选 `presentation`；`runs.py` thread-state GET 同步返回。

- [ ] **Step 5: TS 类型**

```typescript
// packages/agent/src/types.ts — interrupt.data 扩展
export interface PresentationEnvelope {
  kind: string
  stepper?: { current: string; completed?: string[] }
  context_recap?: string
  body?: Record<string, unknown>
  primary_action?: { label: string; message: string }
  secondary_actions?: Array<{ label: string; message: string }>
}
```

- [ ] **Step 6: 测试 PASS + commit**

```bash
git add services/agent-runtime/app/graph/product_visual_v2/presentation.py \
  services/agent-runtime/app/graph/product_visual_copy.py \
  services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml \
  services/agent-runtime/tests/test_presentation_envelope.py \
  services/agent-runtime/app/graph/hitl_resume.py services/agent-runtime/app/runs.py \
  packages/agent/src/types.ts
git commit -m "feat(agent): add product_visual presentation envelope foundation"
```

---

### Task P0-1: UX-PV-01 识图 QA 文案映射

**Files:**
- Modify: `services/agent-runtime/app/graph/product_visual_v2/vision_qa.py`
- Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py`
- Create: `services/agent-runtime/tests/test_product_visual_qa_copy.py`
- Modify: `apps/web/src/components/agent/agentInterruptGate.ts`（`IMAGE_QA_OPTIONS` label 与 YAML 对齐）

**Interfaces:**
- **Produces:** `map_qa_failure() -> { kind, title, body, options[] }`
- **Consumes:** Task P0-0 `ProductVisualCopy`

- [ ] **Step 1: 失败测试 — 格式异常映射为 service_unavailable**

```python
def test_format_error_maps_to_service_unavailable_not_technical():
    from app.graph.product_visual_copy import ProductVisualCopy
    copy = ProductVisualCopy.load_from_skill("ecommerce-product-visual", "1.0.0")
    out = copy.map_qa_failure(
        reason="识图模型返回格式异常",
        vision_used=False,
        metrics={"sharpness": 0.7, "has_white_bg": False},
    )
    assert "格式异常" not in out["title"]
    assert out["kind"] == "callout_info"
    assert any(o["id"] == "confirm_pass" for o in out["options"])
    assert out["options"][0]["label"] == "就用这张图，继续"
```

- [ ] **Step 2: 实现 map_qa_failure 三分支**

| 分支 | 条件 | kind |
|------|------|------|
| `quality_fail` | vision_used 且 metrics 明确不合格 | `callout_warn` |
| `service_unavailable` | reason 含 格式异常/timeout/未调用 | `callout_info` |
| `soft_pass` | sharpness≥0.5 且非明确 fail | 无门控，单行 info |

- [ ] **Step 3: image_qa_gate 使用 envelope**

`make_await_image_qa_node` 的 `AIMessage` 仅含 `context_recap` + 友好标题；checks 进 `presentation.body.checks[]`。

- [ ] **Step 4: Web QA chip 标签**

`agentInterruptGate.ts`:
```typescript
export const IMAGE_QA_OPTIONS = [
  { id: 'confirm_pass', label: '就用这张图，继续', message: '就用这张图，继续' },
  // retake / ai_white_bg 从 copy 或 envelope.options 读
] as const
```

- [ ] **Step 5: pytest + vitest PASS + commit**

Run: `uv run pytest tests/test_product_visual_qa_copy.py tests/test_product_visual_qa.py -v`  
Run: `pnpm exec vitest run src/components/agent/agentInterruptGate.test.ts`

---

### Task P0-2: UX-PV-02 差异化门控按钮 + 步骤条

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/decompose_from_ssot.py`（shot_confirm presentation）
- Modify: `services/agent-runtime/app/graph/nodes/await_topo.py`
- Create: `apps/web/src/components/agent/presentation/AgentStepper.vue`
- Create: `apps/web/src/components/agent/presentation/AgentPresentationHost.vue`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`

**Interfaces:**
- **Produces:** `primary_action.label` 随 phase 变化；`stepper.current` ∈ spec §1 九步 ID

- [ ] **Step 1: 失败测试 — shot vs topo 按钮文案不同**

```python
def test_shot_confirm_and_topo_have_distinct_primary_labels(copy):
    shot = build_presentation_envelope(kind="shot_table", phase="await_shot_confirm", state=..., copy=copy)
    topo = build_presentation_envelope(kind="topo_card_list", phase="await_topo", state=..., copy=copy)
    assert shot["primary_action"]["label"] == "确认构图，生成预览"
    assert "开始出图" in topo["primary_action"]["label"]
    assert shot["primary_action"]["label"] != topo["primary_action"]["label"]
```

- [ ] **Step 2: Runtime 节点接入**

- `decompose_from_ssot` 结束 → `presentation.kind=shot_table`，body 含前 3 行 shot 摘要
- `await_topo` → `presentation.kind=topo_card_list`（P1 填 body；P0 先只改 label + hint）

- [ ] **Step 3: AgentSideRail 移除硬编码「确认出图」**

```vue
<!-- AgentSideRail.vue — 门控区 -->
<AgentPresentationHost
  v-if="interruptPresentation"
  :envelope="interruptPresentation"
  @primary="sendPreset($event)"
/>
<!-- 删除 await_shot_confirm / await_topo 下重复的「确认出图」button -->
```

- [ ] **Step 4: AgentStepper 渲染 completed/current**

- [ ] **Step 5: 手工验收 UX-PV-02 + commit**

---

### Task P0-3: UX-PV-03 A+B 预期与张数说明

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/macro_scheme_select_gate.py`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/presentation.py`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/manifest.py`（或 orchestrate）— `expected_delivery_count`
- Modify: `services/agent-runtime/app/graph/nodes/canvas_ssot_commit.py` — 双选时两节 SSOT
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — macro 卡片底栏 hint

**Interfaces:**
- **Produces:**
  ```python
  def compute_expected_delivery(
      selected_macro_ids: list[str],
      shots: list[dict],
      allocation_mode: str = "mixed",  # mixed | full_matrix
  ) -> dict[str, Any]:
      return {"scene_count": int, "total_finalize": int, "allocation_note": str}
  ```

- [ ] **Step 1: 失败测试 — 双选 macro 生成 ab_hint**

```python
def test_macro_select_envelope_includes_ab_expectation():
    state = {
        "macro_schemes": [{"id": "A"}, {"id": "B"}],
        "selected_macro_scheme_ids": ["A", "B"],
        "shot_manifest": [{"shot_id": "packaging_hero__1", "macro_scheme_id": "A"}, ...],
    }
    env = build_presentation_envelope(kind="macro_scheme_cards", phase="await_macro_scheme_select", state=state, copy=copy)
    assert "2 套" in env["body"]["footer_hint"] or "两套" in env["body"]["footer_hint"]
    assert env["body"]["expected_delivery_count"] >= 1
```

- [ ] **Step 2: 实现 compute_expected_delivery**

- `mixed`（当前默认）：`total_finalize = len(shots)`，`allocation_note` = copy `macro.ab_hint_mixed`
- 预留 `full_matrix` flag（规格 L1 全量，后续开关）

- [ ] **Step 3: canvas_ssot_commit 断言双节**

已有 `build_ssot_prose(sections={"A": ..., "B": ...})`；测试：双选时 `ssot_section_keys(content) == ["A", "B"]`

- [ ] **Step 4: Web macro 卡片 footer**

选中 checkbox 变化时动态更新 `footer_hint`（从 interrupt presentation 或本地计算）

- [ ] **Step 5: eval CVS-02-AB 断言 expected_delivery + commit**

Run: `uv run pytest tests/test_eval_cvs_set_v2.py -k AB -v`

---

### Task P0-4: UX-PV-04 有效需求与 context_recap

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py`
- Modify: `services/agent-runtime/app/graph/nodes/intake` 或 product_visual 入口 — 写入 `effective_utterance`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/presentation.py` — `build_context_recap`
- Create: `apps/web/src/components/agent/presentation/AgentContextRecap.vue`
- Modify: `services/agent-runtime/skills/.../prompts/dialog-draft/1.0.0.md`

**Interfaces:**
- **Produces:** `build_context_recap(state) -> str`（≤120 字，来自 `visual_intent`，非历史全文）

- [ ] **Step 1: 失败测试 — 矛盾 utterance 取最新**

```python
def test_context_recap_uses_effective_utterance_not_style_keywords():
    state = {
        "effective_utterance": "巨峰葡萄礼盒，快递防压，有人送人",
        "route_context": {"utterance": "…红金风…牛皮纸…两套都要"},
        "visual_intent": {"primary_goal": "巨峰葡萄礼盒电商视觉", "output_types_requested": ["包装", "结构", "场景"]},
    }
    recap = build_context_recap(state)
    assert "红金" not in recap
    assert "巨峰" in recap or "礼盒" in recap
```

- [ ] **Step 2: 每轮 user turn 更新 effective_utterance**

新 HumanMessage 覆盖；retake 不清空（UX-PV-12 再用）

- [ ] **Step 3: dialog-draft prompt 约束**

禁止 LLM 在「我理解您的需求」中写入用户未说的风格名（除非 utterance 含）

- [ ] **Step 4: 门控可选 callout — latest_utterance_note**

同 thread 检测到 style 关键词仅在旧 utterance 时出现时展示

- [ ] **Step 5: P0 集成验收 + commit + 更新 UAT 文档 UX 四项**

Run: `deploy/prod-product-visual-cvs-v2-live.py`（GATE_ONLY）  
手工：CVS-02-AB 口语 UAT 检查清单 UX-PV-01～04

```bash
git commit -m "feat(agent): P0 conversation UX — QA copy, gate labels, AB expectation, context recap"
```

---

## Phase P1 — 呈现组件与进度（UX-PV-05～09）

### Task P1-1: UX-PV-05 方案 prose 结构化 + 宏观卡片摘要

**Files:**
- Modify: `services/agent-runtime/skills/.../prompts/dialog-draft/1.0.0.md`
- Modify: `services/agent-runtime/app/graph/nodes/dialog_draft.py`
- Modify: `apps/web/src/components/agent/presentation/AgentPresentationHost.vue` — `prose_block` 折叠

- [ ] **Step 1: prompt 测试 — 输出含四章标题**

```python
def test_dialog_draft_prose_has_four_sections(fake_llm_output_fixture):
    for heading in ("## 我理解您的需求", "## 设计方向摘要", "## 完整方案说明", "## 接下来请您"):
        assert heading in fake_llm_output_fixture
```

- [ ] **Step 2: Web 默认只渲染前两节 +「展开完整方案」**

- [ ] **Step 3: macro_scheme_cards body：summary≤80、tags、recommend_reason 独立行**

- [ ] **Step 4: commit**

---

### Task P1-2: UX-PV-06 拓扑 topo_card_list（默认隐藏 mermaid）

**Files:**
- Create: `apps/web/src/components/agent/presentation/AgentTopoCardList.vue`
- Modify: `services/agent-runtime/app/graph/nodes/await_topo.py`
- Modify: `apps/web/src/components/agent/agentChipSet.ts` — TOPO 检测仍可用，但侧栏主视图换卡片

- [ ] **Step 1: presentation.body.nodes[] 结构**

```python
{"nodes": [{"key": "white_bg", "title": "白底主图", "category": "基础"}, ...],
 "eta_min": 5, "scene_count": 3, "credits_hint": "约 120 积分",
 "mermaid": "flowchart LR ..."  # 仅折叠区使用
}
```

- [ ] **Step 2: AgentTopoCardList — 竖排卡片 + 折叠「查看技术拓扑」**

- [ ] **Step 3: 测试 — 默认 snapshot 无 `flowchart LR` 字符串**

- [ ] **Step 4: 行点击 emit locate-node（复用现有 canvas 定位）**

---

### Task P1-3: UX-PV-07 出图 task_progress_card

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/orchestrate_shots_v2.py`（或 gen 路径）
- Modify: `services/agent-runtime/app/runs.py` — 确保 `task_list`/`task_update` 中文 title
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — 出图 banner + a/b 摘要

- [ ] **Step 1: gen 开始时 emit task_list（title = shot 中文 label）**

- [ ] **Step 2: 顶部 callout — copy key `generating.banner`**

- [ ] **Step 3: 进度行 `已完成 {done}/{total} · 正在生成：{current_title}`**

- [ ] **Step 4: 对齐 [任务进度卡规格](../specs/2026-07-25-agent-task-progress-card-design.md) 状态枚举**

Run: `uv run pytest tests/test_runs_stream.py -v`

---

### Task P1-4: UX-PV-08 定稿 delivery_cards + user_request_labels

**Files:**
- Modify: `services/agent-runtime/app/graph/state.py` — `user_request_labels: list[str]`
- Modify: `services/agent-runtime/app/graph/nodes/dialog_draft.py` 或 intent — 抽取 3 个用户语言标签
- Modify: `apps/web/src/components/agent/ProductVisualDeliveryCard.vue`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/delivery.py`

- [ ] **Step 1: 失败测试 — labels 来自 utterance**

```python
def test_user_request_labels_from_grape_utterance():
    labels = extract_user_request_labels("…礼盒好看…快递防压…有人送人")
    assert len(labels) >= 2
    assert any("礼盒" in x for x in labels)
```

- [ ] **Step 2: delivery presentation body.groups[]**

```python
{"groups": [{"label": "礼盒长什么样", "subtitle": "[方案A] 礼盒主视觉", "shot_id": "...", "recommended": true}]}
```

- [ ] **Step 3: Web 分组标题用 label；底栏「确认后将交付 N 张定稿图」**

---

### Task P1-5: UX-PV-09 终局 delivery_summary_table

**Files:**
- Create: `apps/web/src/components/agent/presentation/AgentDeliverySummaryTable.vue`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/delivery.py`
- Modify: 完成节点 AIMessage — 禁止仅「成功 5 失败 0」

- [ ] **Step 1: build_done_presentation(state) -> envelope**

```python
{
  "kind": "delivery_summary_table",
  "body": {
    "headline": "✅ 您的巨峰葡萄视觉稿已就绪",
    "finalized": [{"title": "...", "macro": "A", "node_id": "..."}],
    "basics": [{"title": "白底主图", "optional": True}],
  },
  "primary_action": {"label": "在画布中定位全部", "message": "..."},
}
```

- [ ] **Step 2: Web 渲染表 + 基础资产单独小节**

- [ ] **Step 3: P1 UAT 验收 + commit**

```bash
git commit -m "feat(agent): P1 conversation UX — presentation components, progress, delivery summary"
```

---

## Phase P2 — 门控合并与引导（UX-PV-10～13）

### Task P2-1: UX-PV-10 合并 shot + topo 门控

**Files:**
- Modify: `services/agent-runtime/app/graph/subgraphs/product_visual_gate.py`
- Create: `services/agent-runtime/app/graph/nodes/await_shot_topo_confirm.py`
- Modify: `services/agent-runtime/tests/test_graph_routes.py`

**Interfaces:**
- **Produces:** 单节点 `await_shot_topo_confirm`；`primary_action.label = "确认构图并开始出图"`

- [ ] **Step 1: feature flag `LNKPI_PV_MERGED_SHOT_TOPO_GATE=true`**

- [ ] **Step 2: 合并 presentation — shot_table + topo_card_list 同 envelope**

- [ ] **Step 3: 快速模式（可选二级 flag）**

单套 macro + QA pass + confidence≥0.8 → envelope 含 secondary「少确认，直接出图」

- [ ] **Step 4: 修订计数 — scheme_draft 展示 `还可修订 {n} 次`**

- [ ] **Step 5: 路由测试 — 默认路径硬停次数 ≤3**

```python
def test_v2_gate_count_with_merged_topo():
    # 模拟 CVS-02：image_qa(可选) + macro + merged_shot_topo + delivery = 3~4
    assert count_hard_stops("CVS-02", merged=True) <= 3
```

---

### Task P2-2: UX-PV-11 门控三段式 + 画布产出默认展开

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `apps/web/src/components/agent/presentation/AgentPresentationHost.vue`

- [ ] **Step 1: CSS/layout — recap 顶 / body 中 / action 底 sticky**

- [ ] **Step 2: 画布产出列表默认 5 项 +「展开全部 N 项」**

- [ ] **Step 3: SSOT 侧栏仅摘要 +「在画布中查看方案」**

- [ ] **Step 4: filterAssistantVisibleText() 剥离 machine payload 行**

```typescript
function filterAssistantVisibleText(content: string): string {
  return content
    .split('\n')
    .filter((line) => !line.startsWith('__macro_scheme_decision__'))
    .filter((line) => !line.startsWith('__delivery_decision__'))
    .join('\n')
    .trim()
}
```

---

### Task P2-3: UX-PV-12 重拍续跑

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py`
- Modify: `apps/web/src/components/agent/AgentSideRail.vue` — 上传完成检测

- [ ] **Step 1: retake 决策保留 effective_utterance + visual_intent**

- [ ] **Step 2: presentation secondary「继续」— message 自动带 stored utterance**

- [ ] **Step 3: Web 上传成功后显示「继续」chip；聚焦上传区 CSS class**

- [ ] **Step 4: UAT-P1-004 — 重拍无需重打话术**

---

### Task P2-4: UX-PV-13 空状态与引导

**Files:**
- Modify: `apps/web/src/components/agent/AgentSideRail.vue`
- Modify: `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml`
- Modify: macro 门控 presentation — 卡片上方 callout

- [ ] **Step 1: 技能空状态 3 条示例话术（礼盒 / Listing / 空间）可点击填入输入框**

- [ ] **Step 2: copy keys: `guidance.macro_style_in_cards`, `guidance.attachment_hint`**

- [ ] **Step 3: 新用户 E2E — 零文档完成 CVS-02 检查清单**

- [ ] **Step 4: 更新 UAT 文档 + 全量回归 + commit**

```bash
git commit -m "feat(agent): P2 conversation UX — merged gates, retake resume, empty state guidance"
```

---

## 验证矩阵（Spec → Task）

| Spec ID | Task | 自动化 | 手工 UAT |
|---------|------|--------|----------|
| UX-PV-01 | P0-1 | `test_product_visual_qa_copy.py` | UAT-P1-002 |
| UX-PV-02 | P0-2 | `test_presentation_envelope.py` | 双按钮可辨 |
| UX-PV-03 | P0-3 | `test_eval_cvs_set_v2.py -k AB` | CVS-02-AB Step 2~4 |
| UX-PV-04 | P0-4 | `build_context_recap` test | 口语无红金/牛皮纸 |
| UX-PV-05 | P1-1 | dialog-draft section test | UAT-P2-001 |
| UX-PV-06 | P1-2 | vitest snapshot | UAT-P3-003 |
| UX-PV-07 | P1-3 | `test_runs_stream.py` | 出图 a/b 可见 |
| UX-PV-08 | P1-4 | labels extract test | UAT-P4-001 |
| UX-PV-09 | P1-5 | delivery done envelope test | 5 秒列清单 |
| UX-PV-10 | P2-1 | gate count test | 硬停 ≤3 |
| UX-PV-11 | P2-2 | vitest filter test | 单屏完成决策 |
| UX-PV-12 | P2-3 | retake state test | UAT-P1-004 |
| UX-PV-13 | P2-4 | — | 新用户 CVS-02 |

**发布门槛：**
- **v2.1（P0）**：UX-PV-01～04 全 Pass → 可发生产
- **v2.2（P1）**：+ UX-PV-05～09
- **v2.3（P2）**：+ UX-PV-10～13

---

## Spec Self-Review

| 检查项 | 结果 |
|--------|------|
| 13 类问题均有 Task 映射 | ✅ §验证矩阵 |
| 无 TBD/占位 | ✅ |
| 类型一致：`PresentationEnvelope` Runtime/Web 同构 | ✅ P0-0 |
| `expected_delivery_count` 在 macro/topo/delivery/done 四处一致 | ✅ P0-3 + P1-5 |
| Graph 合并在 P2 独立 flag，P0/P1 不阻塞 | ✅ |

---

## 执行选项

Plan complete and saved to `docs/superpowers/plans/2026-08-11-agent-conversation-ux-product-visual.md`.

**两种执行方式：**

1. **Subagent-Driven（推荐）** — 按 Task P0-0 → P0-4 逐个 dispatch subagent，任务间 review  
2. **Inline Execution** — 本会话用 executing-plans 批量执行，P0 完成后 checkpoint

需要我从 **Task P0-0（Presentation Envelope 基础设施）** 开始实现吗？
