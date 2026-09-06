# Chat Sink 治理与侧栏媒体 L1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 禁止疑似媒体意图静默落入 `default_chat`；chat 能力诚实；口语动词归一与侧栏媒体进 `RouteFeatures`/precedence；保证 atomic 出口 `GenerationRequest` 与 Dock 同构（P0 字段，P1 builder 收口）。

**Architecture:** 在现有 L0 管线（`extract_route_features` → `resolve_atomic_intent` → `apply_route_precedence`）上增加 **feature 层**口语归一与 `suspected_*` 信号；precedence 在 `default_chat` 前拦截；重写 `chat._SYSTEM`；复用既有 `route_orchestration` clarify 的 1/2/3 映射（生成 / 营销 / 解读）；eval-route-set 固化 AC。**禁止**向 `ATOMIC_CREATE_HINTS` 追加「生一个」等同义词。

**Tech Stack:** Python 3 agent-runtime、pytest、`decide_route` / `eval-route-set.yaml`、既有 `GenerationRequest` DTO。

**Spec:** [docs/superpowers/specs/2026-09-06-chat-sink-sidebar-l1-design.md](../specs/2026-09-06-chat-sink-sidebar-l1-design.md)

## Global Constraints

- **R-POL-01:** 禁止向 `ATOMIC_CREATE_HINTS` / taxonomy hint 表追加 permanent 同义词作为主修复。
- **R-PREC-01:** `suspected_media_create ∨ suspected_vision_qa ∨ (has_sidebar_media ∧ 媒体向问句)` 时 `precedence_rule_id` 不得为 `default_chat`。
- **R-CHAT-01/02:** Chat 不得否认平台出图能力、不得外导 Midjourney 等第三方作图工具。
- **R-CHAT-03:** Chat 节点不做侧栏 vision。
- **D-1:** 低置信 → `clarify_route`；高置信（归一后 `utterance_suggests_atomic_create`）→ `atomic_create`。
- **RU-9:** `GenerationRequest` 字段 `prompt` / `refs` / `mentioned_keys` / `modality` 与 Dock 同名同义。
- 工作目录：`services/agent-runtime`；测试命令以该目录为 cwd（或 monorepo 等价 pytest path）。

---

## File map

| File | Responsibility |
|------|----------------|
| Create: `app/graph/media_utterance.py` | 口语动词归一、`suspected_media_create` / `suspected_vision_qa` 纯函数（无 I/O） |
| Modify: `app/graph/route_features.py` | `RouteFeatures` 增加三字段 + `has_sidebar_media`；调用 `media_utterance` |
| Modify: `app/graph/route_precedence.py` | 新规则 + `ROUTE_CLARIFY_MEDIA`；`atomic_generate` 消费高置信归一信号 |
| Modify: `app/graph/clarify_reply.py` | 自然语言别名：「生成一张图」「解读侧栏」等 |
| Modify: `app/graph/nodes/chat.py` | `_SYSTEM` 重写 |
| Modify: `skills/atomic-create/eval-route-set.yaml` | AC-01..07 金标 |
| Test: `tests/test_media_utterance.py` | 归一与 suspected 正负例 |
| Test: `tests/test_route_features.py` | feature 断言 |
| Test: `tests/test_route_precedence.py` | precedence 断言 |
| Test: `tests/test_chat_system_prompt.py` | `_SYSTEM` golden（静态） |
| Test: `tests/test_generation_request.py` | 侧栏 refs 在 colloquial→atomic 路径仍写出 |
| P1 Modify: `app/graph/generation_request.py` | 文档化 + 确保 clarify resume 后 builder 唯一入口（无字段漂移） |

---

### Task 1: `media_utterance` 纯函数（动词归一 + suspected）

**Files:**
- Create: `services/agent-runtime/app/graph/media_utterance.py`
- Test: `services/agent-runtime/tests/test_media_utterance.py`

**Interfaces:**
- Consumes: none（标准库 `re` only）
- Produces:
  - `normalize_colloquial_create_verbs(text: str) -> str`
  - `suspected_media_create(text: str) -> bool`
  - `suspected_vision_qa(text: str) -> bool`
  - `utterance_has_media_object(text: str) -> bool`（内部可用）

- [ ] **Step 1: Write the failing test**

Create `tests/test_media_utterance.py`:

```python
from app.graph.media_utterance import (
    normalize_colloquial_create_verbs,
    suspected_media_create,
    suspected_vision_qa,
)


def test_normalize_sheng_yi_ge_tu():
    raw = "请帮我生一个小女孩的图片"
    out = normalize_colloquial_create_verbs(raw)
    assert "生成一个" in out or "生成" in out
    assert "小女孩" in out


def test_normalize_does_not_touch_shenghuo():
    assert normalize_colloquial_create_verbs("生活怎么样") == "生活怎么样"


def test_suspected_media_create_sheng_tu():
    assert suspected_media_create("请帮我生一个小女孩的图片") is True


def test_suspected_media_create_negative_shengyi():
    assert suspected_media_create("生意很好") is False
    assert suspected_media_create("生活怎么样") is False


def test_suspected_vision_qa():
    assert suspected_vision_qa("这个图片是什么？") is True
    assert suspected_vision_qa("看看这张图") is True
    assert suspected_vision_qa("今天天气如何") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_media_utterance.py -v`  
Expected: FAIL（`ModuleNotFoundError` 或 import error）

- [ ] **Step 3: Write minimal implementation**

Create `app/graph/media_utterance.py`:

```python
"""Colloquial media-create / vision-qa utterance features (no hint-table growth)."""

from __future__ import annotations

import re

# Narrow: 生 + (一|个|张|个) … 图/图片/海报 — not 生活/生意/产生
_SHENG_CREATE = re.compile(
    r"生\s*(?:一\s*)?(?:个|张|幅)?\s*.{0,24}?(?:图片|图|海报|主图)"
)
_VISION_QA = re.compile(
    r"(?:这(?:个|张)?图片是什么|这是什么图|看看这张图|描述一下(?:这张)?图|"
    r"图里(?:有什么|是什么)|识别一下(?:这张)?图)"
)
_MEDIA_OBJECT = re.compile(r"(?:图片|海报|主图|照片|图)")


def normalize_colloquial_create_verbs(text: str) -> str:
    """Map oral 「生…图」→「生成…图」 for downstream suggest checks. Narrow patterns only."""
    t = text or ""
    if not t.strip():
        return t

    def _repl(m: re.Match[str]) -> str:
        chunk = m.group(0)
        # only first 生 → 生成 when pattern matched
        return "生成" + chunk[1:]

    return _SHENG_CREATE.sub(_repl, t, count=1)


def utterance_has_media_object(text: str) -> bool:
    return bool(_MEDIA_OBJECT.search(text or ""))


def suspected_media_create(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    if suspected_vision_qa(t):
        return False
    if _SHENG_CREATE.search(t):
        return True
    # soft: 弄/整/来 + 图 class without 营销短语（keep minimal）
    if re.search(r"(?:弄|整|来)\s*(?:一\s*)?(?:张|个).{0,12}?(?:图|图片)", t):
        return True
    return False


def suspected_vision_qa(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return bool(_VISION_QA.search(t))
```

Adjust regex if Step 4 fails on edge cases — **do not** add taxonomy hints.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/agent-runtime && python -m pytest tests/test_media_utterance.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/media_utterance.py \
  services/agent-runtime/tests/test_media_utterance.py
git commit -m "$(cat <<'EOF'
feat(runtime): add colloquial media utterance features

Normalize oral 生…图 patterns and detect suspected create/vision-qa
without growing ATOMIC_CREATE_HINTS.
EOF
)"
```

---

### Task 2: `RouteFeatures` 接入侧栏媒体与 suspected_*

**Files:**
- Modify: `services/agent-runtime/app/graph/route_features.py`
- Modify: `services/agent-runtime/tests/test_route_features.py`

**Interfaces:**
- Consumes: `media_utterance.suspected_media_create`, `suspected_vision_qa`, `normalize_colloquial_create_verbs`; `atomic_intent.utterance_suggests_atomic_create`
- Produces: `RouteFeatures` keys:
  - `has_sidebar_media: bool`
  - `suspected_media_create: bool`
  - `suspected_vision_qa: bool`
  - `media_create_high: bool`  # normalize 后 `utterance_suggests_atomic_create`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_route_features.py`:

```python
def test_sheng_tu_sets_suspected_and_high_after_normalize():
    utterance = "请帮我生一个小女孩的图片"
    ctx = assemble_route_context({"messages": [{"role": "user", "content": utterance}]})
    intent = _intent(utterance)
    features = extract_route_features(ctx, intent)
    assert features["suspected_media_create"] is True
    assert features["media_create_high"] is True
    assert features["suspected_vision_qa"] is False


def test_sidebar_image_sets_has_sidebar_media():
    utterance = "这个图片是什么？"
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": utterance}],
            "sidebar_attachments": [
                {"refKey": "I1", "mediaType": "image", "url": "https://a/1.jpg"}
            ],
        }
    )
    intent = _intent(utterance)
    features = extract_route_features(ctx, intent)
    assert features["has_sidebar_media"] is True
    assert features["suspected_vision_qa"] is True


def test_empty_url_attachment_not_sidebar_media():
    ctx = assemble_route_context(
        {
            "messages": [{"role": "user", "content": "hi"}],
            "sidebar_attachments": [{"refKey": "I1", "mediaType": "image", "url": ""}],
        }
    )
    intent = _intent("hi")
    features = extract_route_features(ctx, intent)
    assert features["has_sidebar_media"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/agent-runtime && python -m pytest tests/test_route_features.py::test_sheng_tu_sets_suspected_and_high_after_normalize tests/test_route_features.py::test_sidebar_image_sets_has_sidebar_media tests/test_route_features.py::test_empty_url_attachment_not_sidebar_media -v`  
Expected: FAIL（KeyError 或 assert False）

- [ ] **Step 3: Write minimal implementation**

In `route_features.py`:

1. Extend `RouteFeatures` TypedDict with the four keys above.
2. Import:

```python
from app.graph.atomic_intent import utterance_suggests_atomic_create
from app.graph.media_utterance import (
    normalize_colloquial_create_verbs,
    suspected_media_create,
    suspected_vision_qa,
)
```

3. In `extract_route_features`, compute:

```python
    has_sidebar_media = any(
        str(a.get("mediaType") or "").lower() in ("image", "video")
        and str(a.get("url") or "").strip()
        for a in attachments
        if isinstance(a, dict)
    )
    # also true when mentioned I* keys even without url? Spec: 空 URL 不计。
    # Keep I* with url via attachments only for has_sidebar_media;
    # has_image_ref may still be true from keys alone.

    suspected_create = suspected_media_create(utterance)
    suspected_vision = suspected_vision_qa(utterance)
    normalized = normalize_colloquial_create_verbs(utterance)
    media_high = bool(
        utterance_suggests_atomic_create(normalized)
        or (suspected_create and utterance_suggests_atomic_create(normalized))
    )
```

4. Include in returned dict:

```python
        has_sidebar_media=has_sidebar_media,
        suspected_media_create=suspected_create,
        suspected_vision_qa=suspected_vision,
        media_create_high=media_high,
```

**Do not** edit `intent-taxonomy.yaml` hints.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/agent-runtime && python -m pytest tests/test_route_features.py -v`  
Expected: PASS（含既有用例）

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/route_features.py \
  services/agent-runtime/tests/test_route_features.py
git commit -m "$(cat <<'EOF'
feat(runtime): expose sidebar media and suspected create features

Wire colloquial media signals into RouteFeatures for L0 precedence.
EOF
)"
```

---

### Task 3: Precedence — 禁 chat sink + media clarify 问句

**Files:**
- Modify: `services/agent-runtime/app/graph/route_precedence.py`
- Modify: `services/agent-runtime/tests/test_route_precedence.py`

**Interfaces:**
- Consumes: `RouteFeatures.media_create_high`, `suspected_media_create`, `suspected_vision_qa`, `has_sidebar_media`
- Produces:
  - `ROUTE_CLARIFY_MEDIA: str`（模块常量）
  - rules: `media_create_high`（可并入增强 `atomic_generate`）、`suspected_media_clarify`、`suspected_vision_clarify`
  - `precedence_rule_id` ∈ 上述 id；`clarify_question=ROUTE_CLARIFY_MEDIA` 当 clarify

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_route_precedence.py`:

```python
from app.graph.route_precedence import ROUTE_CLARIFY_MEDIA


def test_sheng_xiao_girl_not_default_chat():
    d = _decide({"messages": [{"role": "user", "content": "请帮我生一个小女孩的图片"}]})
    assert d["flow_mode"] != "chat"
    assert d["precedence_rule_id"] != "default_chat"
    # Prefer atomic after normalize; clarify also acceptable if high not wired yet
    assert d["flow_mode"] in ("atomic_create", "clarify_route")


def test_sheng_xiao_girl_prefers_atomic_when_high():
    d = _decide({"messages": [{"role": "user", "content": "请帮我生一个小女孩的图片"}]})
    assert d["flow_mode"] == "atomic_create"
    assert d["precedence_rule_id"] in ("atomic_generate", "media_create_high")


def test_shenghuo_still_chat():
    d = _decide({"messages": [{"role": "user", "content": "生活怎么样"}]})
    assert d["flow_mode"] == "chat"
    assert d["precedence_rule_id"] == "default_chat"


def test_vision_qa_with_sidebar_not_chat():
    d = _decide(
        {
            "messages": [{"role": "user", "content": "这个图片是什么？"}],
            "sidebar_attachments": [
                {"refKey": "I1", "mediaType": "image", "url": "https://a/1.jpg"}
            ],
        }
    )
    assert d["flow_mode"] != "chat"
    assert d["precedence_rule_id"] != "default_chat"
    assert d["flow_mode"] in ("clarify_route", "atomic_create")
    if d["flow_mode"] == "clarify_route":
        assert d["clarify_question"] == ROUTE_CLARIFY_MEDIA


def test_soft_suspected_clarify_uses_media_question():
    # 弄张图看看 — suspected but may not be media_create_high depending on hints
    d = _decide({"messages": [{"role": "user", "content": "帮我弄张图看看"}]})
    assert d["precedence_rule_id"] != "default_chat"
    if d["flow_mode"] == "clarify_route":
        assert "1）" in (d.get("clarify_question") or "")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/agent-runtime && python -m pytest tests/test_route_precedence.py::test_sheng_xiao_girl_not_default_chat tests/test_route_precedence.py::test_sheng_xiao_girl_prefers_atomic_when_high tests/test_route_precedence.py::test_vision_qa_with_sidebar_not_chat -v`  
Expected: FAIL（当前 `default_chat`）

- [ ] **Step 3: Write minimal implementation**

In `route_precedence.py`:

1. Add constant:

```python
ROUTE_CLARIFY_MEDIA = (
    "听起来您想处理图片。请确认：\n"
    "1）直接生成一张图；\n"
    "2）做营销/详情页方案；\n"
    "3）解读侧栏图片（描述/问答）。\n"
    "回复 1 / 2 / 3。"
)
```

2. Enhance `_rule_atomic_generate` — near the top of the match condition, also allow:

```python
    if features.get("media_create_high"):
        return _base_decision(
            ctx,
            flow_mode="atomic_create",
            reason="media_create_normalized",
            confidence=0.90,
            precedence_rule_id="atomic_generate",  # keep id stable OR use media_create_high
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
```

（若希望 rule_id 区分，用 `media_create_high`，并更新测试允许集合。）

3. Add `_rule_suspected_vision_clarify` **before** `_rule_default_chat`（建议插在 `atomic_generate` 之后、`empty` 之前）:

```python
def _rule_suspected_vision_clarify(...):
    if features.get("suspected_vision_qa") and features.get("has_sidebar_media"):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="suspected_vision_qa",
            confidence=0.72,
            precedence_rule_id="suspected_vision_clarify",
            clarify_question=ROUTE_CLARIFY_MEDIA,
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    # 有侧栏媒体 + 媒体向问句但未标 vision：仍禁止落入 chat 的兜底见下一规则
    return None


def _rule_suspected_media_clarify(...):
    if features.get("suspected_media_create") and not features.get("media_create_high"):
        return _base_decision(
            ctx,
            flow_mode="clarify_route",
            reason="suspected_media_create",
            confidence=0.70,
            precedence_rule_id="suspected_media_clarify",
            clarify_question=ROUTE_CLARIFY_MEDIA,
            guard_veto=_guard_veto(ctx),
            intent=intent,
            features=features,
        )
    return None
```

4. Register in `PRECEDENCE_RULES` **after** `atomic_generate`, **before** `empty`:

```python
    ("atomic_generate", _rule_atomic_generate),
    ("suspected_vision_clarify", _rule_suspected_vision_clarify),
    ("suspected_media_clarify", _rule_suspected_media_clarify),
    ("empty", _rule_empty),
    ("default_chat", _rule_default_chat),
```

5. Re-export `ROUTE_CLARIFY_MEDIA` from `route_decide.py` if other modules import clarify constants from there（可选；intake 已用 decision["clarify_question"]）。

**Marketing regression:** `帮我做一套天猫详情页营销方案` 仍应由 `orch_ambiguous` / orchestration 规则先命中 — 跑全量 `test_route_precedence.py` 确认。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/agent-runtime && python -m pytest tests/test_route_precedence.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/route_precedence.py \
  services/agent-runtime/tests/test_route_precedence.py
git commit -m "$(cat <<'EOF'
feat(runtime): block media intents from default_chat sink

Route normalized oral create to atomic; low-confidence suspected
media/vision to clarify_route with ROUTE_CLARIFY_MEDIA.
EOF
)"
```

---

### Task 4: Clarify 回复别名（生成 / 解读侧栏）

**Files:**
- Modify: `services/agent-runtime/app/graph/clarify_reply.py`
- Test: `services/agent-runtime/tests/test_clarify_reply_media.py`（新建）或扩展既有 `test_route_clarify_followup.py`

**Interfaces:**
- Consumes: 既有 `classify_clarify_reply` → `IntentParseResult`
- Produces: 自然语言「生成一张图」「直接生成」「解读侧栏」「看看这张图」映射到 route `atomic_create`（image 或 vision_text）/ `campaign`

- [ ] **Step 1: Write the failing test**

```python
from app.graph.clarify_reply import classify_clarify_reply
from app.graph.route_precedence import ROUTE_CLARIFY_MEDIA

ORIGINAL = "请帮我生一个小女孩的图片"


def test_clarify_reply_generate_nl():
    r = classify_clarify_reply(ORIGINAL, ROUTE_CLARIFY_MEDIA, "生成一张图")
    assert r != "none"
    assert r["route"] == "atomic_create"
    assert r["items"][0]["target_type"] == "image"


def test_clarify_reply_interpret_sidebar_nl():
    r = classify_clarify_reply(
        "这个图片是什么？", ROUTE_CLARIFY_MEDIA, "解读侧栏图片"
    )
    assert r != "none"
    assert r["route"] == "atomic_create"
    assert r["items"][0].get("prompt_mode") == "vision_text" or r["items"][0]["target_type"] == "text"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/agent-runtime && python -m pytest tests/test_clarify_reply_media.py -v`  
Expected: FAIL（`r == "none"`）

- [ ] **Step 3: Write minimal implementation**

In `clarify_reply.py`, extend choice sets / keyword checks:

```python
_CHOICE_ONE = frozenset({
    ...,
    "生成一张图", "直接生成", "生图", "只要图",
})
# in choice-one branch, if original utterance present, prefer prompt=original (already mostly true)

_CHOICE_THREE = frozenset({
    ...,
    "解读侧栏图片", "解读侧栏", "看看图", "描述图片", "看图问答",
})
```

Ensure choice-three path still returns `prompt_mode: "vision_text"`（已有）。

Also: when original contains「生一个」且用户回 `1`，`prompt` 必须是 **original_utterance**（不要回落「蓝牙耳机主图」）。检查 choice-one 分支：若 `original` 非空且含图类词，直接 `prompt = original`。

```python
    if lowered in _CHOICE_ONE or any(k in raw for k in ("单张主图", "直接出图", "只要主图", "生成一张图", "直接生成")):
        original = (original_utterance or "").strip()
        if original:
            prompt = original
        else:
            prompt = "生成一张图"
        ...
```

（删除或收窄硬编码「蓝牙耳机主图」回落，避免污染 media clarify。）

- [ ] **Step 4: Run tests**

Run: `cd services/agent-runtime && python -m pytest tests/test_clarify_reply_media.py tests/test_route_clarify_followup.py -v`  
Expected: PASS（若旧用例依赖耳机回落，按失败信息改旧用例为显式 original）

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/clarify_reply.py \
  services/agent-runtime/tests/test_clarify_reply_media.py \
  services/agent-runtime/tests/test_route_clarify_followup.py
git commit -m "$(cat <<'EOF'
fix(runtime): map media clarify replies without bogus default prompt

Accept NL generate/interpret aliases; keep original utterance as prompt.
EOF
)"
```

---

### Task 5: Chat `_SYSTEM` 能力诚实

**Files:**
- Modify: `services/agent-runtime/app/graph/nodes/chat.py`
- Create: `services/agent-runtime/tests/test_chat_system_prompt.py`

**Interfaces:**
- Consumes: none
- Produces: 更新后的 `_SYSTEM` 字符串；可 `from app.graph.nodes.chat import _SYSTEM`（若需测试，保持模块级常量名 `_SYSTEM`）

- [ ] **Step 1: Write the failing test**

```python
from app.graph.nodes.chat import _SYSTEM

FORBIDDEN = (
    "没有生成",
    "无法生成图片",
    "不能生成图",
    "Midjourney",
    "midjourney",
    "Stable Diffusion",
)


def test_chat_system_does_not_deny_or_divert():
    for bad in FORBIDDEN:
        assert bad not in _SYSTEM, bad


def test_chat_system_mentions_honest_capability_or_redirect():
    # 至少提示可生成图或引导说清意图，而非只推营销
    assert ("生成" in _SYSTEM) or ("出图" in _SYSTEM) or ("画布" in _SYSTEM)
    assert "天猫详情页营销方案" not in _SYSTEM or "也可以" in _SYSTEM or "可选" in _SYSTEM
```

（第二则断言按最终文案微调；核心是第一则硬禁。）

- [ ] **Step 2: Run test — expect fail on current `_SYSTEM`**

Run: `cd services/agent-runtime && python -m pytest tests/test_chat_system_prompt.py -v`  
Expected: 可能 FAIL（当前文案含「不要…承诺自动出图」——按 FORBIDDEN 列表；若未命中字面，改为断言 **不得** 出现「不要擅自…承诺自动出图」作为唯一能力边界，并检查新文案正面约束）

更稳的断言：

```python
def test_chat_system_not_legacy_no_image_promise():
    assert "不要擅自创建画布方案或承诺自动出图" not in _SYSTEM
```

- [ ] **Step 3: Rewrite `_SYSTEM`**

Replace in `chat.py`:

```python
_SYSTEM = (
    "你是 lnkpi 无限画布助手。用简洁中文回答用户。"
    "平台支持在画布上生成图片/视频等媒体；不要声称「没有生成图片能力」，"
    "也不要推荐 Midjourney 等外部作图工具。"
    "当前若未进入创作流程，可请用户直接说「帮我生成一张…图」，或说明要解读侧栏图片；"
    "若用户要做电商详情页/主图营销方案，也可提示他们说明品类与渠道。"
)
```

Keep fallback reply in `make_chat_node` consistent（去掉「只能营销」口吻）。

- [ ] **Step 4: Run test to verify pass**

Run: `cd services/agent-runtime && python -m pytest tests/test_chat_system_prompt.py -v`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/agent-runtime/app/graph/nodes/chat.py \
  services/agent-runtime/tests/test_chat_system_prompt.py
git commit -m "$(cat <<'EOF'
fix(runtime): make chat system prompt capability-honest

Stop denying image generation and diverting users to external tools.
EOF
)"
```

---

### Task 6: Eval-route-set 金标（AC-01..07）

**Files:**
- Modify: `services/agent-runtime/skills/atomic-create/eval-route-set.yaml`
- Verify via: `services/agent-runtime/tests/test_eval_route_set.py`

**Interfaces:**
- Consumes: `decide_route` gold runner
- Produces: 新 cases `rt-chat-sink-01` …（ids 稳定）

- [ ] **Step 1: Add cases to YAML**

Append to `cases:`:

```yaml
  - id: rt-chat-sink-01
    state:
      messages: [{ role: user, content: "请帮我生一个小女孩的图片" }]
    gold: { flow_mode: atomic_create }

  - id: rt-chat-sink-02
    state:
      messages: [{ role: user, content: "请帮我生成一张图" }]
    gold: { flow_mode: atomic_create }

  - id: rt-chat-sink-03
    state:
      messages: [{ role: user, content: "这个图片是什么？" }]
      sidebar_attachments:
        - { refKey: I1, mediaType: image, url: "https://a/1.jpg" }
    gold: { flow_mode: clarify_route }

  - id: rt-chat-sink-04
    state:
      messages: [{ role: user, content: "生活怎么样" }]
    gold: { flow_mode: chat }

  - id: rt-chat-sink-05
    state:
      messages: [{ role: user, content: "帮我做一套天猫详情页营销方案" }]
    gold: { flow_mode: clarify_route }

  - id: rt-chat-sink-06
    state:
      messages: [{ role: user, content: "帮我弄张图看看" }]
    gold:
      # soft suspected: clarify_route or atomic_create — never chat
      flow_mode: clarify_route
```

若 `rt-chat-sink-06` 实现为 atomic，把 gold 改为 `atomic_create`。**禁止** gold=`chat`。

若 eval runner 只做精确 `flow_mode` 匹配，确保实现与 gold 一致；不要用「或」语法（yaml 无或）——选一个确定行为。推荐：`弄张图看看` → `clarify_route`。

Update yaml `meta.spec` 可追加指向本 design（可选一行注释）。

- [ ] **Step 2: Run eval**

Run: `cd services/agent-runtime && python -m pytest tests/test_eval_route_set.py -v`  
Expected: PASS（失败则回到 Task 3 调 precedence，不改 hint 表）

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/skills/atomic-create/eval-route-set.yaml
git commit -m "$(cat <<'EOF'
test(runtime): add chat-sink and sidebar vision eval-route cases

Lock oral paraphrase and sidebar vision-qa away from default_chat.
EOF
)"
```

---

### Task 7: GenerationRequest P0 — colloquial / sidebar 路径仍写出 DTO

**Files:**
- Modify: `services/agent-runtime/tests/test_generation_request.py`
- Modify only if needed: `services/agent-runtime/app/graph/generation_request.py`

**Interfaces:**
- Consumes: `build_generation_request_from_atomic_state`, `apply_generation_request_to_state`
- Produces: 回归证明「生一个…」atomic 状态仍产出 `prompt` + 侧栏 `refs`

- [ ] **Step 1: Write failing/回归 test**

```python
def test_colloquial_create_with_sidebar_refs():
    utterance = "请帮我生一个小女孩的图片"
    state = {
        "messages": [HumanMessage(content=utterance)],
        "sidebar_mentioned_keys": ["I1"],
        "sidebar_attachments": [
            {"refKey": "I1", "mediaType": "image", "url": "https://a/1.jpg"}
        ],
        "atomic_spec": {
            "target_type": "image",
            "prompt": utterance,
            "title": "小女孩",
        },
        "atomic_node_id": "img-1",
    }
    req = build_generation_request_from_atomic_state(state)
    assert req["prompt"]
    assert req["modality"] == "image"
    assert req["mentioned_keys"] == ["I1"]
    assert any(r.get("url") == "https://a/1.jpg" for r in (req.get("refs") or []))
```

- [ ] **Step 2: Run test**

Run: `cd services/agent-runtime && python -m pytest tests/test_generation_request.py::test_colloquial_create_with_sidebar_refs -v`  
Expected: PASS（若 FAIL，修 `_refs_from_sidebar` / mentioned keys，**不要**新建第二套 DTO）

- [ ] **Step 3: Commit**

```bash
git add services/agent-runtime/tests/test_generation_request.py \
  services/agent-runtime/app/graph/generation_request.py
git commit -m "$(cat <<'EOF'
test(runtime): assert GenerationRequest survives colloquial create path

Keep Agent sidebar refs aligned with Dock field names (RU-9 P0).
EOF
)"
```

---

### Task 8: P1 — GenerationRequest 共用入口文档化 + clarify resume 断言

**Files:**
- Modify: `services/agent-runtime/app/graph/generation_request.py`（模块 docstring 标明唯一入口）
- Create or modify: `services/agent-runtime/tests/test_generation_request.py`

**Interfaces:**
- Consumes: clarify resume → `pre_parsed_intent` → atomic create → `apply_generation_request_to_state`
- Produces: 单测证明 resume 后 `state["generation_request"]` 字段齐全；禁止手写平行 mapping

- [ ] **Step 1: Write test for clarify→atomic apply**

```python
@pytest.mark.asyncio
async def test_apply_generation_request_after_clarify_resume_fields():
    state = {
        "messages": [HumanMessage(content="请帮我生一个小女孩的图片")],
        "atomic_spec": {
            "target_type": "image",
            "prompt": "请帮我生一个小女孩的图片",
            "title": "小女孩",
        },
        "sidebar_attachments": [],
    }
    patch = apply_generation_request_to_state(state)
    gr = patch.get("generation_request") or {}
    assert set(gr.keys()) >= {"prompt", "refs", "mentioned_keys", "modality"}
```

- [ ] **Step 2: Docstring on `generation_request.py`**

在文件头注明：

```python
"""P2/P1: unified GenerationRequest DTO — sidebar atomic path ≡ Dock (RU-9).

唯一构造入口：
- build_generation_request_from_atomic_state
- build_generation_request_from_dock
- apply_generation_request_to_state（写入 state）

禁止在 nodes/* 内手写 prompt/refs 平行字典。
"""
```

Grep `nodes/` for ad-hoc `{"prompt":` + `refs` 平行结构；若发现，改为调用 `apply_generation_request_to_state`（仅限本次相关路径，不做大范围重构）。

- [ ] **Step 3: Run tests + commit**

Run: `cd services/agent-runtime && python -m pytest tests/test_generation_request.py -v`  

```bash
git add services/agent-runtime/app/graph/generation_request.py \
  services/agent-runtime/tests/test_generation_request.py
git commit -m "$(cat <<'EOF'
docs(runtime): lock GenerationRequest as sole Agent/Dock builder

P1 alignment: document single entrypoints and assert field completeness.
EOF
)"
```

---

### Task 9: 全量回归与 spec 状态

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-chat-sink-sidebar-l1-design.md`（状态 → Implemented P0 / P1 as applicable）

- [ ] **Step 1: Run focused + eval suite**

```bash
cd services/agent-runtime && python -m pytest \
  tests/test_media_utterance.py \
  tests/test_route_features.py \
  tests/test_route_precedence.py \
  tests/test_clarify_reply_media.py \
  tests/test_chat_system_prompt.py \
  tests/test_generation_request.py \
  tests/test_eval_route_set.py \
  tests/test_route_clarify_followup.py \
  tests/test_clarify_gate_unified.py \
  -v
```

Expected: PASS

- [ ] **Step 2: Update spec header status**

`Proposed` → `Implemented P0`（若 Task 8 完成则 `Implemented P0–P1`）

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-09-06-chat-sink-sidebar-l1-design.md
git commit -m "$(cat <<'EOF'
docs(spec): mark chat-sink sidebar L1 design implemented

Record P0/P1 completion after eval-route-set and unit gates pass.
EOF
)"
```

---

## Spec coverage (self-review)

| Spec ID | Task |
|---------|------|
| R-CHAT-01/02/03 | Task 5 |
| R-FEAT-01/02/03 | Task 1–2 |
| R-PREC-01/02/03 | Task 3 |
| R-ALIGN-01 P0 | Task 7 |
| R-ALIGN-01 P1 | Task 8 |
| R-POL-01 | Global + Tasks 1–3（无 hint 改动） |
| R-EVAL-01 | Task 6 |
| AC-01..07 | Task 3 + 6 |
| D-1 clarify 策略 | Task 3–4 |

**Placeholder scan:** 无 TBD；`弄张图看看` gold 在 Task 6 定为 `clarify_route`。  
**Type consistency:** `media_create_high` / `has_sidebar_media` / `ROUTE_CLARIFY_MEDIA` 命名跨 Task 2–4 一致。
