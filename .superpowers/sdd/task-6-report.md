# Task 6 Report
Status: 完成 Prompt/Image Dock 场景图标选择器接入，移除平铺场景 chips，并隐藏标题栏关闭按钮。
Commit: `feat(web): Prompt/Image dock scene icon picker`（本提交）
Tests: `guideSceneApply.test.ts` 3/3 通过；`pnpm build` 通过。
Capabilities: Prompt 使用默认能力；Image 按当前模型 profile 解析，Image2 保持 `transparentBackground: false`。
Concerns: 无；未修改 RefineSidePanel，未 push。
Report: `.superpowers/sdd/task-6-report.md`

## Fix: Esc nested focus (spec §1.3)

**Problem:** `GuidePickerPopover` 仅在根元素 `@keydown.escape` 处理 Esc，焦点不在 popover 内时 Esc 会冒泡到 `DockStudioToolbar` 的 window listener，直接关闭整个 dock。

**Fix:**
- `GuidePickerPopover.vue`：`open=true` 时注册 window **capture-phase** Esc listener，调用 `preventDefault` / `stopPropagation` / `stopImmediatePropagation` 后 emit `close`；`open=false` 与 `onUnmounted` 时注销。
- `DockStudioToolbar.vue`：`handleDockEscape` 增加 `event.defaultPrevented` 早退作为双保险。

**Tests:** `DockStudioToolbar.test.ts` 4/4、`GuidePickerPopover.test.ts` 2/2 通过（含 defaultPrevented 与无焦点 Esc 场景）。
Commit: `fix(web): Esc closes guide picker before dock`
