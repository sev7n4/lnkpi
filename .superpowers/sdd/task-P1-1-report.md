# Task P1-1 Report: UX-PV-05 structured scheme draft presentation

**Branch:** feat/agent-conversation-ux-pv  
**Base:** f7f70ca  
**Commit:** feat(agent): UX-PV-05 structured scheme draft presentation  
**Status:** ✅ Complete

## Delivered

### Runtime
- **`scheme_draft.py`**: 四章标题校验、`normalize_macro_scheme_card`（summary≤80、tags 去 `#`）
- **`models.py`**: `MacroScheme.tags`；`draft_prose` 必须含 §3.2 四章；macro 卡片字段规范化
- **`presentation.py`**: `macro_scheme_cards` envelope `body.schemes[]` + `max_select=2`
- **`dialog-draft/1.0.0.md`**: JSON 示例增加 `tags` 字段
- **`eval-cvs-set-v2.yaml`**: fixture prose 对齐四章结构

### Web
- **`schemeDraftProse.ts`**: 四章解析、assistant `---` footer 拆分、summary 截断
- **`AgentProseBlock.vue`**: 默认两节 +「展开完整方案」折叠
- **`AgentMacroSchemeCards.vue`**: summary≤80、#tags、`recommend_reason` 独立行
- **`AgentPresentationHost.vue`**: 分发 `prose_block` / `macro_scheme_cards`
- **`AgentSideRail.vue`**: v2 方案 prose 用 `AgentProseBlock`；宏观门控用 `AgentMacroSchemeCards`

## Tests

```
python3 -m pytest tests/test_dialog_draft_prose.py tests/test_presentation_envelope.py \
  tests/test_product_visual_v2_nodes.py tests/test_product_visual_v2_core.py \
  tests/test_eval_cvs_set_v2.py -v
47 passed

pnpm exec vitest run src/components/agent/presentation/schemeDraftProse.test.ts \
  src/components/agent/presentation/presentation.test.ts
9 passed
```

## Concerns

- **LLM 合规**：四章结构现由 Pydantic 硬校验；真实 LLM 偶发缺节会导致 `dialog_draft` 重试后仍可能失败（已有 2 次 attempt）。
- **prose 与 envelope 双轨**：scheme_draft 阶段 prose 仍来自 assistant `messages`（SideRail 折叠渲染），macro 卡片仍主要靠 thread-state `macroSchemes`；envelope `body.schemes` 已就绪供后续 P2 门控合并复用。
- **tags 来源**：依赖 LLM 在 `macro_schemes[].tags` 填风格标签；无 tags 时卡片仅显示 summary + reason。

## Next

Task P1-2 (UX-PV-06): `topo_card_list` 卡片列表 + 折叠 mermaid。
