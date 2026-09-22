import type { Component } from 'vue'
import RefineDock from '@/components/canvas/refine/RefineDock.vue'
import RefineSelectPanel from '@/components/canvas/refine/RefineSelectPanel.vue'
import OutpaintPanel from '@/components/canvas/refine/OutpaintPanel.vue'
import RefineOutpaintDock from '@/components/canvas/refine/RefineOutpaintDock.vue'
import MattingPanel from '@/components/canvas/refine/MattingPanel.vue'
import MattingDock from '@/components/canvas/refine/MattingDock.vue'
import type { RefineMode } from '@/stores/canvasEditor'

/** 左栏图标描述（一级工具的 railItems；本期 select 的图标仍由 RefineToolRail 现行实现承担）。 */
export interface RailItemDescriptor {
  id: string
  label: string
  disabled?: boolean
  hint?: string
}

/**
 * 工具注册契约（spec §4）。**不注册就没有 UI**：右栏滚动区只渲染当前激活工具的 `panel`。
 *
 * - `dock`：产出型工具必填；确定性变换工具为 null（动作按钮归面板底部）。
 * - `dockPlacement`：就近原则 —— 操作焦点在画布取 'floating'，在文本/参数取 'panel'。
 */
export interface WorkbenchToolRegistration {
  id: string
  railItems?: RailItemDescriptor[]
  panel: Component
  dock: Component | null
  dockPlacement: 'panel' | 'floating'
}

export const WORKBENCH_TOOL_REGISTRY: Record<string, WorkbenchToolRegistration> = {
  'refine-select': {
    id: 'refine-select',
    panel: RefineSelectPanel,
    dock: RefineDock,
    dockPlacement: 'panel',
  },
  'refine-outpaint': {
    id: 'refine-outpaint',
    panel: OutpaintPanel,
    dock: RefineOutpaintDock,
    dockPlacement: 'floating',
  },
  'refine-matting': {
    id: 'refine-matting',
    panel: MattingPanel,
    dock: MattingDock,
    dockPlacement: 'panel',
  },
}

/** 查注册项；未注册返回 null（调用方据此不渲染面板 / dock）。 */
export function getWorkbenchTool(id: string | null | undefined): WorkbenchToolRegistration | null {
  if (!id) return null
  return WORKBENCH_TOOL_REGISTRY[id] ?? null
}

/** 精修工作区模式 → 一级工具 id。 */
export function toolIdForRefineMode(mode: RefineMode): string {
  return mode === 'outpaint' ? 'refine-outpaint' : 'refine-select'
}
