# Catalog Fill Final Fix Report

Status: DONE — merge blockers C1、I2、I3 已修复；低成本项 I5 同步完成。

## Changes

- `GuidePickerPopover` 新增 `below-start` / `above-end` placement；Prompt、Image、Refine 三处 picker 均使用向上、右对齐定位。
- `MentionInput` 关闭 mention 菜单及 `DockRefPreview` 关闭预览时消费 Escape，避免继续关闭父级 dock。
- 两份 taxonomy YAML 恢复精确/具体意图优先顺序，保持逐字节一致；新增「写实摄影 + 精确文字」解析为 `g3_exact_text` 的回归测试。
- Prompt dock 仅写入 guide id，因此显式允许透明背景场景；Image dock 继续使用真实模型能力。
- 可选 I4、I6 未纳入本次合并阻断修复，避免扩大 PR 范围。

## Verification

- `pnpm --filter @lnkpi/shared test` — 24 files / 139 tests passed。
- 指定 Web Vitest 命令 — 11 files / 44 tests passed。
- 新增 `MentionInput` 回归测试随扩展 Web 验证通过；扩展合计 12 files / 45 tests passed。
- `python3 -m pytest tests/test_guide_taxonomy.py -v`（项目 `.venv`）— 18 passed，1 条既有 Pydantic deprecation warning。
- `cmp` 两份 taxonomy YAML — 返回 0。
- `git diff --check` — 返回 0。
- `pnpm build` — 返回 0；仅有既有 Rollup chunk-size / PURE annotation warnings。

Commit: `fix(web): guide picker placement, Esc nesting, taxonomy priority`
PR: #279（同一分支更新）
