# Task P2-4 Report: UX-PV-13 空状态与引导

**Branch:** feat/agent-conversation-ux-pv  
**Commit:** feat(agent): UX-PV-13 skill empty state and guidance callouts  
**Status:** ✅ Complete

## Delivered

### Copy YAML (`guidance.*`)
- **`services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml`**
  - `guidance.macro_style_in_cards`: 「风格在这里选；需求用口语描述即可。」
  - `guidance.attachment_hint`: 「建议清晰 product 图；白底更佳，非白底也可继续。」
  - `guidance.example_utterances`: 礼盒 / Listing / 空间 三条示例话术

### Runtime
- **`product_visual_v2/presentation.py`**: 宏观门控 envelope 始终注入 `body.callout`（guidance）；话题冲突时额外 `body.callout_conflict`（context note）

### Frontend
- **`apps/web/src/constants/productVisualCopy.ts`**: Web 侧 guidance 常量（与 YAML 同步）
- **`AgentSideRail.vue`**
  - 选中「实物产品视觉出图」且无消息时：3 条可点击示例话术填入输入框
  - 宏观卡片上方展示 runtime `callout` + 可选 `callout_conflict`
  - 输入区附件 hint（无 pending 附件时显示）
- **`presentation/types.ts`**: `callout_conflict` 类型

## Tests

```
pytest tests/test_presentation_envelope.py -k "macro or guidance" — 4 passed
pnpm test src/constants/productVisualCopy.test.ts — 2 passed
```

## Concerns

- Web guidance 文案与 YAML 双写，由 `productVisualCopy.test.ts` 解析 YAML 校验同步；若后续 guidance 扩展可考虑 Nest 暴露 copy 端点避免漂移。
- 空状态示例仅在显式选中 product-visual 技能时展示；自动路由模式仍显示通用空状态（符合 spec：技能空状态）。

## Spec mapping

| Spec ID | 验收 |
|---------|------|
| UX-PV-13 | 礼盒/Listing/空间 可点击示例；宏观 callout；附件 hint；guidance.* YAML keys |
