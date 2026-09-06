# Task 3 Report: Precedence — 禁 chat sink + media clarify 问句

## Status

Implemented the Task 3 route-precedence change on `feature/chat-sink-sidebar-l1`.

## Changes

- Added `ROUTE_CLARIFY_MEDIA`.
- Enhanced `atomic_generate` so `media_create_high` routes to `atomic_create` with stable rule id `atomic_generate`.
- Added `suspected_vision_clarify` for vision questions with sidebar media.
- Added `suspected_media_clarify` for lower-confidence media-create requests.
- Registered both clarify rules after `atomic_generate` and before `empty`.
- Added acceptance and regression tests for colloquial image creation, ordinary chat, sidebar vision QA, and soft media requests.
- Did not modify `ATOMIC_CREATE_HINTS` or any taxonomy hints (R-POL-01).

## TDD Evidence

### RED

Command:

`python3 -m pytest tests/test_route_precedence.py::test_sheng_xiao_girl_not_default_chat tests/test_route_precedence.py::test_sheng_xiao_girl_prefers_atomic_when_high tests/test_route_precedence.py::test_vision_qa_with_sidebar_not_chat -v`

After introducing the new public constant needed by test collection, all three behavior tests failed because each request still returned `flow_mode="chat"` through `default_chat`.

### GREEN

Command:

`python3 -m pytest tests/test_route_precedence.py -v`

Result: `19 passed, 1 warning`.

Broader command:

`python3 -m pytest tests/test_route_features.py tests/test_route_precedence.py -q`

Result: `31 passed, 1 warning`.

IDE diagnostics: no linter errors in the two modified files.

## Acceptance / Regression Results

- `请帮我生一个小女孩的图片` → `atomic_create`, rule `atomic_generate`.
- `生活怎么样` → `chat`, rule `default_chat`.
- `这个图片是什么？` with sidebar image → `clarify_route`, rule `suspected_vision_clarify`, using `ROUTE_CLARIFY_MEDIA`.
- `帮我弄张图看看` does not enter `default_chat`.
- Existing marketing/orchestration regression remains covered by `test_precedence_orch_ambiguous_ac04` and passes.

## Build Note

The target worktree's `pnpm build` could not start because its dependencies were absent (`tsc: command not found`). A frozen-lockfile install was attempted, but the configured `registry.npmmirror.com` returned HTTP 403 for `esbuild`, so the TypeScript build could not be completed in this worktree. The Python runtime tests relevant to this task are green.

## Task 3 Review Fix Evidence (R-PREC-01)

Changed `suspected_vision_clarify` to depend on `suspected_vision_qa` alone, so sidebar media is optional.

RED command:

`python3 -m pytest tests/test_route_precedence.py::test_vision_qa_without_sidebar_routes_to_media_clarify -v`

Result: `1 failed, 1 warning`; `这个图片是什么？` returned `flow_mode="chat"` instead of `clarify_route`.

GREEN command:

`python3 -m pytest tests/test_route_precedence.py -v`

Result: `20 passed, 1 warning`. This covers both no-sidebar utterances (`这个图片是什么？`, `看看这张图`), the existing with-sidebar case, and `生活怎么样` remaining `default_chat`.

Build command:

`pnpm build`

Result: could not run because this worktree still has no dependencies (`packages/shared: tsc: command not found`, `node_modules missing`), consistent with the build note above.
