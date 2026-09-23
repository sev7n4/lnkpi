import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_TOOL_REGISTRY,
  getWorkbenchTool,
  toolIdForRefineMode,
} from './workbenchToolRegistry'

describe('workbenchToolRegistry', () => {
  it('注册了精修 select 与扩图两个一级工具，且三件套齐全', () => {
    for (const id of ['refine-select', 'refine-outpaint']) {
      const tool = getWorkbenchTool(id)
      expect(tool, id).not.toBeNull()
      expect(tool!.id).toBe(id)
      expect(tool!.panel).toBeTruthy()
    }
  })

  it('产出型工具的 dock 判据（§4.2）：两个精修工具都有 dock', () => {
    expect(getWorkbenchTool('refine-select')!.dock).toBeTruthy()
    expect(getWorkbenchTool('refine-outpaint')!.dock).toBeTruthy()
  })

  it('落点就近原则：select = panel（焦点在提示词），outpaint = floating（焦点在画布）', () => {
    expect(getWorkbenchTool('refine-select')!.dockPlacement).toBe('panel')
    expect(getWorkbenchTool('refine-outpaint')!.dockPlacement).toBe('floating')
  })

  it('未注册 id → null（不注册就没有 UI）', () => {
    expect(getWorkbenchTool('not-registered')).toBeNull()
    expect(getWorkbenchTool(null)).toBeNull()
    expect(getWorkbenchTool(undefined)).toBeNull()
  })

  it('refineMode → 工具 id 映射', () => {
    expect(toolIdForRefineMode('select')).toBe('refine-select')
    expect(toolIdForRefineMode('outpaint')).toBe('refine-outpaint')
    expect(toolIdForRefineMode('matting')).toBe('refine-matting')
    expect(toolIdForRefineMode('crop')).toBe('refine-crop')
  })

  it('refine-crop 已注册：确定性变换（dock: null）+ panel 落位', () => {
    const tool = getWorkbenchTool('refine-crop')
    expect(tool).not.toBeNull()
    expect(tool!.panel).toBeTruthy()
    expect(tool!.dock).toBeNull()
    expect(tool!.dockPlacement).toBe('panel')
  })

  it('注册表自身的完整性：每个注册项的 dockPlacement 取值合法', () => {
    for (const tool of Object.values(WORKBENCH_TOOL_REGISTRY)) {
      expect(['panel', 'floating']).toContain(tool.dockPlacement)
    }
  })
})
