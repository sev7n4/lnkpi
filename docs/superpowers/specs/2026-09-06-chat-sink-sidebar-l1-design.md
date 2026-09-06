# Chat Sink 治理与侧栏媒体参与 L1 — 设计规格

> 状态：**Implemented P0–P1**（Tasks 1–8 done，2026-09-06）
> 范围：**Chat 能力诚实 + 禁止疑似媒体意图静默落入 `default_chat` + 侧栏媒体信号参与 L0 feature/precedence + Agent≡Dock `GenerationRequest` 契约对齐（实现分 P0/P1）**  
> 前置：  
> - [2026-08-09-sidebar-ref-image-routing-design.md](./2026-08-09-sidebar-ref-image-routing-design.md) §9 Route Unification ADR（RU-3/6/7/9）  
> - [2026-08-07-platform-route-skill-boundary-design.md](./2026-08-07-platform-route-skill-boundary-design.md)  
> - [2026-08-09-atomic-intent-ir-design.md](./2026-08-09-atomic-intent-ir-design.md)  
> 生产动机：用户口述「请帮我生一个小女孩的图片」→ chat 否认出图能力并外导 Midjourney；侧栏有图时「这个图片是什么？」走纯文本 chat；改口「请帮我生成一张图」才进 atomic。

---

## 0. 决策摘要

| # | 决策 | 说明 |
|---|------|------|
| **D-1** | **低置信疑似媒体 → `clarify_route`，禁止 `default_chat`** | 产品策略选定 A：澄清（生成新图 / 解读侧栏图 / 营销方案），不静默闲聊 |
| **D-2** | **Chat 能力诚实** | 重写 `nodes/chat._SYSTEM`：不得否认平台已有出图/看图能力；禁止外导 Midjourney 等第三方作图工具 |
| **D-3** | **Feature 化，禁止 hint 扩表** | 新增/强化 `RouteFeatures`（`suspected_media_create`、`has_sidebar_media`、`suspected_vision_qa`）；**禁止**向 `ATOMIC_CREATE_HINTS` 等 permanent hint 表追加同义词 |
| **D-4** | **口语动词归一在 feature 层** | 如「生一个…图」→ `suspected_media_create`；窄模式避免误伤「生活/生意」 |
| **D-5** | **高置信直接 `atomic_create`** | 已有 IR/`intent_suggests_atomic_create` 足够时不强制澄清，减少打扰 |
| **D-6** | **本 spec 含 Dock≡Agent 契约** | 沿用并强化既有 `GenerationRequest`（`generation_request.py`，RU-9）；P0 字段同名同义，P1 共用 builder 覆盖 clarify→atomic 全路径 |
| **D-7** | **Chat 不做多模态 vision** | 看图不进 chat LLM；经 clarify / atomic / explore 正式路径 |
| **D-8** | **采用 Harness 闸门优先方案** | 相对「仅改 prompt」或「全量 LLM L0」；见 §1.1 |

**非目标**

- 全量 LLM L0 路由器  
- 本 PR 以关键词表扩容为主方案  
- Chat 节点内接 vision LLM  
- 重做营销 orchestration / Skill 边界（沿用现有 precedence）  
- Dock UI 大改（仅请求模型契约对齐）

---

## 1. 问题陈述

### 1.1 现象与根因

| ID | 现象 | 根因 | 规格需求 |
|----|------|------|----------|
| **E1** | 「生一个…图片」进 chat，否认有出图能力 | `utterance_suggests_atomic_create` 未命中口语「生」；`default_chat` 静默兜底 | R-FEAT-01, R-PREC-01 |
| **E2** | Chat 建议 Midjourney / 只推营销话术 | `chat._SYSTEM` 禁止承诺出图并导向「天猫营销方案」 | R-CHAT-01, R-CHAT-02 |
| **E3** | 侧栏有图 +「这是什么」纯文本瞎答 | Chat 只取最新 user text；侧栏未驱动 L0 离开 chat sink | R-FEAT-02, R-PREC-02, R-CHAT-03 |
| **E4** | 继续加 hint 不可持续 | 与 RU-3 / R-S9「废止 substring hint 表增长」冲突 | R-POL-01 |
| **E5** | Agent 与 Dock 成功路径不对称 | 侧栏媒体进 L1 不完整时无法稳定构造同一 `GenerationRequest` | R-ALIGN-01 |

### 1.2 方案对比（已选定）

| 方案 | 做法 | 结论 |
|------|------|------|
| **A. Harness 闸门优先** | chat 诚实 + features + precedence 禁 sink + GenerationRequest 对齐 + eval | ✅ 采用 |
| **B. 仅 Chat Prompt 止血** | 只改 `_SYSTEM` | 否：路由仍 miss，「生一个」仍进 chat |
| **C. 全量 LLM L0** | LLM 直接选 `flow_mode` | 否：违反 L0 小动作空间 ADR，难回归 |

---

## 2. 架构与组件

沿用现有 L0 管线，不新开并行路由器：

```text
utterance + RouteContext(sidebar_attachments, mentioned_keys, …)
        # mentioned_keys 与 GenerationRequest.mentioned_keys 同义（snake_case）
        │
        ▼
 extract_route_features  ──► 新增/强化 feature（见 §3）
        ▼
 resolve_atomic_intent（SoT；可读 feature；禁止再堆 hint 表）
        ▼
 apply_route_precedence
        │  插在 default_chat 之前：
        │  • 高置信 create → atomic_create
        │  • sidebar + create/edit → atomic_create（收敛既有 sidebar_img2img 等）
        │  • suspected_* 低置信 → clarify_route
        │  • 禁止：suspected_* 或（侧栏媒体 + 媒体问句）→ default_chat
        ▼
   atomic_create | clarify_route | chat | …
        │
        ├─ chat：仅真闲聊；能力诚实；无 GenerationRequest
        ├─ clarify：统一 checkpoint；回复 → clarify_resume
        └─ atomic：构造 GenerationRequest{prompt, refs, mentioned_keys, …}
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `route_features.py` | 结构化信号；动词归一 | `RouteContext` |
| `route_precedence.py` | 禁 chat sink；clarify / atomic 分流 | features + intent |
| `nodes/chat.py` | 闲聊兜底；诚实系统提示 | 纯文本 |
| `clarify_gate` / `clarify_context` | 低置信一问；≤3 选项 | 现有 checkpoint |
| `generation_request.py` | Agent ≡ Dock 请求 DTO | sidebar normalize |

---

## 3. Feature 与 Precedence 规格

### 3.1 新增 / 强化 `RouteFeatures`

| Feature | 定义 | 实现约束 |
|---------|------|----------|
| `suspected_media_create` | 口语像「要出一张媒体」但未必已过现有 atomic 高置信门槛 | **feature 层**动词归一（例：`生`+量词/「张」+「图/图片」）；**不得**仅靠往 `ATOMIC_CREATE_HINTS` 加「生一个」 |
| `has_sidebar_media` | 侧栏存在 image（及约定范围内的 video 等）可用媒体 | 可基于现有 `has_image_ref` 扩展；空 URL / 未 normalize 的附件**不计** true；trace 打点 |
| `suspected_vision_qa` | 「这是什么 / 看看这张图 / 描述一下」等看图问句 | 与 create 信号互斥优先权：同时命中时 clarify 选项同时给出「生成」与「解读」 |

既有 `has_image_ref` / `has_text_ref` **保留**；本 spec 要求 precedence **消费**侧栏媒体信号，而不仅在 img2img 特例中使用。

### 3.2 动词归一（窄规则）

- **正例：** `生一个…图片`、`生一张图`、`帮我生个海报`（+图类宾语）→ `suspected_media_create=true`  
- **负例：** `生活怎么样`、`生意很好`、`产生矛盾` → false  
- **关系：** 归一后若已满足 `intent_suggests_atomic_create` → 视为**高置信**，走 atomic，不强制 clarify  

### 3.3 Precedence 规则（语义；实现插入顺序以单测锁定）

| Rule ID | 条件 | `flow_mode` | 说明 |
|---------|------|-------------|------|
| `media_create_high` | 高置信 atomic create（含归一后够格） | `atomic_create` | 不打扰 |
| `sidebar_media_edit` | `has_sidebar_media` + 改图/参考生成信号 | `atomic_create` | 收敛既有 sidebar_img2img / ref atomic |
| `suspected_media_clarify` | `suspected_media_create` 且非高置信 | `clarify_route` | 选项：直接生成 / 营销方案（有侧栏时加「解读侧栏图」） |
| `suspected_vision_clarify` | `has_sidebar_media` + `suspected_vision_qa` | `clarify_route` 或既有 explore/看图路径 | **禁止** default_chat |
| `default_chat` | 无上述信号 | `chat` | 真闲聊 |

**硬约束 R-PREC-01：** 若 `suspected_media_create ∨ suspected_vision_qa ∨ (has_sidebar_media ∧ 媒体向问句)`，则 **`precedence_rule_id` 不得为 `default_chat`**。

### 3.4 Clarify 文案契约

- 短问、选项 ≤3。  
- 默认选项集合：`生成一张图` | `解读侧栏图片`（仅当 `has_sidebar_media`）| `做营销/详情页方案`。  
- 用户答非所问：允许再澄清一次或保守回 chat（**仍须能力诚实**），禁止编造「平台无出图能力」。  
- 回复续接走既有 `clarify_resume` / `classify_clarify_reply`，不得丢 `original_utterance` / sidebar 上下文。

---

## 4. Chat 闸门

### 4.1 系统提示重写（R-CHAT-01 / R-CHAT-02）

`services/agent-runtime/app/graph/nodes/chat.py` 的 `_SYSTEM` 须满足：

1. 简洁中文闲聊助手身份保留。  
2. **不得**声称「没有生成图片能力」或等价否认。  
3. **不得**推荐 Midjourney / Stable Diffusion 等外部作图工具作为替代。  
4. 若用户话术像出图/看图但本轮已误入 chat（双保险）：引导用户说清「生成一张图」或「看看侧栏这张图」，或提示平台可生图——**不得**只推营销方案作为唯一出路。  
5. 营销方案仍可作为**可选**能力介绍，不得作为否认出图后的唯一出口。

### 4.2 Chat 边界（R-CHAT-03）

- Chat **不**读取侧栏做 vision。  
- 理想路径上，疑似媒体意图不应到达 chat；若到达，靠 §4.1 诚实引导，并由 eval/观测暴露（见 §7）。

---

## 5. GenerationRequest 对齐（RU-9 / R-ALIGN-01）

### 5.1 契约

既有 DTO（`app/graph/generation_request.py`）：

```text
GenerationRequest {
  prompt, refs[], mentioned_keys[], modality, node_id?, slots?
}
```

| 阶段 | 要求 |
|------|------|
| **P0** | Agent atomic 成功出口与 Dock 文档化字段**同名同义**；侧栏 refs 经 normalize 写入；clarify→atomic 恢复后同样填充 |
| **P1** | 抽/强化共用 builder，侧栏 atomic 与 Dock **一条构造路径**；禁止两处手写字段映射漂移 |

### 5.2 本 spec 与既有实现关系

`GenerationRequest` 与 RU-9 已有落地；本期重点是：**不再因 chat sink 导致该契约零触发**，并保证疑似媒体经 clarify/atomic 后稳定进入同一 DTO。

---

## 6. 数据流用例

| Case | 输入 | 期望 |
|------|------|------|
| **AC-01** | `请帮我生一个小女孩的图片`（无侧栏） | 不得 `default_chat`；高置信则 `atomic_create`，否则 `clarify_route` → 可 resume 到生成 |
| **AC-02** | `请帮我生成一张图` | 回归：`atomic_create`（不强制澄清） |
| **AC-03** | 侧栏有图 + `这个图片是什么？` | 不得纯文本 chat 结束；`clarify_route` 或正式看图路径 |
| **AC-04** | 侧栏有图 + 改图/参考生成指令 | `atomic_create` + `GenerationRequest.refs` 含侧栏 |
| **AC-05** | `生活怎么样` | `chat`；不触发 `suspected_media_create` |
| **AC-06** | `帮我做一套天猫详情页营销方案` | 营销/orchestration 既有 precedence，不被本规则误抢 |
| **AC-07** | Chat 回复（若误入） | 不得含「没有生成能力」「Midjourney」等外导（golden） |

---

## 7. 分期、测试与观测

### 7.1 分期

| | P0 止血 | P1 对齐 |
|--|---------|---------|
| Chat `_SYSTEM` | 重写诚实 + 禁外导 | 文案微调 |
| Features | 三 feature + 窄动词归一 | 可并入 IR feature 字段；hint 只读 |
| Precedence | 禁 chat sink；低置信 clarify | 与 RU-7 单一 clarify 子图进一步对齐 |
| GenerationRequest | 字段同名同义 + clarify 恢复后填充 | 共用 builder 全覆盖 |
| Eval / 观测 | eval-route-set 口述+侧栏矩阵；trace 字段 | chat→用户纠错率（可选看板） |

### 7.2 测试

| 层 | 内容 |
|----|------|
| Unit | 动词归一正/负例；feature 与空附件 |
| Precedence | AC-01–06；`suspected_*` 不得 `default_chat` |
| Chat | `_SYSTEM` / 回复 golden：禁否认能力与外导 |
| Eval-route-set | 口述 paraphrase + 侧栏矩阵；无 eval 的 routing 变更不合并 |
| 契约 | `GenerationRequest` 字段快照与 Dock 对照（P0）；共用 builder（P1） |

### 7.3 观测

- Trace：`route_features` 上述 bool、`precedence_rule_id`、`flow_mode`、是否 clarify。  
- 指标：chat 后用户改口为明确生成指令的纠错率；clarify→atomic 转化。  
- 告警候选：`default_chat` 且 utterance 含媒体向表述 → 应趋近 0。

### 7.4 风险

| 风险 | 缓解 |
|------|------|
| Clarify 过多 | 高置信直接 atomic；选项 ≤3 |
| 「生」误伤 | 窄模式 + AC-05 负例 |
| 模型仍乱编 | 系统提示硬约束 + golden；疑似媒体双保险拦截 |
| 与 sidebar_img2img 重叠 | 收敛进同一 precedence，不并行第二套 |
| Dock/Agent 字段漂移 | P0 对照表；P1 单一 builder |

---

## 8. 需求 ID 索引

| ID | 陈述 |
|----|------|
| R-CHAT-01 | Chat 不得否认平台出图/看图能力 |
| R-CHAT-02 | Chat 不得外导第三方作图工具 |
| R-CHAT-03 | Chat 不做侧栏 vision；疑似看图不得静默纯文本结束 |
| R-FEAT-01 | `suspected_media_create` + 口语动词归一（非 hint 扩表） |
| R-FEAT-02 | `has_sidebar_media` / 强化消费侧栏媒体信号 |
| R-FEAT-03 | `suspected_vision_qa` |
| R-PREC-01 | 疑似媒体意图禁止 `default_chat` |
| R-PREC-02 | 低置信 → `clarify_route`（策略 A） |
| R-PREC-03 | 高置信 → `atomic_create` |
| R-ALIGN-01 | Agent ≡ Dock `GenerationRequest`（P0 字段 / P1 builder） |
| R-POL-01 | 禁止本主题以 permanent hint 扩表作为主修复 |
| R-EVAL-01 | 口述 paraphrase + 侧栏矩阵进入 eval-route-set |

---

## 9. 与既有 ADR 关系

本规格是 [sidebar-ref-image-routing §9](./2026-08-09-sidebar-ref-image-routing-design.md) 的 **chat sink / 侧栏 L1 补强**，不是 hint 扩表 PR：

- **RU-3** Feature 化 → D-3/D-4  
- **RU-6** Context 硬信号优先 → 侧栏媒体参与 L0  
- **RU-7** Clarify 一等、禁止无声断裂 → D-1  
- **RU-9** 侧栏 ≡ Dock GenerationRequest → D-6  

实现计划：本 spec 用户评审通过后，另开 `docs/superpowers/plans/2026-09-06-chat-sink-sidebar-l1.md`（writing-plans）。
