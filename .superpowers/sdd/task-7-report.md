# Task 7 Report: 黄金评测集 + 文档

## Status

**DONE**

## What I implemented

- Extracted `matchPlatformRecipes(utterance)` into `packages/shared/src/canvas/recipeCatalog.ts`
  - 套图/详情/主图/电商 → `ecommerce-product-visual`
  - 三视图/定妆/模特/角色 → `model-turnaround`
  - both → parent ecommerce + `graftHint` model-turnaround
  - none → `needsClarify`, both platform summaries
- Nest `WorkflowRecipeService.matchRecipes` calls that helper, then unions the user catalog
- Gold eval fixtures: `docs/workflow/examples/recipe-planner-eval.json` (8 cases from spec §10.6)
- Iterator: `packages/shared/src/canvas/recipePlannerEval.test.ts`
- `docs/workflow/README.md` 交叉引用 2026-09-15 spec；外部 Agent 仍只生成 `lnkpi.workflow` 实例（未把 delta schema 写成对外教程）

## Tests + TDD evidence

### RED (fixtures missing)

```
AssertionError: expected false to be true
❯ recipe planner gold eval > fails when gold eval fixtures are missing
ENOENT: .../docs/workflow/examples/recipe-planner-eval.json
```

### RED (helper missing, fixtures present)

```
TypeError: matchPlatformRecipes is not a function
```

### GREEN

```bash
pnpm --filter @lnkpi/shared exec vitest run src/canvas/recipePlannerEval.test.ts src/canvas/workflowRecipe.test.ts src/canvas/recipeCatalog.test.ts
pnpm --filter @lnkpi/server exec vitest run src/agent/workflow-recipe.service.test.ts
```

Shared: `46 passed` (3 files). Nest match/promote: `13 passed`.

## Files changed

| File | Change |
| --- | --- |
| `packages/shared/src/canvas/recipeCatalog.ts` | `matchPlatformRecipes` |
| `packages/shared/src/canvas/recipeCatalog.test.ts` | 四条认亲规则 |
| `packages/shared/src/canvas/recipePlannerEval.test.ts` | 迭代黄金 JSON |
| `docs/workflow/examples/recipe-planner-eval.json` | 8 条评测 |
| `docs/workflow/README.md` | 交叉引用 2026-09-15 spec |
| `apps/server/src/agent/workflow-recipe.service.ts` | match 调 shared helper ∪ 用户目录 |

## Commit

`test(shared): recipe planner gold eval set`

Not pushed.

## Concerns

1. **Case 7 is shared-only.** `inferRecipeDraftFromWorkflow` + empty `seedChains` stands in for Nest promote 400；不调 `promoteRecipe`。
2. **Graft lifestyle check injects `model_lifestyle` in the test runner** because the platform model recipe has no downstream. Still proves graft copies only seed/turnaround.
3. **Shared now exports `MatchRecipeItem`**, same name as Nest’s local type (structural, no import clash in the service).
