# Agent 侧栏上传素材解析前置 — 设计规格

> 状态：**已评审补锁**（2026-09-15）  
> 范围：**Agent 对话本轮若有新的图片芯片，先做一次正式识图解析，再进入既有路由（问答 / 上架方案 / 出图 / 探索建节点）**  
> 前置：  
> - [2026-09-06-chat-sink-sidebar-l1-design.md](./2026-09-06-chat-sink-sidebar-l1-design.md)（**D-7 / R-CHAT-03：Chat 不做多模态 vision**）  
> - [2026-08-09-sidebar-ref-image-routing-design.md](./2026-08-09-sidebar-ref-image-routing-design.md) §9 Route Unification ADR  
> - PR #313：Nest `generateTextForRefs` / `supportsVisionTextModel` 放行 `deepseek-flash`  
> 生产动机：  
> 1. 芯片图 +「这个产品是什么？」→ 探索只读节点标题，声称读不到像素。  
> 2. 芯片图 +「请帮我设计这个产品的电商产品上架方案」→ 建了 8 模块框架，品类等全部空占位。

---

## 0. 决策摘要

| # | 决策 | 说明 |
|---|------|------|
| **D-1** | **解析是前置，不是一种用户意图** | 识图结果是后续问答/方案/出图的接地输入，不单独做成「要不要看图」澄清 |
| **D-2** | **本轮有新图片芯片就解析** | 不要求话里出现「这个产品/这张图」；同线程相同 URL 命中缓存则跳过 |
| **D-3** | **规划 LLM 仍纯文本** | 遵守既有 Chat D-7：chat / explore **不**把 `image_url` 塞进工具循环；只注入解析摘要 |
| **D-4** | **复用 Nest 内部识图，不扣文本生成积分** | 走 `runVisionQaInternal` → `generateVisionQaJson`（与 product_visual `image_qa` 同源）；禁止再走收 5 点的 `generateText` |
| **D-5** | **视觉模型判断 TS/Python 共用一套** | 以 Nest `@lnkpi/agent` 的 `supportsVisionTextModel` 为准（含 Flash）；runtime 不得在调用前用「凡 deepseek 即非视觉」短路 |
| **D-6** | **用户可见一句理解，下游拿结构化字段** | 对话先出现「根据参考图，这是…」；读不出的价格带/平台/资质保持追问，禁止编造 |
| **D-8** | **解析失败则停止装懂** | `vision_used=false` 或不可辨认：明确失败，禁止再写空品类占位方案 |
| **D-9** | **沿用既有 Chat D-7** | [2026-09-06](./2026-09-06-chat-sink-sidebar-l1-design.md) 的 **D-7 / R-CHAT-03** 不变：chat/explore 不做多模态 vision |

**非目标**

- Chat / explore 节点内接多模态 vision（推翻既有 Chat D-7）  
- 用 hint 表堆「这个产品是什么」同义词作为主修复  
- 视频/音频芯片解析（本期仅 `mediaType=image` 且 URL 非空）  
- 重做 product_visual `image_qa` 审核门（白底/清晰度）；该路径读同一缓存，避免同 URL 解两次  
- Dock 文本生成 UI（#313 已覆盖）

---

## 1. 问题陈述

### 1.1 现象与根因

| ID | 现象 | 根因 | 规格需求 |
|----|------|------|----------|
| **E1** | 「这个产品是什么？」翻画布节点字 | chat/explore 只发纯文本；芯片只进 `sidebar_attachments` 元数据 | R-PARSE-01, R-INJECT-01 |
| **E2** | 「这个产品是什么？」未进识图路径 | `suspected_vision_qa` / `media_directed_question` 不含「产品」夹在中间的问句 | R-PARSE-02（解析不依赖问句表） |
| **E3** | 上架方案框架对、产品信息空 | 探索/atomic 写节点时没有像素理解；把「读不到图」写成占位 | R-INJECT-02, R-UX-01 |
| **E4** | 选了 `deepseek-flash` 仍不能看图 | 对话规划模型 ≠ 识图调用；runtime Python 仍黑名单全部 `deepseek*` | R-MODEL-01, R-MODEL-02 |
| **E5** | 若只把图塞进 chat | 违反既有 Chat D-7；长工具循环重复送图；规划和视觉缠死 | R-BOUND-01 |

### 1.2 方案对比（已选定）

| 方案 | 做法 | 结论 |
|------|------|------|
| **A. chat/explore 直接 `image_url`** | 规划 LLM 多模态 | 否：违反既有 Chat D-7，贵、难测 |
| **B. 只补问句路由到 `vision_text`** | 「这是什么」才识图 | 否：上架方案类任务仍看不见图 |
| **C. 上传解析前置 + 摘要注入** | 新图先解析，下游纯文本消费 | ✅ 采用 |

---

## 2. 架构

```text
POST /v1/runs（attachments 含新图片 URL）
        │
        ▼
 normalize_sidebar_attachments
        │
        ▼
 resolve_sidebar_media_parse(state, attachments, llm_model)
   ├─ 过滤 mediaType=image 且 url 非空
   ├─ 去掉本 thread 已缓存 URL
   ├─ 无新 URL → 沿用缓存，跳过调用
   └─ 有新 URL → Nest run_vision_qa / parse-sidebar-media
                （supportsVisionTextModel 在 Nest 判定）
        │
        ▼
 state.sidebar_media_parse  （见 §3）
        │
        ▼
 既有 intake → decide_route → chat | explore | atomic | product_visual | …
   各节点把 parse.user_facing_summary 写入系统/用户上下文
   禁止再声称「只能看到文件/节点标题」除非 parse.vision_used=false
```

| 单元 | 职责 | 依赖 |
|------|------|------|
| `sidebar_media_parse`（runtime，新） | 触发、缓存、写入 state | attachments、thread 缓存、Nest |
| Nest `runVisionQaInternal` | 实际 `image_url` 调用；不扣点 | `generateVisionQaJson` + BYOK/平台凭证 |
| `supportsVisionTextModel`（agent TS） | 唯一视觉能力 SoT；含 Flash | #313 |
| runtime `supports_vision_model` | **改为委托 Nest 结果或同步同一规则**；禁止独立 deepseek 黑名单 | R-MODEL-02 |
| chat / explore / atomic_parse / 方案节点 | 只读摘要，不看像素 | `sidebar_media_parse` |

**挂载点锁定（R-HOOK-01）：** LangGraph `START → parse_sidebar_media → intake`。不改 `intake` 内部、不按 `flow_mode` 分支。无新图时该节点空跑（不调 Nest）。

---

## 3. 解析契约

### 3.1 触发（R-PARSE-01 / R-PARSE-02）

**触发（同时满足）：**

1. 本轮 `sidebar_attachments` 中存在至少一张 `mediaType=image` 且 `url` 非空（与 `has_sidebar_media` 同口径：空 URL 不计）。  
2. 其中至少一张 URL 不在当前 `thread_id` 的解析缓存中。

**不触发：** 仅文本芯片、仅画布节点引用且无 URL、缓存已覆盖本轮全部图片 URL。

**不要求：** utterance 含「图/产品/看看」。问句表漏检不再导致不识图。

### 3.2 缓存键

```text
LangGraph thread_id（即会话线程）+ stripped URL
```

`normalized_url` = `url.strip()`，不改写 query、不小写 host、不做 sha256（checkpoint 里本就有附件 URL）。

同一线程重复发送同一张芯片（↺ 复用本轮）不重复识图。换图（新 URL）才再解析。

多图：

- 本轮图片 URL 去重后最多送 **4** 张（超出截断，摘要注明「仅解析前 4 张」）。
- state 存两份：`sidebar_media_parse_cache: dict[stripped_url, per_image_record]`（`reset_or_merge`）；`sidebar_media_parse` 为本轮附件的合并视图。
- 合并：`user_facing_summary` 用「；」拼接各图摘要；`fields.category` 取第一段非空；`unknown` 取并集；`qa` 以本轮新解析覆盖同 URL，其余沿用缓存。

缓存只活在该 thread 的 checkpoint。新会话（新 thread_id）空缓存。不写入 Prisma / 不跨用户。

### 3.3 输出 `SidebarMediaParse`（R-UX-01）

```text
SidebarMediaParse {
  vision_used: bool
  model: string                 # 实际上游 chat 模型 id（已 decode channel）
  image_urls: string[]          # 本轮实际送去识图的 URL
  user_facing_summary: string   # 一句中文，给用户看
  fields: {
    category?: string           # 品类，不确定则省略
    appearance?: string         # 外观/形态
    material_hint?: string      # 材质线索
    text_in_image?: string      # 画面文字，没有则省略
  }
  qa: {                         # 与 product_visual VisionQA 对齐，一次调用两用
    product_summary?: string
    is_white_bg?: bool
    is_sharp_enough?: bool
    product_identifiable?: bool
  }
  unknown: string[]             # 明确读不出、留给用户的项，如 price_band / platform / certification
  error?: string                # vision_used=false 时的原因
}
```

JSON 字段由现有 vision QA parser 扩展或同一 JSON 对象增字段；`user_facing_summary` 必须来自模型对画面的描述，禁止用文件名/节点标题冒充。

**已知 vs 未知：**

| 来源 | 例子 | 处理 |
|------|------|------|
| 画面可读 | 品类、颜色、形态、包装文字 | 写入 fields + 摘要 |
| 画面通常没有 | 价格带、目标平台、资质、人群 | 列入 `unknown`，方案里保留追问 |
| 模型胡编 | 品牌/认证未在图中出现 | 禁止写入 fields；prompt 约束「未看见的不要写」 |

### 3.4 用户可见（R-UX-02）

P0 **不**新增 SSE 事件种类，也 **不**单独插一条「正在识别参考图…」历史气泡（避免污染对话）。

chat / explore / clarify 本轮**第一条** `AIMessage` 必须：

- `vision_used=true`：以 `根据参考图：{user_facing_summary}\n\n` 为前缀，再接主任务正文。
- `vision_used=false`：以 `未能根据参考图识别产品。{error}\n\n` 为前缀。

禁止：先丢一套空占位框架，再在末尾说「我看不懂图」。

### 3.5 失败（R-FAIL-01）

| 情况 | 行为 |
|------|------|
| 模型不支持视觉（如 `deepseek-v4-pro`） | `vision_used=false`；error 固定为「当前侧栏模型不支持识图。请换成 DeepSeek Flash 或 Gemini 后再问。我没有根据这张图编造产品信息。」；**不**写空方案 |
| 上游 4xx/5xx / 空内容 | 可重试 2 次（与 `runVisionQaInternal` 一致）；仍失败则 `error` 可见 |
| 图不可辨认 | `vision_used=true` 但 category 空、summary 说明看不清；允许继续出图类任务，**不允许**虚构品类写上架方案正文 |

---

## 4. 注入下游（R-INJECT-01 / R-INJECT-02）

在 chat / explore 的 system 或第一条上下文中加入固定块（非用户原话篡改）：

```text
【侧栏参考图解析】
摘要：…
品类：…（未知则写「未知，勿编造」）
请基于以上理解回答或写方案。不要声称只能看到文件名或画布节点标题。
图中未出现的价格/平台/资质不要编，改为向用户确认。
```

atomic `vision_text` 画布文本生成（收 5 点的 `generateText` / `generateTextForRefs`）：**P0 不跳过**。那是用户点名写到画布上的生成，与免费解析前置分开记账。`parse_atomic_intent` 只把解析块写入 LLM 上下文，避免再写出「看不到图」。

product_visual `image_qa_check`（P0 锁定，二选一已选定）：

- 通用解析 JSON **必须同时产出** `product_summary`、`is_white_bg`、`is_sharp_enough`、`product_identifiable`（prompt 与现有 vision QA 对齐，一次调用两用）。
- 本轮缓存命中且 `vision_used=true`：**不再**对同一 URL 集合发第二次识图 HTTP；用缓存填审核门。
- 缓存未命中、`vision_used=false`、或缺审核字段：走现有 `image_qa` 调用（允许这一次独立 HTTP）。

explore 写 prompt 节点：方案正文必须消费 `fields.category`；未知项用「待确认」而不是空白模块假装已规划完产品。

---

## 5. 模型与凭证（R-MODEL-01 / R-MODEL-02）

1. 识图模型 = 本轮 Agent 侧栏 `llm_model`（与 `resolve_llm` / `resolve_vision_creds` 同一套 BYOK）。  
2. Nest `supportsVisionTextModel` 为 SoT（已含 `deepseek-flash` 及兼容别名；`deepseek-v4-pro` 仍 false）。  
3. **R-MODEL-03：** `generateVisionQaJson` 发给上游的 `model` 必须 `decodeChannelModel`（与 `generateTextForRefs` 的 `upstreamChatModel` 相同）。今日 `runVisionQaInternal` 在 user 渠道会把 `ch_*::deepseek-flash` 原样上传，Flash 内部识图会失败。  
4. Runtime `supports_vision_model`：**同步 TS Flash 例外**（先放行 `deepseek-flash` 及别名，再套 `_NON_VISION`）。禁止 Nest 之前因 `deepseek` 子串短路。  
5. 通用解析 **只走 Nest** `run_vision_qa`（传入 §10 专用 prompt）。Python `_call_vision_http` 仅作 Nest 失败兜底，同样使用已同步的 `supports_vision_model`。  
6. 平台渠道无视觉模型时：用解析失败表（§3.5），不静默改用其它模型。  
7. **R-NEST-01：** Nest `runVisionQa` / `runVisionQaInternal` 对上游抛错须收成 `visionUsed=false` + reason，禁止把整个 Agent run 打成 500。

---

## 6. 积分与延迟

- 通用解析：**不**走 `StudioService.generateText`（5 点）。走 `runVisionQaInternal`（注释已规定 agent 内部识图不扣点）。  
- 超时：沿用内部识图 60s + 2 次重试；超时按 §3.5 失败，不阻塞成无限转圈。  
- 用户可感知：P0 靠最终回复前缀（§3.4），不新造 progress 事件。

---

## 7. 验收用例

| Case ID | 输入 | 期望 |
|---------|------|------|
| **AC-01** | 新芯片图 +「这个产品是什么？」 | 先有画面摘要；回答含可辨认品类；**不**把节点标题当产品 |
| **AC-02** | 新芯片图 +「请帮我设计这个产品的电商产品上架方案」 | 先解析；方案模块里品类/外观来自摘要；价格带/平台在 `unknown` 里追问；**无**「只能读到文件」致歉式空占位 |
| **AC-03** | ↺ 复用同一 URL 再问 | **不**第二次调用上游识图；仍能引用缓存摘要 |
| **AC-04** | 换一张新 URL | 重新解析 |
| **AC-05** | 仅文本芯片 +「这是什么」 | 不触发图片解析（保持既有 clarify/chat） |
| **AC-06** | 侧栏模型 `deepseek-flash` + 新图 | `vision_used=true`；上游 model 为 `deepseek-flash`（非 `ch_*::`） |
| **AC-07** | 侧栏模型 `deepseek-v4-pro` + 新图 | `vision_used=false`；可见失败；不写虚构品类方案 |
| **AC-08** | 无芯片闲聊「今天天气」 | 不解析、不改 chat |
| **AC-09** | chat/explore 的 LLM HTTP body | user content **无** `image_url`；可有【侧栏参考图解析】文本块 |

Eval：在 `eval-route-set` 或 runtime 单测中覆盖 AC-01/02/05/08 的 **解析触发**；视觉 HTTP 用 mock，不断真网。

---

## 8. 需求 ID 索引

| ID | 陈述 |
|----|------|
| R-PARSE-01 | 本轮新图片芯片（非空 URL）必须先解析 |
| R-PARSE-02 | 解析不依赖看图问句 / hint 表 |
| R-INJECT-01 | chat/explore/atomic 消费摘要，禁止「只能看到文件」当成功态 |
| R-INJECT-02 | 上架/方案类写节点必须填可读字段，未知项追问 |
| R-UX-01 | 摘要来自像素，不来自文件名/节点标题 |
| R-UX-02 | 用户先看到一句理解再看到主任务产出 |
| R-FAIL-01 | 识图失败或非视觉模型不得虚构品类 |
| R-MODEL-01 | 识图用本轮侧栏模型 + BYOK |
| R-MODEL-02 | 视觉能力 SoT 在 Nest；runtime 不得 deepseek 一刀切 |
| R-BOUND-01 | chat/explore 不发送 image_url |
| R-CACHE-01 | 同 thread + 同 URL 不重复识图 |
| R-BILL-01 | 通用解析不扣 generateText 5 点 |
| R-HOOK-01 | `START → parse_sidebar_media → intake` |
| R-MODEL-03 | 内部识图 HTTP 的 model 必须 decode 渠道前缀 |
| R-NEST-01 | 识图失败返回 `visionUsed=false`，不 500 整轮 run |
| R-UX-03 | 本轮首条助手消息带「根据参考图 / 未能识别」前缀 |

---

## 9. 与既有 ADR 的关系

- **保留既有 Chat D-7：** 闲聊/探索 LLM 仍然纯文本。本 spec 增加的是 **graph 前的专用识图步骤**，不是 chat 多模态。本文件 **D-8** 只约束解析失败时的装懂行为，编号不覆盖 2026-09-06 的 D-7。  
- **不替代** product_visual 白底审核；一次识图 JSON 同时服务解析摘要与审核字段（§4 P0 锁定）。  
- **不替代** #313 Dock 文本+参考图；Dock 与 Agent 内部识图共用 `supportsVisionTextModel`。  
- **不问句扩表当主修复：** 「这个产品是什么」会自然变好，是因为先解析，不是因为正则认了「产品」二字。

实现计划：[2026-09-15-agent-sidebar-media-parse.md](../plans/2026-09-15-agent-sidebar-media-parse.md)

---

## 10. 评审补锁（相对原稿的缺口）

对照当前代码（`builder.py` `START→intake`、`generateVisionQaJson` 未 decode 渠道、Python `_NON_VISION` 仍匹配全部 `deepseek*`、Nest `parseVisionQaJson` 丢弃扩展字段、chat/explore 只有纯文本 HumanMessage）补齐如下，避免实现时二选一。

| 原稿含糊处 | 锁定 |
|------------|------|
| 「graph 前或 intake 最先一步」 | **R-HOOK-01** 独立节点，intake 单测不被迫打 Nest |
| 新 Nest 接口 vs 复用 | **不新开 HTTP 路径**。复用 `POST /agent/internal/run-vision-qa`；换专用 prompt + 扩展 JSON |
| 复用电商审核 prompt？ | **否**。新建 `services/agent-runtime/skills/_shared/sidebar-media-parse/1.0.0.md`，一次输出摘要字段 **和** 现有 QA 四字段 |
| atomic「不必再识图」 | **P0 不跳过** 收点的 `generateTextForRefs`；只给 atomic parse 注入文本块 |
| 「同一条气泡或短先行句」 | **R-UX-03** 前缀拼进本轮第一条 AIMessage |
| 「正在识别参考图…」 | P0 不做 |
| 缓存 sha256 | 改为 stripped URL 字典键 |
| 多图合并 | §3.2 已写死拼接/并集规则 |
| 非视觉模型文案 | 「当前侧栏模型不支持识图。请换成 DeepSeek Flash 或 Gemini 后再问。我没有根据这张图编造产品信息。」 |
| explore 上架空框架 | `vision_used=false` 时 explore system **禁止** `add_nodes`/`upsert` 空品类方案，只口头说明失败 |
| `generateVisionQaJson` 渠道 id | **R-MODEL-03** 必须修，否则 BYOK Flash 解析仍失败 |

**上架方案走哪条路由：** 生产上「请帮我设计这个产品的电商产品上架方案」常进 **explore 写 prompt 节点**，不是 `product_visual`。注入与空方案禁令必须覆盖 **explore**，不能只改 `image_qa_check`。
