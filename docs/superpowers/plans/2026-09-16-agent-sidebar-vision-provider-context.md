# Agent 侧栏识图 ProviderContext 对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏识图与 Agent 对话使用同一 `ProviderContext`（`channel::model` + 凭证），Nest `run-vision-qa` 禁止二次 resolve，堵住 BYOK 掉进平台 free-tier 的洞；并交付 P1 可识图标注与错误文案映射。

**Architecture:** Nest 启 run 唯一 `resolveForGeneration` → 下发 `ProviderContext` 给 Runtime → `parse_sidebar_media` / `nest_client.run_vision_qa` 原样传入；Nest 识图路径只消费 body 凭证调用 `generateVisionQaJson`。缓存键改为 `url + providerRef`。P2（shared 抽包、代理熔断、落库）不在本计划实施。

**Tech Stack:** NestJS (`apps/server`)、Python agent-runtime (`uv`/`pytest`)、Vue `UniversalModelSelector`、`@lnkpi/agent` `supportsVisionTextModel`、Vitest。

**Spec:** [docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md](../specs/2026-09-16-agent-sidebar-vision-provider-context-design.md)

## Global Constraints

- **D-SYNC / D-CTX / D-PROVIDER-REF:** 识图与对话同一 Context；Nest 禁止再 `resolveForGeneration`；禁止回落 `process.env.OPENAI_*`。
- **D-UNSUPPORTED / D-UNSUPPORTED-UX:** 非视觉硬失败；有图仍可发送，解析阶段失败。
- **D-RETRY / D-BUDGET:** 仅 429 与超时重试，N=2（最多 3 attempt）；墙钟总预算 **180s**；5xx/格式异常不重试。
- **D-NO-PLATFORM-SWITCH:** 无 `fallback_pending` / 「改用平台」。
- **D-POINTS / D-CHAT-D7:** 不扣文本积分；chat/explore 不发 `image_url`。
- **终审锁定:** Context 到达 `run-vision-qa` 时 `apiKey`+`baseUrl` 必须非空；识图路径**不留**二次 resolve 生产开关；**Runtime 映射**用户可见 reason（Web 只展示）。
- **分支:** 从 `origin/main` 开 `fix/agent-sidebar-vision-provider-context`（勿写进 `feature/multi-select-layout-modes`）。规格提交 `8135c522` 可 cherry-pick。
- **测试目录:** runtime `cd services/agent-runtime && uv run pytest …`；server `pnpm --filter @lnkpi/server test …`（或仓库惯用 vitest 路径）；web `pnpm --filter @lnkpi/web test …`。

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `apps/server/src/provider/provider-context.ts` | `ProviderContext` 类型 + `buildTextProviderContext` |
| Modify: `apps/server/src/agent/agent.service.ts` | 启 run 用 helper；下发完整 Context |
| Modify: `apps/server/src/agent/agent-runtime.client.ts` | `RuntimeRunInput` + POST body 字段 |
| Modify: `apps/server/src/agent/agent.service.dock.test.ts` | 断言 `llmProviderRef` / `source` |
| Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts` | `RunVisionQaDto` 增加 Context 字段 |
| Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` | `runVisionQa` 消费 Context，不二次 resolve |
| Modify: `apps/server/src/studio/studio.service.ts` | `runVisionQaInternal` 接受显式凭证；禁止 env 回落 |
| Modify: `packages/agent/src/refs/vision-qa-json.ts` | 如需：错误分类辅助（可选，优先 Nest 包装） |
| Modify: `services/agent-runtime/app/runs.py` | `RunRequest` + `resolve_vision_creds` |
| Modify: `services/agent-runtime/app/tools/nest_client.py` | `run_vision_qa` body 带 Context |
| Modify: `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py` | 门禁、传 Context、errorClass、预算 |
| Modify: `services/agent-runtime/app/graph/sidebar_media_parse.py` | 缓存键 `url+providerRef`；错误文案映射 |
| Modify: `services/agent-runtime/app/graph/product_visual_v2/vision_qa_client.py` | 调用方带上 Context |
| Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py` | 传 Context |
| Modify: `apps/web/src/components/canvas/UniversalModelSelector.vue` | 可识图标记（text 模态） |
| Test: 见各 Task |

**内部调用点清单（须全部改完才算 P0）**

1. `parse_sidebar_media.py` → `nest.run_vision_qa`  
2. `vision_qa_client.py` → `nest.run_vision_qa`  
3. `image_qa_gate.py` → `run_vision_qa(...)`  
4. 任何测试 mock 的 `run_vision_qa` 签名  

---

### Task 1: `ProviderContext` + Nest 启 run 下发

**Files:**
- Create: `apps/server/src/provider/provider-context.ts`
- Create: `apps/server/src/provider/provider-context.test.ts`
- Modify: `apps/server/src/agent/agent.service.ts`
- Modify: `apps/server/src/agent/agent-runtime.client.ts`
- Modify: `apps/server/src/agent/agent.service.dock.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProviderSource = 'user' | 'platform'
export type ProviderContext = {
  providerRef: string
  model: string
  apiKey: string
  baseUrl: string
  source: ProviderSource
}
export async function buildTextProviderContext(
  resolver: ProviderResolverService,
  userId: string,
  providerRef: string,
): Promise<ProviderContext>
```
- `RuntimeRunInput` 增加: `llmProviderRef?: string`, `llmSource?: ProviderSource`（保留 `llmModel`/`llmApiKey`/`llmBaseUrl`）

- [ ] **Step 1: 写失败测试 — BYOK providerRef 保留渠道**

```ts
// provider-context.test.ts
it('buildTextProviderContext keeps providerRef and source=user for BYOK', async () => {
  const resolver = {
    resolveForGeneration: vi.fn().mockResolvedValue({
      channelId: 'ch_byok',
      modelName: 'deepseek-flash',
      apiFormat: 'openai',
      credentials: { apiKey: 'sk-byok', baseUrl: 'https://byok.example/v1' },
      source: 'user',
    }),
  }
  const ctx = await buildTextProviderContext(resolver as never, 'u1', 'ch_byok::deepseek-flash')
  expect(ctx).toEqual({
    providerRef: 'ch_byok::deepseek-flash',
    model: 'deepseek-flash',
    apiKey: 'sk-byok',
    baseUrl: 'https://byok.example/v1',
    source: 'user',
  })
})

it('rejects empty apiKey or baseUrl after resolve', async () => {
  const resolver = {
    resolveForGeneration: vi.fn().mockResolvedValue({
      channelId: 'platform',
      modelName: 'x',
      apiFormat: 'openai',
      credentials: { apiKey: undefined, baseUrl: '' },
      source: 'platform',
    }),
  }
  await expect(
    buildTextProviderContext(resolver as never, 'u1', 'platform::x'),
  ).rejects.toThrow(/apiKey|baseUrl|incomplete/i)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec vitest run apps/server/src/provider/provider-context.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `buildTextProviderContext`**

```ts
export async function buildTextProviderContext(
  resolver: ProviderResolverService,
  userId: string,
  providerRef: string,
): Promise<ProviderContext> {
  const ref = providerRef.trim()
  if (!ref) throw new Error('providerRef required')
  const resolved = await resolver.resolveForGeneration(userId, ref, 'text')
  const apiKey = resolved.credentials.apiKey?.trim() ?? ''
  const baseUrl = resolved.credentials.baseUrl?.trim() ?? ''
  if (!apiKey || !baseUrl) {
    throw new Error('ProviderContext incomplete: apiKey and baseUrl required')
  }
  return {
    providerRef: ref,
    model: resolved.modelName,
    apiKey,
    baseUrl,
    source: resolved.source,
  }
}
```

平台渠道必须在 resolve 时已注入 `.env` Key（既有 resolver 行为）；若仍空则抛错，**禁止**在识图路径再读 env。

- [ ] **Step 4: 改 `agent.service` + client**

```ts
// agent.service.ts — 替换裸 llmModel 赋值
const requested = model?.trim() || (await this.loadDefaultTextModel(userId))
let ctx: ProviderContext | undefined
if (requested) {
  ctx = await buildTextProviderContext(this.providerResolver, userId, requested)
}
// streamRun({
//   llmProviderRef: ctx?.providerRef,
//   llmModel: ctx?.model,
//   llmApiKey: ctx?.apiKey,
//   llmBaseUrl: ctx?.baseUrl,
//   llmSource: ctx?.source,
// })
```

```ts
// agent-runtime.client.ts POST body
llm_provider_ref: input.llmProviderRef,
llm_model: input.llmModel,
llm_api_key: input.llmApiKey,
llm_base_url: input.llmBaseUrl,
llm_source: input.llmSource,
```

- [ ] **Step 5: 更新 dock 测试断言含 `llmProviderRef: 'ch-deepseek::deepseek-v4-flash'` 与 `llmSource: 'user'`**

- [ ] **Step 6: 跑测试通过并提交**

```bash
pnpm exec vitest run apps/server/src/provider/provider-context.test.ts apps/server/src/agent/agent.service.dock.test.ts
git add apps/server/src/provider/provider-context.ts apps/server/src/provider/provider-context.test.ts \
  apps/server/src/agent/agent.service.ts apps/server/src/agent/agent-runtime.client.ts \
  apps/server/src/agent/agent.service.dock.test.ts
git commit -m "feat(agent): pass ProviderContext on runtime run start"
```

---

### Task 2: Nest `run-vision-qa` 消费 Context（禁止二次 resolve）

**Files:**
- Modify: `apps/server/src/agent/agent-canvas-tools.controller.ts` (`RunVisionQaDto`)
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` (`runVisionQa`)
- Modify: `apps/server/src/studio/studio.service.ts` (`runVisionQaInternal`)
- Test: `apps/server/src/studio/studio.integration.test.ts` 或新建 `run-vision-qa-context.test.ts`

**Interfaces:**
- Consumes: `ProviderContext` 字段（扁平进 DTO）
- Produces: `runVisionQaInternal(userId, { ..., provider: ProviderContext })` — **不再**内部 `resolveForGeneration`

- [ ] **Step 1: 写失败测试 — 缺 Context 不调用上游且不读 OPENAI_API_KEY**

```ts
it('runVisionQaInternal with incomplete provider does not call generateVisionQaJson', async () => {
  // mock generateVisionQaJson; call with missing apiKey
  // expect throw or { visionUsed: false, reason includes PROVIDER_CONTEXT / BYOK_MISSING }
  // expect generateVisionQaJson not called
})

it('runVisionQaInternal uses provider.apiKey/baseUrl/model not resolveForGeneration', async () => {
  const resolveSpy = vi.spyOn(resolver, 'resolveForGeneration')
  await studio.runVisionQaInternal('u1', {
    systemPrompt: 's',
    userContent: 'u',
    imageUrls: ['http://127.0.0.1/x.png'],
    provider: {
      providerRef: 'ch_x::deepseek-flash',
      model: 'deepseek-flash',
      apiKey: 'sk-byok',
      baseUrl: 'https://byok.example/v1',
      source: 'user',
    },
  })
  expect(resolveSpy).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: 跑测试确认失败**

- [ ] **Step 3: 扩展 DTO + service**

`RunVisionQaDto` 增加必填（对内部调用）：

```ts
@IsString() providerRef!: string
@IsString() model!: string  // 可与旧 optional model 合并：新契约下必填
@IsString() apiKey!: string
@IsString() baseUrl!: string
@IsIn(['user', 'platform']) source!: 'user' | 'platform'
```

旧仅 `model?` 的请求：校验失败 → 400 / 业务返回 `VISION_PROVIDER_CONTEXT_INVALID`（与规格「拒绝」一致；内部服务用结构化 JSON `visionUsed:false` 亦可，但 **禁止**成功路径）。

`runVisionQa`：**删除** `pickVisionQaModelFromCanvas` / `prefs.defaultTextModel` 回退作为凭证来源（画布模型选择不再覆盖 Agent 传入的 Context）。若 body 已带完整 Context，直接交给 `runVisionQaInternal`。

`runVisionQaInternal`:

```ts
async runVisionQaInternal(userId: string, params: {
  systemPrompt: string
  userContent: string
  imageUrls: string[]
  provider: ProviderContext
}): Promise<{ text: string; visionUsed: boolean }> {
  const { provider } = params
  if (!provider?.providerRef || !provider.model || !provider.apiKey || !provider.baseUrl || !provider.source) {
    return {
      text: JSON.stringify({
        pass: false,
        reason: '识图凭证不完整，请重新选择模型后再试',
        errorClass: 'VISION_PROVIDER_CONTEXT_INVALID',
        product_summary: '',
      }),
      visionUsed: false,
    }
  }
  if (provider.source === 'user' && !provider.apiKey.trim()) {
    return { text: JSON.stringify({ pass: false, reason: '…', errorClass: 'VISION_BYOK_MISSING_KEY', product_summary: '' }), visionUsed: false }
  }
  // supportsVisionTextModel(provider.model) → UNSUPPORTED
  const providerRefs = await inlineUpstreamReferenceImages(urls)
  return await generateVisionQaJson(..., {
    model: provider.model,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    maxRetries: 2, // 与 D-RETRY 对齐；总预算由 Runtime 控制更稳妥，Nest 侧保留单次调用重试
  })
}
```

**禁止**出现 `opts?.apiKey ?? process.env.OPENAI_API_KEY`。

- [ ] **Step 4: 跑测试通过并提交**

```bash
git commit -m "feat(server): run-vision-qa requires ProviderContext, no re-resolve"
```

---

### Task 3: Runtime 接收 Context 并传给 Nest

**Files:**
- Modify: `services/agent-runtime/app/runs.py`
- Modify: `services/agent-runtime/app/tools/nest_client.py`
- Modify: `services/agent-runtime/tests/test_nest_client.py`（若有）

**Interfaces:**
- `RunRequest` 增加: `llm_provider_ref`, `llm_source`
- `resolve_vision_creds` → 返回完整 dict，缺字段则空凭证（节点侧硬失败）
- `NestClient.run_vision_qa(..., provider_ref=, model=, api_key=, base_url=, source=)`

- [ ] **Step 1: 写测试 — nest_client POST body 含 providerRef/apiKey/source**

```python
@pytest.mark.asyncio
async def test_run_vision_qa_posts_provider_context(httpx_mock):
    # arrange nest base URL; call run_vision_qa with provider fields
    # assert JSON body keys: providerRef, model, apiKey, baseUrl, source
```

- [ ] **Step 2: 实现 `resolve_vision_creds`**

```python
def resolve_vision_creds(req: RunRequest) -> dict[str, str | None]:
    return {
        "provider_ref": req.llm_provider_ref,
        "model": req.llm_model,
        "api_key": req.llm_api_key,
        "base_url": req.llm_base_url,
        "source": req.llm_source,
    }
```

**删除** `or settings.openai_chat_model` / `or settings.openai_api_key` 回落（缺则由 parse 节点报 `VISION_PROVIDER_CONTEXT_INVALID`）。

- [ ] **Step 3: `nest_client.run_vision_qa` body**

```python
body = {
    "sessionId": self._session_id,
    "userId": self._user_id,
    "imageUrls": image_urls,
    "systemPrompt": system_prompt,
    "userContent": user_content,
    "providerRef": provider_ref,
    "model": model,
    "apiKey": api_key,
    "baseUrl": base_url,
    "source": source,
}
# timeout=120.0 保留 (#334)
```

- [ ] **Step 4: 跑 pytest 相关用例并提交**

```bash
cd services/agent-runtime && uv run pytest tests/test_nest_client.py -q
git commit -m "feat(runtime): forward ProviderContext to run-vision-qa"
```

---

### Task 4: `parse_sidebar_media` — 门禁、缓存键、errorClass、预算

**Files:**
- Modify: `services/agent-runtime/app/graph/sidebar_media_parse.py`
- Modify: `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py`
- Modify: `services/agent-runtime/tests/test_sidebar_media_parse.py`
- Modify: `services/agent-runtime/tests/test_parse_sidebar_media_node.py`

**Interfaces:**
- Cache key: `f"{url}||{provider_ref}"`（或 dict 嵌套；须稳定）
- `map_vision_error_class(...)` → 用户中文 reason（Runtime 为文案权威）
- 墙钟：`time.monotonic()` 总预算 180s

- [ ] **Step 1: 测试 — 同 URL 不同 providerRef 视为未缓存**

```python
def test_uncached_urls_scoped_by_provider_ref():
    cache = {"https://a||ch_a::flash": {"vision_used": True, "user_facing_summary": "x"}}
    assert uncached_urls(["https://a"], cache, provider_ref="ch_b::flash") == ["https://a"]
```

- [ ] **Step 2: 测试 — 非视觉模型不调用 nest**

```python
@pytest.mark.asyncio
async def test_parse_skips_nest_when_model_not_vision():
    nest = AsyncMock()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={"provider_ref": "ch::deepseek-v4-pro", "model": "deepseek-v4-pro", ...},
        skills_dir=...,
    )
    out = await node({...attachments...})
    nest.run_vision_qa.assert_not_called()
    assert "不支持识图" in (out["sidebar_media_parse"]["error"] or "")
```

- [ ] **Step 3: 实现缓存键 + error 映射 + 节点逻辑**

错误映射（摘录）：

| errorClass | 用户 reason |
|------------|-------------|
| `VISION_UNSUPPORTED` | 当前模型不支持识图。请换成 DeepSeek Flash 或 Gemini / GPT-4o 后再问。我没有根据这张图编造产品信息。 |
| `VISION_PROVIDER_CONTEXT_INVALID` | 识图凭证不完整，请重新选择模型后再试 |
| `VISION_BYOK_MISSING_KEY` | 自定义渠道未配置 API Key |
| `VISION_RATE_LIMIT` | 识图请求过于频繁，请稍后再试 |
| `VISION_TIMEOUT` | 识图超时，请稍后重试 |
| `VISION_FETCH_FAILED` | 参考图读取失败，请重新上传 |

从 Nest `reason` / 异常字符串分类：含 `429`/`rate limit` → RATE_LIMIT；timeout → TIMEOUT；`fetch failed`/下载失败 → FETCH_FAILED；否则 UPSTREAM。**剥离**上游英文长文，只留映射句。

重试：节点内对 RATE_LIMIT/TIMEOUT 最多再试 2 次，且 `elapsed < 180`。

- [ ] **Step 4: 跑 pytest 通过并提交**

```bash
cd services/agent-runtime && uv run pytest tests/test_sidebar_media_parse.py tests/test_parse_sidebar_media_node.py tests/test_sidebar_media_parse_ac.py -q
git commit -m "feat(runtime): sidebar parse uses ProviderContext, scoped cache, errorClass"
```

---

### Task 5: 同步 product_visual / image_qa 调用点

**Files:**
- Modify: `services/agent-runtime/app/graph/product_visual_v2/vision_qa_client.py`
- Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py`
- Modify: 相关 tests（`test_product_visual_vision_qa_v2.py`, `test_image_qa_reuses_sidebar_parse.py`）

- [ ] **Step 1: 所有 `run_vision_qa` / `nest.run_vision_qa` 传入与 `vision_creds` 相同的 Context 字段**

- [ ] **Step 2: 跑 product_visual / image_qa 相关 pytest**

```bash
cd services/agent-runtime && uv run pytest tests/test_product_visual_vision_qa_v2.py tests/test_image_qa_reuses_sidebar_parse.py -q
```

- [ ] **Step 3: 提交**

```bash
git commit -m "fix(runtime): pass ProviderContext from image_qa and vision_qa_client"
```

---

### Task 6: P1 — UniversalModelSelector 可识图标注

**Files:**
- Modify: `apps/web/src/components/canvas/UniversalModelSelector.vue`
- Create or modify: `apps/web/src/components/canvas/UniversalModelSelector.test.ts`（若已有则改）

- [ ] **Step 1: 测试 — text 模态选项含 vision hint**

对 `type="text"` 的选项，当 `supportsVisionTextModel(upstreamChatModel(id))` 为 true 时，展示「识图」标记（文案短标签即可，如 `可识图`）。

```ts
import { supportsVisionTextModel, upstreamChatModel } from '@lnkpi/agent'
// in selectableOptions map:
visionCapable: supportsVisionTextModel(upstreamChatModel(id))
```

- [ ] **Step 2: 模板中在选项旁显示标记（仅 `type==='text'`）**

- [ ] **Step 3: 跑 web 测试并提交**

```bash
pnpm exec vitest run apps/web/src/components/canvas/UniversalModelSelector.test.ts
git commit -m "feat(web): mark vision-capable text models in selector"
```

---

### Task 7: 回归总验 + 规格状态

- [ ] **Step 1: 跑关键测试套件**

```bash
pnpm exec vitest run apps/server/src/provider/provider-context.test.ts apps/server/src/agent/agent.service.dock.test.ts
cd services/agent-runtime && uv run pytest tests/test_parse_sidebar_media_node.py tests/test_sidebar_media_parse.py tests/test_nest_client.py -q
```

- [ ] **Step 2: 对照 AC-1…8 勾选**（手工记在 PR 描述）

- [ ] **Step 3: 更新规格状态为「已定稿 / 实施中」**

```bash
# docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md header
git add docs/superpowers/specs/2026-09-16-agent-sidebar-vision-provider-context-design.md
git commit -m "docs: mark vision ProviderContext spec in progress"
```

- [ ] **Step 4: PR** — 标题建议：`fix(agent): sidebar vision uses ProviderContext (BYOK same-truth)`；正文链规格 + AC 清单；注明 P2 另排期。

---

## P2 入口（本计划不实施）

见规格 §4 P2：shared 值对象、出站代理/熔断、errorClass 落库、`FETCH_FAILED` 瞬时重试评估。另开 `docs/superpowers/plans/…-p2.md` 即可。

---

## Spec coverage self-check

| Spec 项 | Task |
|---------|------|
| D-CTX / ProviderContext 直传 | T1–T3 |
| 禁止二次 resolve / env 回落 | T2 |
| 非视觉双层门禁 | T2 Nest + T4 Runtime |
| 429/超时重试 + 180s 预算 | T4（Nest generateVisionQaJson maxRetries 辅助） |
| 缓存 url+providerRef | T4 |
| errorClass 文案 Runtime 权威 | T4 |
| 调用点清单 | T5 |
| P1 选择器标注 | T6 |
| AC / PR | T7 |
| P2 | 另排期 |

## Placeholder scan

无 TBD；终审三点已写入 Global Constraints。
