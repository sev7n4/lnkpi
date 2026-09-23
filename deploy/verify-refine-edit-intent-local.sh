#!/usr/bin/env bash
# Local automated verification for Refine edit-intent templates (Catalog Fill).
# Covers: catalog E1–E8 assets, fill/submit gates, picker disable, popover Esc.
# 2026-09-23：picker 迁至 dock-studio 后重写 check 3)（原断言在新实现上恒 0 命中），并去掉 ripgrep 依赖。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
record() {
  local ok="$1" case="$2" detail="${3:-}"
  if [[ "$ok" == "1" ]]; then
    PASS=$((PASS + 1))
    echo "✅ $case${detail:+ — $detail}"
  else
    FAIL=$((FAIL + 1))
    echo "❌ $case${detail:+ — $detail}"
  fi
}

echo "=== Refine edit-intent local verify ==="
echo "cwd=$ROOT"
echo

# 1) Shared catalog + resolve gates
if pnpm --filter @lnkpi/shared exec vitest run \
  src/imagePromptingGuide/catalog.test.ts \
  src/imagePromptingGuide/resolveGuideRequest.test.ts
then
  record 1 "shared catalog + resolveGuideRequest tests"
else
  record 0 "shared catalog + resolveGuideRequest tests"
fi

# 1b) Explicit E1–E8 templates + E5/E7 gates (temp vitest file, cleaned up)
TMP_TEST="$ROOT/packages/shared/src/imagePromptingGuide/_refineVerify.tmp.test.ts"
cleanup() { rm -f "$TMP_TEST"; }
trap cleanup EXIT
cat > "$TMP_TEST" <<'TS'
import { describe, expect, it } from 'vitest'
import { getEditIntent, listEditIntents } from './catalog'
import { defaultGuideCapabilities, resolveGuideRequest } from './resolveGuideRequest'

describe('refine edit-intent catalog fill verify', () => {
  const expected = [
    'e1_translate_layout',
    'e2_style_transfer',
    'e3_identity_clothing',
    'e4_combine_refs',
    'e5_transparent_cutout',
    'e6_drawing_to_realistic',
    'e7_remove_object',
    'e8_insert_person',
  ]
  it('registers all eight edit intents with templates', () => {
    expect(listEditIntents().map((i) => i.id).sort()).toEqual([...expected].sort())
    for (const id of expected) {
      const intent = getEditIntent(id)
      expect(intent, id).toBeTruthy()
      expect(intent!.changePreserveTemplate.trim().length).toBeGreaterThan(10)
      expect(intent!.groupId).toBeTruthy()
      expect(intent!.label.trim().length).toBeGreaterThan(0)
    }
  })
  it('gates E5 without transparent; allows E7', () => {
    const caps = defaultGuideCapabilities()
    expect(caps.transparentBackground).toBe(false)
    const e5 = getEditIntent('e5_transparent_cutout')!
    expect(resolveGuideRequest({ guide: e5, capabilities: caps, refImageCount: 1 }).blocked).toBeTruthy()
    const e7 = getEditIntent('e7_remove_object')!
    expect(resolveGuideRequest({ guide: e7, capabilities: caps, refImageCount: 1 }).blocked).toBeFalsy()
  })
})
TS
if pnpm --filter @lnkpi/shared exec vitest run src/imagePromptingGuide/_refineVerify.tmp.test.ts
then
  record 1 "E1–E8 templates + E5/E7 capability gates"
else
  record 0 "E1–E8 templates + E5/E7 capability gates"
fi
cleanup
trap - EXIT

# 2) Web unit tests for apply/disable/popover
if pnpm --filter @lnkpi/web exec vitest run \
  src/components/canvas/refine/guideEditIntentApply.test.ts \
  src/components/canvas/dock-studio/shared/guidePickerDisable.test.ts \
  src/components/canvas/dock-studio/shared/GuidePickerPopover.test.ts
then
  record 1 "web vitest apply/disable/popover"
else
  record 0 "web vitest apply/disable/popover"
fi

# 3) Source wiring smoke — 2026-09-23 语义迁移后的现状断言。
#    迁移前：picker 内嵌在 RefineSidePanel，面板自带污渍/替换预设，断言 mode="edit_intent" 等 4 串。
#    迁移后：picker 移到 dock-studio/shared，由 RefineSidePanel 把 edit intent 下传 RefineDock 渲染；
#    污渍/替换预设链路已下线（见 #404）。原断言在新实现上恒为 0 命中，故按现状重写。
#    同时原实现依赖 ripgrep（`rg` 缺失时该 check 必然 FAIL），改为 grep -F 固定串、断言全用 ASCII 标识符。
PANEL="$ROOT/apps/web/src/components/canvas/refine/RefineSidePanel.vue"
DOCK="$ROOT/apps/web/src/components/canvas/refine/RefineDock.vue"
PICKER="$ROOT/apps/web/src/components/canvas/dock-studio/shared/GuidePickerPopover.vue"
WIRING_OK=0
if grep -qF 'applyGuideEditIntent' "$PANEL" \
  && grep -qF 'activeGuideEditIntentId' "$PANEL" \
  && grep -qF '@select-edit-intent="applyEditIntent"' "$PANEL" \
  && grep -qF '@clear-edit-intent="clearEditIntent"' "$PANEL" \
  && grep -qF 'editIntentDisabledReason' "$PANEL" \
  && grep -qF 'GuidePickerPopover' "$DOCK" \
  && ! grep -qF 'GuidePickerPopover' "$PANEL" \
  && ! grep -qF 'v-for="intent in editIntents"' "$PANEL" \
  && ! grep -qF 'applyStainPreset' "$PANEL"
then
  WIRING_OK=1
fi
if [[ "$WIRING_OK" == "1" && -f "$PICKER" ]]
then
  record 1 "RefineSidePanel wiring (intent 下传 RefineDock 渲染 picker；预设链路已下线；无 flat E chips)"
else
  record 0 "RefineSidePanel wiring (intent 下传 RefineDock 渲染 picker；预设链路已下线；无 flat E chips)"
fi

echo
echo "PASS=$PASS FAIL=$FAIL"
exit "$([[ "$FAIL" -eq 0 ]] && echo 0 || echo 1)"
