# Atomic Intent IR — 结构化意图解析（B+C）

## Goal

Replace substring→node-type routing with **Action × OutputModality × Sources** IR, aligned with canvas text→video/image Dock behavior. Deprecate blanket rules (`凡含提示词→prompt`, `文案→text` before `视频`).

## Intent IR

```python
AtomicIntent:
  action: generate | expand | write | plan | unknown
  output_modality: image | video | text | prompt | audio
  source_markers: list[str]   # 文案/提示词/文本…
  mentioned_keys: list[str]   # @T1 from sidebar
  utterance: str
```

## Resolution priority

1. **Source-backed media generation**: `(基于|根据|参考).*(文案|提示词|文本).*(生成|做).*(视频|图片)` → output=video/image
2. **Ref + generate + media**: `@T1` + 生成 + 视频/图片 → output=video/image
3. **Direct media generate**: 15秒产品展示视频 → video
4. **Expand**: 提示词模式/扩写/分镜提示词（无 media output）→ prompt
5. **Write/plan**: 脚本/方案 → text/campaign
6. **Fallback**: image default (unchanged)

## Harness

- `has_modality_conflict_risk(utterance)` → disable rule fast-path (conf cap 0.85) → LLM or clarify
- `validate_parse_result` post-guard: rewrite/fix target_type when IR disagrees with items

## Graph compiler (minimal)

- atomic_create still single node; target_type=video/image + localRefs (existing apply_sidebar_attachments)
- Studio prompt: short instruction (`基于引用内容生成视频`) when source-backed; refs carry T1 body

## Deprecated (remove, do not wrap)

- `_has_prompt_explicit` blanket `提示词 in text`
- `parse_atomic_target_type` static priority without action context
- LLM prompt line: `凡含提示词→prompt` without generate-video exception
