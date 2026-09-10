# Task 6 Report: Eval-route-set 金标（AC-01..07）

## Status
**Done** — 新增 `rt-chat-sink-01` 至 `rt-chat-sink-06`，锁定 chat-sink 与侧栏 vision 路由行为。

## Commit
`ec3c5c5` — `test(runtime): add chat-sink and sidebar vision eval-route cases`

## Changes
- `生一个小女孩的图片`、`生成一张图` → `atomic_create`
- 侧栏图片 + `这个图片是什么？` → `clarify_route`
- `生活怎么样` → `chat`
- 天猫详情页营销方案 → `clarify_route`
- `弄张图看看` → `clarify_route`，明确禁止 media suspected case 落入 `chat`
- AC-07 为 Chat 回复禁语约束，已由 Task 5 的 prompt golden 覆盖，不新增 route case

## Verification
```text
python3 -m pytest tests/test_eval_route_set.py -v
2 passed, 1 warning
```

## Notes
- 所有新增 gold 与 Task 3 既定行为一致，无需修改路由实现或扩张 hint 表。
