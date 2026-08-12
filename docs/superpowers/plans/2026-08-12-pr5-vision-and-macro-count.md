# PR-5a: Vision QA diagnostics

**Branch:** `chore/vision-qa-diagnostics`

## Deliverables

- `vision_qa_diagnostics.py` — stable `imageQaCode` classification
- `evaluate_vision_qa_v2` emits `image_qa_code`
- SSE / thread-state `imageQaCode` passthrough
- `deploy/prod-vision-qa-diagnose.py` — production smoke + remediation hints

## Test

```bash
cd services/agent-runtime && python3 -m pytest tests/test_vision_qa_diagnostics.py tests/test_product_visual_vision_qa_v2.py -v
```
