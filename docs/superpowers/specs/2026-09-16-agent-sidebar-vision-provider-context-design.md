# Agent 侧栏识图 Provider 契约对齐（BYOK 同一真相）— 设计规格

> 状态：**已定稿 / 实现完成（P0+P1）**；**P0.5 重试/预算/错误包收敛见同日计划**（2026-09-16）  
> 首发范围：**P0 + P1**；**P2 写入本规格、单独排期**  
> 架构方案：**方案 2 — ProviderContext 直传**（Nest 启 run 唯一 resolve；`run-vision-qa` 禁止二次猜渠道）

## 前置与修订关系

| 文档 / 变更 | 关系 |
|-------------|------|
| [2026-09-15-agent-sidebar-media-parse-design.md](./2026-09-15-agent-sidebar-media-parse-design.md) | **修订**其模型/凭证相关条款（尤其 R-MODEL）：识图必须与 Agent 对话同一 ProviderContext；解析前置、D-7、不扣点等其余决策不变 |
| [2026-07-19-byok-provider-channels-design.md](./2026-07-19-byok-provider-channels-design.md) | **遵守**：模型值唯一合法形式为 `channelId::modelName`；全模态凭证一致 |
| [2026-09-15-prompt-node-image-refs-design.md](./2026-09-15-prompt-node-image-refs-design.md) | 画布识图与 Agent 启 run **共用** resolve 辅助；不新开识图 HTTP 链 |
| PR #334（vision timeout 120s + retryable 不污染缓存） | **保留**；本规格在其上补 Provider 契约与缓存键 |

**生产根因（本规格要闭环）**：Agent 启 run 将 `resolveForGeneration` 后的**裸** `modelName` 传给 Runtime；侧栏 `parse_sidebar_media` → Nest `run-vision-qa` 再用裸名 `resolveForGeneration` → 解不出渠道 → **平台 Agnes** → free-tier 429。画布文本节点因保留完整 `channel::model` 故 BYOK 正常。

---

## 0. 决策摘要

| ID | 决策 |
|----|------|
| **D-SYNC** | 侧栏识图与 Agent 对话硬性同一 `channel::model` + 同一套凭证（BYOK→BYOK，平台→平台） |
| **D-UNSUPPORTED** | 非视觉模型 → 硬失败；提示更换 Gemini / GPT-4o / deepseek-flash 等；**不**调用平台、**不**静默降级 |
| **D-UNSUPPORTED-UX** | 有图 + 非视觉模型：**允许发送**，在解析阶段硬失败（不在选模型时禁用发送，以免挡纯文本） |
| **D-RETRY** | 仅 HTTP **429** 与 **超时** 自动重试；**N=2**（首次 + 2 次重试 ⇒ 最多 3 次尝试）；**5xx / 格式异常不重试** |
| **D-NO-PLATFORM-SWITCH** | 不提供「改用平台继续」/ `fallback_pending`（与 Studio 文本 BYOK 失败确认路径刻意区分） |
| **D-CTX** | Nest 启 run **唯一** `resolveForGeneration`；Runtime 将 `ProviderContext` 原样传给 `run-vision-qa`；Nest **禁止**再 resolve / **禁止**回落 `process.env.OPENAI_*` |
| **D-PROVIDER-REF** | `providerRef`（完整 `channelId::modelName`）为识图与对话的单一真相；裸 `model` 仅作上游 id，**禁止**作为识图唯一输入 |
| **D-POINTS** | 沿用侧栏解析 D-4：内部识图 **不扣** 文本生成积分 |
| **D-SHIP** | 首发 P0+P1；P2（公共值对象抽包、出站代理/熔断、落库观测）规格内另排期 |
| **D-CHAT-D7** | Chat / explore 不做多模态 vision（既有 D-7 不变） |
| **D-BUDGET** | 识图墙钟总预算 **180s**（含重试）；与单次 httpx 120s、最多 3 attempt 并存，以总预算为准 |

---

## 1. 目标与成功标准

### 1.1 目标

1. 堵住「BYOK 侧栏识图掉进平台免费额度」的契约洞。  
2. 失败可归因（结构化 `errorClass` + 中性用户文案）。  
3. 与画布 text/prompt 在 **resolve 入口** 对齐；不新增第三条识图链路。

### 1.2 首发成功标准（P0+P1）

1. BYOK `ch_*::deepseek-flash` 侧栏识图：`source=user`，上游为该渠道 `baseUrl`；**不得**因误走平台而出现 free-tier 429。  
2. 只传裸 model、或缺 ProviderContext → `VISION_PROVIDER_CONTEXT_INVALID`（或等价），**绝不**用 env 平台 Key 识图。  
3. 非视觉模型 + 新图 → `VISION_UNSUPPORTED`；Runtime 层可断言零上游调用。  
4. 模拟 429：可见重试（attempt），耗尽后 `VISION_RATE_LIMIT`；用户文案中性，不原样甩上游英文推销。  
5. 同一 URL 更换 `providerRef`：不命中旧失败/成功缓存。  
6. 模型选择器展示「可识图」标记（与 `supportsVisionTextModel` 同源）。  
7. 回归：无图纯文本 BYOK 对话行为不变；侧栏识图仍不扣文本积分。  
8. 画布 text 与 Agent 启 run 对同一 `providerRef` 得到相同 `source` / `baseUrl`（共用 resolve 辅助的契约测）。

---

## 2. 架构与数据流

### 2.1 目标形态

```text
Web / Agent Dock
  └─ 选择 model = providerRef (channelId::modelName)
           │
           ▼
Nest agent.service 启 run
  └─ resolveForGeneration(userId, providerRef)   【唯一 resolve】
           │
           ▼
  ProviderContext {
    providerRef,  // 完整 channel::model，永不丢弃
    model,        // 上游 model id（裸名）
    apiKey,
    baseUrl,
    source        // "user" | "platform"
  }
           │
           ├─► Runtime 对话 LLM（同一 Context）
           │
           └─► parse_sidebar_media
                    │
                    ├─ supportsVisionTextModel(model)?  --no--> VISION_UNSUPPORTED（不调 Nest）
                    │
                    └─ yes → Nest POST /agent/internal/run-vision-qa
                              body 含 ProviderContext + 既有识图字段
                                  │
                                  ▼
                              校验 Context 完整；禁止 resolveForGeneration
                              再 supportsVisionTextModel 门禁
                              generateVisionQaJson(model, apiKey, baseUrl)
                              429/超时：最多再试 2 次
```

### 2.2 组件边界

| 组件 | 职责 | 禁止 |
|------|------|------|
| Nest 启 run | 唯一 `resolveForGeneration`；下发完整 ProviderContext | 只把裸 `modelName` 当作识图唯一键 |
| Runtime | 持有并下传 Context；非视觉短路；缓存键含 providerRef | 用 `settings.openai_*` 覆盖用户 Context |
| Nest `run-vision-qa` | 内部 token 鉴权；用 body 凭证调上游；结构化 errorClass | 再 resolve；回落 `OPENAI_*`；缺字段时静默用平台 |
| Web（P1） | 可识图标注；errorClass→文案 | 静默改选平台模型；展示 apiKey |

### 2.3 `ProviderContext` 与 `run-vision-qa` DTO

**ProviderContext（逻辑字段，命名以实现为准）**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `providerRef` | string | 是 | `channelId::modelName` |
| `model` | string | 是 | 上游 model id |
| `apiKey` | string | `source=user` 时是；`platform` 时可为服务端注入 | 用户面不可见 |
| `baseUrl` | string | 是 | 上游 base URL |
| `source` | `"user" \| "platform"` | 是 | 解析来源 |

**`run-vision-qa` body（在既有 sessionId / userId / imageUrls / systemPrompt / userContent 等之上）**

- 必须携带完整 ProviderContext（或扁平等价字段）。  
- 缺任一必填 → **`VISION_PROVIDER_CONTEXT_INVALID`**，禁止回落 env。  
- `source=user` 且 apiKey 空 → **`VISION_BYOK_MISSING_KEY`**（无 fallback_pending）。  
- 旧调用方仅传裸 `model`：**拒绝**（首发破坏性契约）；须同步所有内部调用点（至少：`parse_sidebar_media`、product_visual 等走 `run_vision_qa` 的路径）。

### 2.4 非视觉双层门禁

1. **Runtime** `parse_sidebar_media`：先 `supportsVisionTextModel`；不支持则不调 Nest，写入解析失败 + `VISION_UNSUPPORTED`。  
2. **Nest** `run-vision-qa` / `generateVisionQaJson`：同逻辑再挡一道（防其它内部调用方）。  
两层同一 `errorClass`。

### 2.5 缓存

- 持久缓存键：**`url + providerRef`**（必要时尚可含 `source`）。  
- 可重试失败（429/超时）**不**写入持久 `sidebar_media_parse_cache`（沿用 #334 ephemeral 语义）。

### 2.6 安全与日志

- 鉴权：仍仅 `x-lnkpi-service-token`（内部）。  
- **apiKey 禁止**进入 SSE、AgentMessage、用户可见日志。  
- P0/P1 最小可观测（结构化日志）：`source`、`providerRef`（可脱敏）、`errorClass`、`attempt`、`latencyMs`。落库为 P2。

### 2.7 不新开链路

仍走既有 Nest `run-vision-qa` → `runVisionQaInternal` → `generateVisionQaJson` / `inlineUpstreamReferenceImages`；不在 Runtime 旁路直连 Agnes。

---

## 3. 错误码与 UX

### 3.1 `errorClass` 表

| errorClass | 何时 | 用户可见要点 | 可重试 |
|------------|------|--------------|--------|
| `VISION_UNSUPPORTED` | 非视觉模型 | 当前模型不支持识图，请更换 Gemini / GPT-4o / deepseek-flash 等 | 否 |
| `VISION_PROVIDER_CONTEXT_INVALID` | Context 缺字段 / 旧裸 model DTO | 识图凭证不完整，请重新选择模型后再试 | 否 |
| `VISION_BYOK_MISSING_KEY` | source=user 且无 apiKey | 自定义渠道未配置 API Key | 否 |
| `VISION_RATE_LIMIT` | 当前 source 上游 429（重试耗尽） | 识图请求过于频繁，请稍后再试 | 是→耗尽后否 |
| `VISION_TIMEOUT` | 超时（重试耗尽） | 识图超时，请稍后重试 | 是→耗尽后否 |
| `VISION_FETCH_FAILED` | 拉图 / inline 失败 | 参考图读取失败，请重新上传 | **否**（默认；P2 再议瞬时网络重试） |
| `VISION_UPSTREAM` | 其它 4xx/5xx、格式异常等 | 识图失败（短 reason） | **否** |
| `VISION_UNKNOWN` | 未分类 | 识图失败，请稍后重试 | 否 |

**文案规则**

- 前缀沿用：「未能根据参考图识别产品。{mapped reason}」。  
- **禁止**把上游长 JSON / HTML / 「Upgrade to a Token Plan…」等英文 raw 原样给用户；可记日志。  
- `VISION_RATE_LIMIT` 文案与 `source` 无关时保持中性（即使用户选的是平台模型）。

### 3.2 UX（P1）

- 模型选择器：每项标注是否可识图（`supportsVisionTextModel`）。  
- 有图 + 非视觉：允许发送 → 解析硬失败 + `VISION_UNSUPPORTED`（D-UNSUPPORTED-UX）。  
- 失败：停止装懂（侧栏解析 D-8）；成功：继续「根据参考图：…」。

---

## 4. 交付切片

### P0 — 契约止血（首发必做）

1. Nest 启 run 组装并下发 `ProviderContext`（保留 `providerRef`）。  
2. Runtime `resolve_vision_creds` / `parse_sidebar_media` / `nest_client.run_vision_qa` 传递完整 Context。  
3. Nest `runVisionQa` / `runVisionQaInternal`：消费 Context；**删除**对识图路径的二次 `resolveForGeneration`（或加开关后默认关，测试锁定禁止回落 env）。  
4. 双层非视觉门禁；错误码；429/超时重试 N=2。  
5. 缓存键含 `providerRef`；#334 ephemeral 保留。  
6. 结构化日志最小集；同步所有内部 `run-vision-qa` 调用点。  
7. 单测 / 集成测覆盖成功标准 1–5、7。

### P1 — 与 P0 同发

1. Web 模型选择器可识图标注。  
2. errorClass → 用户文案映射（前后端约定）。  
3. Agent 启 run 与画布 text/prompt **共用** resolve 辅助函数（仅启 run/画布侧，不是 Nest 识图再 resolve）。  
4. AC-6、AC-8。

### P2 — 规格内、单独排期

1. `@lnkpi/shared`（或约定包）抽出 Provider 值对象 / 编解码。  
2. 出站代理 / 熔断与 NO_PROXY 策略（正交可靠性）。  
3. `errorClass` / `source` / latency **落库**可观测。  
4. 评估 `VISION_FETCH_FAILED` 瞬时重试（默认仍否）。  
5. 更多调用方收敛与文档化。

---

## 5. 验收标准（首发 P0+P1）清单

| # | 标准 |
|---|------|
| AC-1 | BYOK Flash 侧栏识图走 user 渠道 baseUrl，不因契约掉平台 free-tier |
| AC-2 | 裸 model / 缺 Context → Context 无效错误，不用 env 平台 Key |
| AC-3 | 非视觉 + 新图 → UNSUPPORTED，Runtime 零上游调用 |
| AC-4 | 429 重试后 RATE_LIMIT；文案中性 |
| AC-5 | 换 providerRef 同 URL 不命中旧缓存 |
| AC-6 | 模型选择器可识图标记 |
| AC-7 | 无图 BYOK 对话回归；识图不扣文本积分 |
| AC-8 | 画布 text 与 Agent 启 run 同 providerRef → 同 source/baseUrl |

---

## 6. 非目标

- Chat / explore 多模态 vision（D-7）  
- 侧栏识图扣点  
- BYOK 失败后确认切平台（Studio fallback_pending）  
- 「有图 + 非视觉则禁用发送」  
- P2 代理熔断与落库观测的**实施**（仅排期入口）  
- 重做 product_visual `image_qa` 审核门业务语义（仅要求调用方带上 ProviderContext）

---

## 7. 测试要点（工程）

1. **契约单测**：Context 齐全 → 调用上游时 headers/baseUrl/model 来自 Context；缺字段 → 无效错误且 spy 断言未读 `OPENAI_API_KEY`。  
2. **回归**：`agent.service` 启 run 不得再只传裸 `llmModel` 作为识图来源（可保留裸 model 供上游 id，但必须同传 providerRef + 凭证）。  
3. **缓存**：同 URL 不同 providerRef 两次解析均触发上游（或第二次未读到第一次失败缓存）。  
4. **重试**：429 两次后成功 / 耗尽；500 不重试。  
5. **E2E（可选 staging）**：BYOK Flash 上传 2 图 → 「根据参考图：」且日志 `source=user`。

---

## 8. 实现注记

- JSON 字段命名（camelCase vs snake_case）随现有 Nest/Runtime 惯例。  
- Runtime 侧 Python `supports_vision_model` 必须与 Nest `@lnkpi/agent` `supportsVisionTextModel` 继续对齐（侧栏解析 D-5）。  
- 单次 attempt 超时仍归 `VISION_TIMEOUT`；与 `#334` 单次 httpx 120s 叠加时遵守 **D-BUDGET**：墙钟总预算 **180s**（含重试），耗尽即失败，即使尚未用满 3 次 attempt。  
- **P0.5：** 重试权威在 Runtime（最多 3 attempt）；Nest 识图路径 `generateVisionQaJson({ maxRetries: 0 })`，禁止 Runtime×Nest 双重 429。`nest_client.run_vision_qa` HTTP timeout 为 `min(120, remaining_budget)`。空 LLM content 视为格式异常，立即失败不重试。Nest catch 必须回 `errorClass` + 中性中文 reason。

---

## 9. 修订侧栏解析规格的条款索引（供实现对照）

对 [2026-09-15-agent-sidebar-media-parse-design.md](./2026-09-15-agent-sidebar-media-parse-design.md) 语义修订（不必改历史文件全文，以本规格为准）：

- 识图所用模型/凭证 = Agent 本轮对话 ProviderContext（D-SYNC / D-CTX）。  
- R-MODEL：禁止「对话 BYOK、识图平台」分裂。  
- 失败：增加 errorClass；保留「停止装懂」。  
- 缓存：键增加 providerRef。

---

## 10. 审批记录

| 项 | 结论 |
|----|------|
| 产品：同一真相 | A ✓ |
| 产品：非视觉 | 硬失败 ✓；允许发送后解析失败 ✓ |
| 产品：上游失败 | 429/超时重试；其余硬失败；无平台切换 ✓ |
| 架构：凭证 | ProviderContext 直传；Nest 禁止再 resolve ✓ |
| 首发范围 | P0+P1；P2 另排期 ✓ |
| 方案 | 方案 2 ✓ |
| §1–§3 审核补强 | 已并入本文 ✓ |
