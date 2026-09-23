import { describe, expect, it } from 'vitest'
// 真实注册表位于 components/canvas/workbench/workbenchToolRegistry.ts（brief 的 refine/ 路径为旧假设，
// RefineSidePanel 实际从 workbench/ 引入 getWorkbenchTool）。本测试文件按 brief 给定的测试命令置于 refine/。
import { getWorkbenchTool } from '@/components/canvas/workbench/workbenchToolRegistry'

describe('workbenchToolRegistry', () => {
  it('refine-matting 已注册且为 panel 落位', () => {
    const tool = getWorkbenchTool('refine-matting')
    expect(tool?.panel).toBeTruthy()
    expect(tool?.dockPlacement).toBe('panel')
  })

  it('refine-matting 带 dock 组件（MattingDock）', () => {
    const tool = getWorkbenchTool('refine-matting')
    expect(tool?.dock).toBeTruthy()
  })

  it('refine-crop 已注册：确定性变换（dock: null）+ panel 落位', () => {
    const tool = getWorkbenchTool('refine-crop')
    expect(tool).not.toBeNull()
    expect(tool?.panel).toBeTruthy()
    expect(tool?.dock).toBeNull()
    expect(tool?.dockPlacement).toBe('panel')
  })
})
