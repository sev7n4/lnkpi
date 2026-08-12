# PR-1: Macro scheme free-text revise

**Branch:** `fix/macro-scheme-free-text-revise`  
**Spec:** [2026-08-12-agent-ux-followup-batch-design.md](../specs/2026-08-12-agent-ux-followup-batch-design.md) §2

## Tasks

- [ ] `classify_macro_scheme_decision`: 自由文本修订 fallback
- [ ] `should_resume_interrupt`: macro gate 长文本默认 resume
- [ ] Tests: 用户复现用例 + hitl_resume

## Test

```bash
cd services/agent-runtime && uv run pytest tests/test_hitl_resume.py tests/test_product_visual_v2_nodes.py -v -k macro
```
