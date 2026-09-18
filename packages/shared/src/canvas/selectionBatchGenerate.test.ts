/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  SelectionBatchLimitError,
  SelectionBatchPendingConfirmError,
  planSelectionGenerate,
  type PlanSelectionGenerateInput,
  type PlanSelectionGenerateResult,
  type SkipReason,
} from './selectionBatchGenerate'
import { getGroupChildIds } from './groupChildIds'

describe('planner entry types', () => {
  it('exports the entry function and error classes', () => {
    expect(typeof planSelectionGenerate).toBe('function')
    expect(SelectionBatchLimitError).toBeDefined()
    expect(SelectionBatchPendingConfirmError).toBeDefined()
  })
})

describe('planner: no candidates', () => {
  it('returns empty run/skip for empty selectedIds', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: [],
      canvas: { nodes: [], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip).toEqual([])
    expect(result.blockedBy).toEqual([])
  })
})

describe('planner: 选区展开', () => {
  it('跳过 group 自身，把子节点并入候选', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['group-1'],
      canvas: {
        nodes: [
          { id: 'group-1', type: 'group', data: { childIds: ['img-1', 'img-2'] } },
          { id: 'img-1', type: 'image', data: { url: 'https://x/1.png' } },
          { id: 'img-2', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: (n) => !!n.data?.url,
    }
    const result = planSelectionGenerate(input)
    // img-1 已 done 走 skip already_done；img-2 走 run
    expect(result.groupExpanded).toContainEqual({ groupId: 'group-1', childIds: ['img-1', 'img-2'] })
    expect(result.run).toContain('img-2')
    expect(result.skip.find(s => s.nodeId === 'img-1')?.reason).toBe('already_done')
    expect(result.skip.find(s => s.nodeId === 'group-1')?.reason).toBe('unsupported_type')
  })

  it('unsupported 类型（mediaInput/sceneComposer/videoComposition/worldModel）进 skip', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['m-1', 'sc-1', 'vc-1', 'wm-1', 'i-1'],
      canvas: {
        nodes: [
          { id: 'm-1', type: 'mediaInput', data: {} },
          { id: 'sc-1', type: 'sceneComposer', data: {} },
          { id: 'vc-1', type: 'videoComposition', data: {} },
          { id: 'wm-1', type: 'worldModel', data: {} },
          { id: 'i-1', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.skip.find(s => s.nodeId === 'm-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'sc-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'vc-1')?.reason).toBe('unsupported_type')
    expect(result.skip.find(s => s.nodeId === 'wm-1')?.reason).toBe('unsupported_type')
    expect(result.run).toEqual(['i-1'])
  })
})
