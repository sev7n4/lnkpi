# Task 8 Report — GenerationRequest P1 sole builder docs + field completeness

## Done

- **Docstring** (`generation_request.py`): 标明 P2/P1 唯一构造入口三函数；禁止 nodes 内手写 prompt/refs 平行字典。
- **Test** (`test_apply_generation_request_after_clarify_resume_fields`): clarify→atomic resume 场景断言 `generation_request` 含 `prompt`, `refs`, `mentioned_keys`, `modality`。
- **Grep nodes/**: `atomic_create_node.py` 已调用 `apply_generation_request_to_state`；未发现需改的手写平行 mapping。

## Verification

```
pytest tests/test_generation_request.py -v → 6 passed
```

## Commit

```
docs(runtime): lock GenerationRequest as sole Agent/Dock builder
```
