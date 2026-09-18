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


  it('通过 parentNode 路径展开 group 子节点（无 data.childIds）', () => {
    // spec v3 §4.3 #1: getGroupChildIds 同时覆盖 data.childIds 和 parentNode 链路
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['group-1'],
      canvas: {
        nodes: [
          { id: 'group-1', type: 'group', data: {} }, // 无 childIds
          { id: 'img-1', type: 'image', parentNode: 'group-1', data: {} },
          { id: 'img-2', type: 'image', parentNode: 'group-1', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    // group-1 自身进 skip (unsupported_type)
    expect(result.skip.find(s => s.nodeId === 'group-1')?.reason).toBe('unsupported_type')
    // 通过 parentNode 链路找到子节点，进 run
    expect(result.groupExpanded).toContainEqual({ groupId: 'group-1', childIds: ['img-1', 'img-2'] })
    expect(result.run).toEqual(['img-1', 'img-2'])
  })
})

describe('planner: 状态过滤', () => {
  it('pending_confirm 整批拒绝（任一即抛错）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'i-2'],
      canvas: {
        nodes: [
          { id: 'i-1', type: 'image', data: { status: 'pending_confirm' } },
          { id: 'i-2', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchPendingConfirmError)
  })

  it('fallback_pending 进 skip，不弹确认框', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1'],
      canvas: { nodes: [{ id: 'i-1', type: 'image', data: { status: 'fallback_pending' } }], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip[0]?.reason).toBe('fallback_pending')
  })

  it('24 + 1 = 抛 SelectionBatchLimitError', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i}`,
      type: 'image' as const,
      data: {},
    }))
    const input: PlanSelectionGenerateInput = {
      selectedIds: nodes.map(n => n.id),
      canvas: { nodes, edges: [] },
      hasUsableOutput: () => false,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchLimitError)
  })

  it('isInFlight 节点 + 下游：in-flight 节点 skip in_flight，下游 skip upstream_in_flight', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['p-1', 'i-1', 'v-1'],
      canvas: {
        nodes: [
          { id: 'p-1', type: 'prompt', data: {} },
          { id: 'i-1', type: 'image', data: {} },
          { id: 'v-1', type: 'video', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'p-1', target: 'i-1' },
          { id: 'e2', source: 'i-1', target: 'v-1' },
        ],
      },
      hasUsableOutput: () => false,
      isInFlight: (id) => id === 'i-1',
    }
    const result = planSelectionGenerate(input)
    expect(result.skip.find(s => s.nodeId === 'i-1')?.reason).toBe('in_flight')
    expect(result.skip.find(s => s.nodeId === 'v-1')?.reason).toBe('upstream_in_flight')
    // p-1 入度 0，仍可跑
    expect(result.run).toContain('p-1')
    expect(result.run).not.toContain('v-1')
  })
})
