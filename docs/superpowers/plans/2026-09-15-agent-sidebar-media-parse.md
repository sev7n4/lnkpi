# Agent 侧栏上传素材解析前置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本轮有新图片芯片时，在 intake 之前做一次免费内部识图，把摘要注入 chat/explore（纯文本），让「这个产品是什么 / 上架方案」基于像素而不是节点标题。

**Architecture:** LangGraph 新节点 `parse_sidebar_media`（`START → parse → intake`）。识图复用 Nest `POST /agent/internal/run-vision-qa` + 专用 prompt；JSON 同时带解析字段与 product_visual QA 字段。chat/explore 仍不发 `image_url`。同 thread + 同 stripped URL 走 checkpoint 缓存。

**Tech Stack:** Python 3 agent-runtime（pytest / uv）、`@lnkpi/agent` Vitest、Nest `runVisionQaInternal`。

**Spec:** [docs/superpowers/specs/2026-09-15-agent-sidebar-media-parse-design.md](../specs/2026-09-15-agent-sidebar-media-parse-design.md)

## Global Constraints

- **R-BOUND-01 / Chat D-7:** chat/explore LLM body 禁止 `image_url`。
- **R-HOOK-01:** `START → parse_sidebar_media → intake`，不改 intake 内部。
- **R-BILL-01:** 解析走 `runVisionQaInternal`，禁止 `StudioService.generateText`。
- **R-MODEL-02 / R-MODEL-03:** Python 与 TS 同步 Flash 例外；上游 model 必须 `decodeChannelModel`。
- **R-NEST-01:** 识图失败返回 `visionUsed=false`，不 500 整轮 run。
- **R-UX-03:** 本轮首条 AIMessage 前缀 `根据参考图：` 或 `未能根据参考图识别产品。`。
- **P0 不跳过** 收点的 atomic `generateTextForRefs`。
- 非视觉模型 error 原文：「当前侧栏模型不支持识图。请换成 DeepSeek Flash 或 Gemini 后再问。我没有根据这张图编造产品信息。」
- 工作目录：runtime 测试 `cd services/agent-runtime && uv run pytest …`；agent 包 `pnpm --filter @lnkpi/agent test`。
- 实现须从 `origin/main` 开 `enhancement/agent-sidebar-media-parse`（不要写进 `feature/login-register-invite-legal`）。

---

## File map

| File | Responsibility |
|------|----------------|
| Modify: `packages/agent/src/refs/text-generation.ts` | export `upstreamChatModel` |
| Modify: `packages/agent/src/refs/vision-qa-json.ts` | decode 上游 model；扩展 `parseVisionQaJson` |
| Modify: `packages/agent/src/index.ts` | 如需导出新字段类型 |
| Modify: `apps/server/src/studio/studio.service.ts` | `runVisionQaInternal` 捕获上游错误 → `visionUsed=false` |
| Modify: `apps/server/src/agent/agent-canvas-tools.service.ts` | `runVisionQa` 透传扩展字段 + 捕获错误 |
| Modify: `services/agent-runtime/app/graph/product_visual_v2/vision_qa_client.py` | Flash 例外，与 TS 同规则 |
| Create: `services/agent-runtime/app/graph/sidebar_media_parse.py` | 触发、缓存、合并、格式化、前缀（无 I/O） |
| Create: `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py` | graph 节点，调 Nest |
| Create: `services/agent-runtime/skills/_shared/sidebar-media-parse/1.0.0.md` | 专用 JSON prompt |
| Modify: `services/agent-runtime/app/graph/builder.py` | START 边 |
| Modify: `services/agent-runtime/app/graph/state.py` | `sidebar_media_parse` / `sidebar_media_parse_cache` |
| Modify: `services/agent-runtime/app/graph/nodes/chat.py` | 注入块 + 前缀 |
| Modify: `services/agent-runtime/app/graph/nodes/explore.py` | 注入块 + 前缀 + 失败禁空方案 |
| Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py` | 上下文注入解析块 |
| Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py` | 缓存命中跳过二次识图 |
| Test: 见各 Task |

---

### Task 1: 视觉模型规则对齐 + 上游 decode

**Files:**
- Modify: `packages/agent/src/refs/text-generation.ts`
- Modify: `packages/agent/src/refs/vision-qa-json.ts`
- Modify: `packages/agent/src/refs/vision-qa-json.test.ts`
- Modify: `services/agent-runtime/app/graph/product_visual_v2/vision_qa_client.py`
- Test: `services/agent-runtime/tests/test_supports_vision_model.py`

**Interfaces:**
- Consumes: `decodeChannelModel`（`@lnkpi/shared`）、已有 `isDeepSeekFlashVisionModel`
- Produces: `export function upstreamChatModel(model?: string): string | undefined`；`generateVisionQaJson` HTTP `body.model` 为 decode 后 id；`supports_vision_model("deepseek-flash") is True`，`supports_vision_model("deepseek-v4-pro") is False`

- [ ] **Step 1: Write the failing tests**

Append to `packages/agent/src/refs/vision-qa-json.test.ts`:

```ts
it('decodes channel-prefixed Flash before posting model', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '{"pass":true,"reason":"ok","product_summary":"桶"}' } }],
    }),
  })
  vi.stubGlobal('fetch', fetchMock)
  const result = await generateVisionQaJson('sys', 'user', ['https://example.com/a.jpg'], {
    apiKey: 'k',
    model: 'ch_x::deepseek-flash',
  })
  expect(result.visionUsed).toBe(true)
  const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
  expect(body.model).toBe('deepseek-flash')
})
```

Create `services/agent-runtime/tests/test_supports_vision_model.py`:

```python
from app.graph.product_visual_v2.vision_qa_client import supports_vision_model


def test_flash_aliases_are_vision():
    assert supports_vision_model("deepseek-flash") is True
    assert supports_vision_model("ch_x::deepseek-flash") is True
    assert supports_vision_model("deepseek-v4-flash") is True
    assert supports_vision_model("deepseek-v4.1-flash") is True
    assert supports_vision_model("deepseek-v4-flash-vision-exp") is True


def test_deepseek_pro_is_not_vision():
    assert supports_vision_model("deepseek-v4-pro") is False
    assert supports_vision_model("ch_x::deepseek-v3.2") is False


def test_gemini_still_vision():
    assert supports_vision_model("gemini-3.5-flash-lite") is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @lnkpi/agent test -- src/refs/vision-qa-json.test.ts`  
Expected: FAIL（`body.model` 仍为 `ch_x::deepseek-flash`）

Run: `cd services/agent-runtime && uv run pytest tests/test_supports_vision_model.py -v`  
Expected: FAIL（`deepseek-flash` 为 False）

- [ ] **Step 3: Minimal implementation**

In `text-generation.ts`, export existing `upstreamChatModel`.

In `vision-qa-json.ts`, after resolving `model`:

```ts
import { supportsVisionTextModel, upstreamChatModel } from './text-generation'

const model = upstreamChatModel(opts.model ?? process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o')
```

`supportsVisionTextModel` 仍用原始 `opts.model`（渠道编码 Flash 已放行）；**HTTP body 只用 decode 后的 id**。

In `vision_qa_client.py`, copy TS Flash regex **before** `_NON_VISION`:

```python
_DEEPSEEK_FLASH = re.compile(
    r"(?:^|[/:])deepseek(?:-v4(?:\.1)?)?-flash(?:-vision-exp)?(?:[-./]|$)",
    re.I,
)

def supports_vision_model(model: str | None) -> bool:
    if not model or not str(model).strip():
        return False
    m = str(model).strip()
    if _DEEPSEEK_FLASH.search(m):
        return True
    if _NON_VISION.search(m):
        return False
    return bool(_VISION_MODEL.search(m))
```

- [ ] **Step 4: Run tests to verify they pass**

Same commands as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/refs/text-generation.ts packages/agent/src/refs/vision-qa-json.ts packages/agent/src/refs/vision-qa-json.test.ts services/agent-runtime/app/graph/product_visual_v2/vision_qa_client.py services/agent-runtime/tests/test_supports_vision_model.py
git commit -m "$(cat <<'EOF'
fix: allow DeepSeek Flash on internal vision QA path

Python no longer blacklists all deepseek* models; Nest posts decoded upstream ids.
EOF
)"
```

---

### Task 2: 扩展识图 JSON + Nest 失败降级

**Files:**
- Modify: `packages/agent/src/refs/vision-qa-json.ts`
- Modify: `packages/agent/src/refs/vision-qa-json.test.ts`（可新建 `parseVisionQaJson` describe）
- Modify: `apps/server/src/agent/agent-canvas-tools.service.ts`（`parseVisionQaResponse`、`runVisionQa`）
- Modify: `apps/server/src/studio/studio.service.ts`（`runVisionQaInternal` try/catch）

**Interfaces:**
- Consumes: 现有 `parseVisionQaJson`
- Produces: `ParsedVisionQaJson` 增加可选 `userFacingSummary`、`category`、`appearance`、`materialHint`、`textInImage`、`unknown: string[]`；`runVisionQa` 原样透传；上游 throw → `{ visionUsed: false, reason }`

- [ ] **Step 1: Write the failing test**

Add in `vision-qa-json.test.ts` (import `parseVisionQaJson`):

```ts
import { generateVisionQaJson, parseVisionQaJson } from './vision-qa-json'

it('parses sidebar parse fields from QA json', () => {
  const parsed = parseVisionQaJson(
    JSON.stringify({
      pass: true,
      reason: '清晰白底',
      product_summary: '不锈钢水杯',
      user_facing_summary: '一只带提手的不锈钢水杯',
      category: '水杯',
      appearance: '银白圆柱，塑料提手',
      material_hint: '不锈钢',
      text_in_image: '',
      unknown: ['price_band', 'platform'],
      is_white_bg: true,
      is_sharp_enough: true,
      product_identifiable: true,
    }),
  )
  expect(parsed.userFacingSummary).toBe('一只带提手的不锈钢水杯')
  expect(parsed.category).toBe('水杯')
  expect(parsed.unknown).toEqual(['price_band', 'platform'])
  expect(parsed.isWhiteBg).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lnkpi/agent test -- src/refs/vision-qa-json.test.ts`  
Expected: FAIL（字段 undefined）

- [ ] **Step 3: Minimal implementation**

Extend `ParsedVisionQaJson` and `parseVisionQaJson` to read snake_case / camelCase 同现有 `product_summary` 风格。`unknown` 只保留 `string[]`。

`userFacingSummary` 若空则回落 `productSummary`。

`runVisionQaInternal`:

```ts
try {
  return await generateVisionQaJson(...)
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err)
  return {
    text: JSON.stringify({ pass: false, reason, product_summary: '' }),
    visionUsed: false,
  }
}
```

`parseVisionQaResponse` / `runVisionQa` return type 增加上述可选字段。

- [ ] **Step 4: Run tests to verify they pass**

Same vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/refs/vision-qa-json.ts packages/agent/src/refs/vision-qa-json.test.ts apps/server/src/studio/studio.service.ts apps/server/src/agent/agent-canvas-tools.service.ts
git commit -m "$(cat <<'EOF'
feat: extend vision QA JSON for sidebar parse fields

Internal vision failures return visionUsed=false instead of failing the run.
EOF
)"
```

---

### Task 3: 纯函数 — 触发、缓存、合并、文案

**Files:**
- Create: `services/agent-runtime/app/graph/sidebar_media_parse.py`
- Test: `services/agent-runtime/tests/test_sidebar_media_parse.py`

**Interfaces:**
- Consumes: `image_urls_from_state` 口径（`mediaType=image` 且 url strip 非空）；`reset_or_merge` 稍后在 state 使用
- Produces:
  - `MAX_PARSE_IMAGE_URLS = 4`
  - `NON_VISION_PARSE_ERROR = "当前侧栏模型不支持识图。请换成 DeepSeek Flash 或 Gemini 后再问。我没有根据这张图编造产品信息。"`
  - `image_urls_for_parse(attachments: list) -> list[str]`
  - `uncached_urls(urls: list[str], cache: dict | None) -> list[str]`
  - `merge_parse_records(urls: list[str], cache: dict) -> dict`
  - `format_parse_context_block(parse: dict) -> str`
  - `prefix_assistant_reply(reply: str, parse: dict | None) -> str`

- [ ] **Step 1: Write the failing test**

```python
from app.graph.sidebar_media_parse import (
    NON_VISION_PARSE_ERROR,
    image_urls_for_parse,
    merge_parse_records,
    prefix_assistant_reply,
    uncached_urls,
    format_parse_context_block,
)


def test_skips_text_and_empty_url():
    urls = image_urls_for_parse(
        [
            {"mediaType": "text", "text": "hi"},
            {"mediaType": "image", "url": ""},
            {"mediaType": "image", "url": " https://cdn.example/a.jpg "},
        ]
    )
    assert urls == ["https://cdn.example/a.jpg"]


def test_caps_at_four():
    atts = [{"mediaType": "image", "url": f"https://x/{i}.jpg"} for i in range(6)]
    assert len(image_urls_for_parse(atts)) == 4


def test_uncached_skips_known():
    assert uncached_urls(
        ["https://a", "https://b"],
        {"https://a": {"vision_used": True}},
    ) == ["https://b"]


def test_merge_joins_summaries():
    cache = {
        "https://a": {"user_facing_summary": "红桶", "fields": {"category": "水桶"}, "unknown": ["platform"]},
        "https://b": {"user_facing_summary": "木盖", "fields": {}, "unknown": ["price_band"]},
    }
    merged = merge_parse_records(["https://a", "https://b"], cache)
    assert "红桶" in merged["user_facing_summary"]
    assert "木盖" in merged["user_facing_summary"]
    assert merged["fields"]["category"] == "水桶"
    assert set(merged["unknown"]) == {"platform", "price_band"}


def test_prefix_success_and_failure():
    ok = prefix_assistant_reply("这是水杯。", {"vision_used": True, "user_facing_summary": "不锈钢水杯"})
    assert ok.startswith("根据参考图：不锈钢水杯")
    bad = prefix_assistant_reply("你好", {"vision_used": False, "error": NON_VISION_PARSE_ERROR})
    assert bad.startswith("未能根据参考图识别产品。")
    assert NON_VISION_PARSE_ERROR in bad


def test_context_block_forbids_filename_copout():
    block = format_parse_context_block(
        {"user_facing_summary": "不锈钢水杯", "fields": {"category": "水杯"}, "unknown": ["price_band"]}
    )
    assert "【侧栏参考图解析】" in block
    assert "不要声称只能看到文件名" in block
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_sidebar_media_parse.py -v`  
Expected: FAIL（`ModuleNotFoundError`）

- [ ] **Step 3: Minimal implementation**

Implement the functions in `sidebar_media_parse.py`. `format_parse_context_block` 固定包含 spec §4 中文约束（未知勿编造、价格/平台追问）。`prefix_assistant_reply` 在 `parse is None` 时原样返回。成功前缀已存在则不要重复拼接。

- [ ] **Step 4: Run tests to verify they pass**

Same pytest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/sidebar_media_parse.py services/agent-runtime/tests/test_sidebar_media_parse.py
git commit -m "$(cat <<'EOF'
feat: add sidebar media parse pure helpers

Trigger, cache skip, merge, and user-visible reply prefix without I/O.
EOF
)"
```

---

### Task 4: 专用 prompt + graph 节点

**Files:**
- Create: `services/agent-runtime/skills/_shared/sidebar-media-parse/1.0.0.md`
- Create: `services/agent-runtime/app/graph/nodes/parse_sidebar_media.py`
- Modify: `services/agent-runtime/app/graph/state.py`（增加 `sidebar_media_parse: dict | None`、`sidebar_media_parse_cache: Annotated[dict | None, reset_or_merge]`）
- Test: `services/agent-runtime/tests/test_parse_sidebar_media_node.py`

**Interfaces:**
- Consumes: `uncached_urls`、`merge_parse_records`、`nest.run_vision_qa`、`vision_creds`
- Produces: `make_parse_sidebar_media_node(*, nest, vision_creds, skills_dir) -> node`；state 写入 `sidebar_media_parse` 与 cache

Prompt 文件正文必须要求 **只输出 JSON**，字段同时包含：

```json
{
  "pass": true,
  "reason": "",
  "product_summary": "",
  "user_facing_summary": "",
  "category": "",
  "appearance": "",
  "material_hint": "",
  "text_in_image": "",
  "unknown": ["price_band", "platform", "certification"],
  "is_white_bg": true,
  "is_sharp_enough": true,
  "product_identifiable": true
}
```

约束：没看见的品牌/价格/平台不要写进 category；`unknown` 列出读不出的项。

- [ ] **Step 1: Write the failing test**

```python
from app.graph.nodes.parse_sidebar_media import make_parse_sidebar_media_node
from app.graph.sidebar_media_parse import NON_VISION_PARSE_ERROR


class _Nest:
    def __init__(self):
        self.calls = []

    async def run_vision_qa(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "pass": True,
            "reason": "ok",
            "visionUsed": True,
            "productSummary": "不锈钢水杯",
            "userFacingSummary": "一只不锈钢水杯",
            "category": "水杯",
            "appearance": "银白",
            "isWhiteBg": True,
            "isSharpEnough": True,
            "productIdentifiable": True,
            "unknown": ["price_band"],
        }


async def test_parses_new_image_and_skips_second_call():
    nest = _Nest()
    node = make_parse_sidebar_media_node(
        nest=nest,
        vision_creds={"model": "deepseek-flash"},
        skills_dir=".",
    )
    att = [{"mediaType": "image", "url": "https://cdn.example/p.jpg"}]
    first = await node({"sidebar_attachments": att})
    assert first["sidebar_media_parse"]["vision_used"] is True
    assert first["sidebar_media_parse"]["fields"]["category"] == "水杯"
    assert len(nest.calls) == 1
    second = await node(
        {
            "sidebar_attachments": att,
            "sidebar_media_parse_cache": first["sidebar_media_parse_cache"],
        }
    )
    assert len(nest.calls) == 1
    assert second["sidebar_media_parse"]["fields"]["category"] == "水杯"


async def test_no_image_does_not_call_nest():
    nest = _Nest()
    node = make_parse_sidebar_media_node(nest=nest, vision_creds={}, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "text", "text": "hi"}]})
    assert nest.calls == []
    assert not out.get("sidebar_media_parse")


async def test_nest_error_becomes_vision_false(monkeypatch):
    class Boom:
        async def run_vision_qa(self, **kwargs):
            raise RuntimeError("upstream 500")

    node = make_parse_sidebar_media_node(nest=Boom(), vision_creds={"model": "gpt-4o"}, skills_dir=".")
    out = await node({"sidebar_attachments": [{"mediaType": "image", "url": "https://x/a.jpg"}]})
    assert out["sidebar_media_parse"]["vision_used"] is False
    assert out["sidebar_media_parse"]["error"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_parse_sidebar_media_node.py -v`  
Expected: FAIL（import error）

- [ ] **Step 3: Minimal implementation**

Node 逻辑：

1. `urls = image_urls_for_parse(state["sidebar_attachments"])`；空则 `return {}`。
2. `need = uncached_urls(urls, state.get("sidebar_media_parse_cache"))`；空则 merge 已有 cache 写入 `sidebar_media_parse`，不调 Nest。
3. 读 prompt 文件；`user_content` 带用户最新一句话（若有）+ 图数量。
4. `await nest.run_vision_qa(..., system_prompt=..., user_content=..., image_urls=need, model=vision_creds["model"])`。
5. 映射到 per-url cache（多图一次调用则每 URL 共享同一份 fields，`image_urls` 记录实际发送列表）。
6. Nest 异常或 `visionUsed=false`：写入 `error`（非视觉模型用 `NON_VISION_PARSE_ERROR`）。
7. **禁止**调用 `run_text_generation` / `generateText`。

Prompt 路径：`skills_dir.parent / "_shared/sidebar-media-parse/1.0.0.md"` 若 `skills_dir` 已是 `skills/`；实现时用 `Path(skills_dir).resolve().parent` 仅当 skills_dir 指向某 skill。更稳：相对 runtime 包根 `Path(__file__).resolve().parents[2] / "skills/_shared/sidebar-media-parse/1.0.0.md"`（`nodes/` 上两级是 `app/`，再上是 runtime 根 → `parents[3]`）。锁定：

```python
_PROMPT = Path(__file__).resolve().parents[3] / "skills/_shared/sidebar-media-parse/1.0.0.md"
```

`make_parse_sidebar_media_node` 的 `skills_dir` 可忽略，避免路径分叉（参数保留以匹配 builder 签名）。

- [ ] **Step 4: Run tests to verify they pass**

Same pytest. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/skills/_shared/sidebar-media-parse/1.0.0.md services/agent-runtime/app/graph/nodes/parse_sidebar_media.py services/agent-runtime/app/graph/state.py services/agent-runtime/tests/test_parse_sidebar_media_node.py
git commit -m "$(cat <<'EOF'
feat: parse sidebar images before intake

Adds a LangGraph node that caches Nest vision QA per image URL.
EOF
)"
```

---

### Task 5: 挂到 graph START

**Files:**
- Modify: `services/agent-runtime/app/graph/builder.py`
- Test: `services/agent-runtime/tests/test_parse_sidebar_media_graph.py`

**Interfaces:**
- Consumes: `make_parse_sidebar_media_node`、现有 `build_agent_graph(..., vision_creds=)`
- Produces: `START → parse_sidebar_media → intake`

- [ ] **Step 1: Write the failing test**

```python
from app.graph.builder import build_agent_graph


class _Nest:
    async def close(self):
        pass


class _Llm:
    async def ainvoke(self, messages):
        class R:
            content = "ok"
        return R()


def test_start_edges_include_parse_node():
    g = build_agent_graph(nest=_Nest(), llm=_Llm(), skills_dir=".")
    names = set(g.get_graph().nodes)
    assert "parse_sidebar_media" in names
```

若 `get_graph().nodes` 在当前 langgraph 版本不含自定义名，改断言 compiled graph 的 `nodes` 字典：`assert "parse_sidebar_media" in g.nodes`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && uv run pytest tests/test_parse_sidebar_media_graph.py -v`  
Expected: FAIL

- [ ] **Step 3: Minimal implementation**

```python
graph.add_node(
    "parse_sidebar_media",
    make_parse_sidebar_media_node(nest=nest, vision_creds=vision_creds, skills_dir=skills_path),
)
graph.add_edge(START, "parse_sidebar_media")
graph.add_edge("parse_sidebar_media", "intake")
# 删除 graph.add_edge(START, "intake")
```

- [ ] **Step 4: Run tests to verify they pass**

Same pytest + `uv run pytest tests/test_clarify_gate_unified.py tests/test_intake_gate.py -q` 确认 intake 直测仍绿。Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/builder.py services/agent-runtime/tests/test_parse_sidebar_media_graph.py
git commit -m "$(cat <<'EOF'
feat: run sidebar image parse before intake

Keeps chat/explore text-only while grounding later nodes on pixels.
EOF
)"
```

---

### Task 6: chat / explore 注入与回复前缀

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/chat.py`
- Modify: `services/agent-runtime/app/graph/nodes/explore.py`
- Modify: `services/agent-runtime/tests/test_chat_system_prompt.py`
- Test: `services/agent-runtime/tests/test_chat_sidebar_parse_inject.py`
- Test: `services/agent-runtime/tests/test_explore_sidebar_parse_inject.py`

**Interfaces:**
- Consumes: `format_parse_context_block`、`prefix_assistant_reply`
- Produces: HumanMessage 为纯字符串（可含【侧栏参考图解析】，**无** `image_url`）；AIMessage 带 R-UX-03 前缀；explore 在 `vision_used=false` 时禁止空品类建节点

- [ ] **Step 1: Write the failing tests**

`test_chat_sidebar_parse_inject.py`：mock `llm.ainvoke`，断言 messages[0] system 或 messages[1] human 含 `【侧栏参考图解析】`，human content 为 `str`，`'image_url' not in repr(messages)`；返回的 AIMessage 以 `根据参考图：` 开头。

`test_explore_sidebar_parse_inject.py`：同样断言 bind_tools 前的 system 含解析块；`vision_used=false` 时 system 含「禁止创建空品类上架方案」。

`test_chat_system_prompt.py`：`_SYSTEM` 增加「若已提供【侧栏参考图解析】，不得声称只能看到文件名或画布节点标题」。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/agent-runtime && uv run pytest tests/test_chat_sidebar_parse_inject.py tests/test_explore_sidebar_parse_inject.py tests/test_chat_system_prompt.py -v`  
Expected: FAIL

- [ ] **Step 3: Minimal implementation**

chat：

```python
from app.graph.sidebar_media_parse import format_parse_context_block, prefix_assistant_reply

parse = state.get("sidebar_media_parse")
sys = _SYSTEM
if parse:
    sys = _SYSTEM + "\n\n" + format_parse_context_block(parse)
# HumanMessage 仍是最新用户纯文本，解析块放 System（避免篡改用户原话）
ai = await llm.ainvoke([SystemMessage(content=sys), HumanMessage(content=text)])
reply = prefix_assistant_reply(str(getattr(ai, "content", "") or ""), parse)
```

explore：`system_content` 追加同一 block；若 `parse and not parse.get("vision_used")` 再追加：

```text
4. 参考图未能识别。禁止 add_nodes / 更新 prompt 写出空品类、空规格的上架方案框架；用文字说明失败并询问用户。
```

最终 `AIMessage(content=prefix_assistant_reply(final_reply, parse))`。mandatory explore 同样加前缀。

- [ ] **Step 4: Run tests to verify they pass**

Same pytest. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/chat.py services/agent-runtime/app/graph/nodes/explore.py services/agent-runtime/tests/test_chat_system_prompt.py services/agent-runtime/tests/test_chat_sidebar_parse_inject.py services/agent-runtime/tests/test_explore_sidebar_parse_inject.py
git commit -m "$(cat <<'EOF'
feat: ground chat and explore on sidebar image parse

Injects pixel summary as text and prefixes the first assistant reply.
EOF
)"
```

---

### Task 7: atomic 上下文 + product_visual 缓存复用

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/atomic_parse.py`（`build_atomic_parse_context` 调用处或 packet 文本）
- Modify: `services/agent-runtime/app/graph/nodes/image_qa_gate.py`
- Test: `services/agent-runtime/tests/test_atomic_sidebar_parse_context.py`
- Test: `services/agent-runtime/tests/test_image_qa_reuses_sidebar_parse.py`

**Interfaces:**
- Consumes: `format_parse_context_block`；`sidebar_media_parse.qa` / cache
- Produces: atomic LLM 上下文含解析块；`image_qa_check` 在 URL 集合被 cache 覆盖且 `vision_used` 与 QA 四字段齐全时 **不**调用 `run_vision_qa`

- [ ] **Step 1: Write the failing tests**

atomic：构造带 `sidebar_media_parse` 的 state，断言送给 parse LLM 的 user/system 字符串含 `【侧栏参考图解析】`。

image_qa：Fake nest `run_vision_qa` 计数；state 已有 cache + 相同 url + qa 四字段 → 调用 `_run_qa_check` 后 `run_vision_qa` 次数为 0，且 `product_summary` 来自 cache。缺 `is_white_bg` 时必须再调用。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/agent-runtime && uv run pytest tests/test_atomic_sidebar_parse_context.py tests/test_image_qa_reuses_sidebar_parse.py -v`  
Expected: FAIL

- [ ] **Step 3: Minimal implementation**

atomic：在 `build_atomic_parse_context` / packet 拼接 `format_parse_context_block`。

`_run_qa_check` 开头：

```python
from app.graph.sidebar_media_parse import parse_as_vision_qa_result  # 新增小函数：dict → VisionQAResult

parse = state.get("sidebar_media_parse")
if urls and parse and parse.get("vision_used") and _qa_fields_complete(parse):
    if set(urls) <= set(parse.get("image_urls") or []) or _cache_covers(urls, state.get("sidebar_media_parse_cache")):
        vision = parse_as_vision_qa_result(parse)
        return evaluate_vision_qa_v2(vision, metrics)
```

`_qa_fields_complete`：`is_white_bg` / `is_sharp_enough` / `product_identifiable` 均非 None。

- [ ] **Step 4: Run tests to verify they pass**

Same pytest + `uv run pytest tests/test_product_visual_vision_qa_v2.py -q`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/atomic_parse.py services/agent-runtime/app/graph/nodes/image_qa_gate.py services/agent-runtime/app/graph/sidebar_media_parse.py services/agent-runtime/tests/test_atomic_sidebar_parse_context.py services/agent-runtime/tests/test_image_qa_reuses_sidebar_parse.py
git commit -m "$(cat <<'EOF'
feat: reuse sidebar parse in atomic and product visual QA

Avoids a second vision HTTP when the same URLs were just parsed.
EOF
)"
```

---

### Task 8: 验收单测收口（AC-01..09，全 mock）

**Files:**
- Test: `services/agent-runtime/tests/test_sidebar_media_parse_ac.py`
- 可选 Modify: `services/agent-runtime/skills/atomic-create/eval-route-set.yaml` **仅当**已有 case 因新节点断断言；**禁止**为「这个产品是什么」加 hint 表。

**Interfaces:**
- Consumes: Task 3–6 的公开函数与节点
- Produces: 下表金标

| AC | 测法 |
|----|------|
| AC-01 | parse 节点 + chat mock：回复含摘要，不含节点 id 当产品名 |
| AC-02 | explore mock：system 含 category；`unknown` 含 price_band；不出现「只能看到文件」 |
| AC-03 | 同 URL 第二次 `run_vision_qa` 次数为 0 |
| AC-04 | 换 URL 再调用 |
| AC-05 | 仅 text chip → nest 次数 0 |
| AC-06 | vision_creds.model=`ch_x::deepseek-flash` 传给 nest 的 model 原样（decode 在 Nest）；节点 `vision_used=true` |
| AC-07 | 若 nest 返回 `visionUsed=false`，prefix 含 NON_VISION 文案；explore system 含禁止空方案 |
| AC-08 | 无附件 chat，system 无【侧栏参考图解析】 |
| AC-09 | chat ainvoke messages 的 content 无 `image_url` 结构 |

- [ ] **Step 1: Write the failing tests** covering the table（可复用 Task 4/6 的 Fake nest，不要打真网）。

- [ ] **Step 2: Run test to verify gaps fail**

Run: `cd services/agent-runtime && uv run pytest tests/test_sidebar_media_parse_ac.py -v`

- [ ] **Step 3: Fill any remaining glue**（若 AC 已在前序任务覆盖，本步只补缺测，不改行为）。

- [ ] **Step 4: Full local verification**

```bash
cd services/agent-runtime && uv run pytest tests/test_supports_vision_model.py tests/test_sidebar_media_parse.py tests/test_parse_sidebar_media_node.py tests/test_parse_sidebar_media_graph.py tests/test_chat_sidebar_parse_inject.py tests/test_explore_sidebar_parse_inject.py tests/test_chat_system_prompt.py tests/test_atomic_sidebar_parse_context.py tests/test_image_qa_reuses_sidebar_parse.py tests/test_sidebar_media_parse_ac.py tests/test_product_visual_vision_qa_v2.py tests/test_intake_gate.py -q
pnpm --filter @lnkpi/agent test
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/tests/test_sidebar_media_parse_ac.py
git commit -m "$(cat <<'EOF'
test: cover sidebar media parse acceptance cases

Mocks vision HTTP so chat/explore grounding is asserted without live APIs.
EOF
)"
```

---

## Spec coverage

| Requirement | Task |
|-------------|------|
| R-PARSE-01/02, R-HOOK-01 | 3, 4, 5 |
| R-CACHE-01 | 3, 4, 8 AC-03/04 |
| R-INJECT-01/02, R-UX-01/02/03 | 3, 6, 8 |
| R-FAIL-01 | 4, 6, 8 AC-07 |
| R-MODEL-01/02/03 | 1, 4 |
| R-NEST-01 | 2, 4 |
| R-BOUND-01 | 6, 8 AC-09 |
| R-BILL-01 | 4（节点只调 `run_vision_qa`） |
| product_visual 不二次识图 | 7 |
| 不问句扩表 | 8 明确禁止 |

## Placeholder scan

无 TBD。prompt 路径、前缀原文、Flash 正则、graph 边均已写死。
