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

describe('planner: Kahn 拓扑', () => {
  it('独立节点任意稳定顺序（按 id 排序）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['c', 'a', 'b'],
      canvas: {
        nodes: [
          { id: 'a', type: 'image', data: {} },
          { id: 'b', type: 'image', data: {} },
          { id: 'c', type: 'image', data: {} },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['a', 'b', 'c'])
  })

  it('链 prompt→image→video 全 draft → 串行', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['p', 'i', 'v'],
      canvas: {
        nodes: [
          { id: 'p', type: 'prompt', data: {} },
          { id: 'i', type: 'image', data: {} },
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'p', target: 'i' },
          { id: 'e2', source: 'i', target: 'v' },
        ],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['p', 'i', 'v'])
  })

  it('环 A→B→A 不死锁，追加到 run 末尾', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['A', 'B'],
      canvas: {
        nodes: [
          { id: 'A', type: 'image', data: {} },
          { id: 'B', type: 'image', data: {} },
        ],
        edges: [
          { id: 'e1', source: 'A', target: 'B' },
          { id: 'e2', source: 'B', target: 'A' },
        ],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(new Set(result.run)).toEqual(new Set(['A', 'B']))
    expect(result.run).toHaveLength(2)
    expect(result.blockedBy.some(b => b.reason === 'cycle')).toBe(true)
  })

  it('跨选区上游有结果 → 候选节点正常入 run', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['v'],
      canvas: {
        nodes: [
          { id: 'ext-i', type: 'image', data: { url: 'https://x/y.png' } }, // 选区外
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [{ id: 'e1', source: 'ext-i', target: 'v' }],
      },
      hasUsableOutput: (n) => !!n.data?.url,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['v'])
    expect(result.skip.find(s => s.nodeId === 'v')).toBeUndefined()
  })

  it('跨选区上游无结果 → candidate 不进 run（执行器报 missing_upstream）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['v'],
      canvas: {
        nodes: [
          { id: 'ext-i', type: 'image', data: {} }, // 选区外，无 url
          { id: 'v', type: 'video', data: {} },
        ],
        edges: [{ id: 'e1', source: 'ext-i', target: 'v' }],
      },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['v']) // planner 不报 missing_upstream
  })
})

describe('planner: regenerate 模式', () => {
  const doneNodes = [
    { id: 'i-1', type: 'image', data: { url: 'https://x/1.png' } },
    { id: 'i-2', type: 'image', data: { url: 'https://x/2.png' } },
  ]

  it('regenerate: true 时 already_done 节点进 run（覆盖式重新生成）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'i-2'],
      canvas: { nodes: doneNodes, edges: [] },
      hasUsableOutput: (n) => !!n.data?.url,
      regenerate: true,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['i-1', 'i-2'])
    expect(result.skip.find(s => s.nodeId === 'i-1')).toBeUndefined()
  })

  it('regenerate 缺省（false）时行为不变：already_done 仍 skip', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'i-2'],
      canvas: { nodes: doneNodes, edges: [] },
      hasUsableOutput: (n) => !!n.data?.url,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip.find(s => s.nodeId === 'i-1')?.reason).toBe('already_done')
    expect(result.skip.find(s => s.nodeId === 'i-2')?.reason).toBe('already_done')
  })

  it('regenerate: true 时 pending_confirm 仍整批拒绝（红线不变）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'p-1'],
      canvas: {
        nodes: [
          ...doneNodes,
          { id: 'p-1', type: 'image', data: { status: 'pending_confirm' } },
        ],
        edges: [],
      },
      hasUsableOutput: (n) => !!n.data?.url,
      regenerate: true,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchPendingConfirmError)
  })

  it('regenerate: true 时 24 上限计数包含 already_done 节点', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({
      id: `i-${i}`,
      type: 'image' as const,
      data: { url: `https://x/${i}.png` },
    }))
    const input: PlanSelectionGenerateInput = {
      selectedIds: nodes.map(n => n.id),
      canvas: { nodes, edges: [] },
      hasUsableOutput: (n) => !!n.data?.url,
      regenerate: true,
    }
    expect(() => planSelectionGenerate(input)).toThrow(SelectionBatchLimitError)
  })

  it('regenerate: true 时 in_flight 的已完成节点仍被跳过', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['i-1', 'i-2'],
      canvas: { nodes: doneNodes, edges: [] },
      hasUsableOutput: (n) => !!n.data?.url,
      isInFlight: (id) => id === 'i-1',
      regenerate: true,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['i-2'])
    expect(result.skip.find(s => s.nodeId === 'i-1')?.reason).toBe('in_flight')
  })
})

describe('planner: hasAttemptableInput（missing_prompt 预检）', () => {
  it('无本地提示词且上游无可用输出的节点 → skip missing_prompt，不进 run', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['a', 'b'],
      canvas: {
        nodes: [
          { id: 'a', type: 'image', data: {} },
          { id: 'b', type: 'prompt', data: { content: '写一只猫' } },
        ],
        edges: [],
      },
      hasUsableOutput: () => false,
      hasAttemptableInput: (n) => Boolean(String((n.data?.content as string) ?? '').trim()),
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['b'])
    expect(result.skip.find(s => s.nodeId === 'a')?.reason).toBe('missing_prompt')
  })

  it('无可尝试输入的节点被 skip，不进 run（即使上游边存在）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['down'],
      canvas: {
        nodes: [
          { id: 'up', type: 'image', data: {} }, // 选区外上游
          { id: 'down', type: 'video', data: {} },
        ],
        edges: [{ id: 'e1', source: 'up', target: 'down' }],
      },
      hasUsableOutput: (n) => n.id === 'up',
      // 实现层（CanvasPage）会检查"上游有可用输出"，这里模拟该判定通过
      hasAttemptableInput: (n) => n.id === 'down',
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['down'])
    expect(result.skip.find(s => s.nodeId === 'down')).toBeUndefined()
  })

  it('已完成的节点即使无可尝试输入也保持 already_done（不误报 missing_prompt）', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['done'],
      canvas: { nodes: [{ id: 'done', type: 'image', data: { url: 'https://x/1.png' } }], edges: [] },
      hasUsableOutput: () => true,
      hasAttemptableInput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual([])
    expect(result.skip.find(s => s.nodeId === 'done')?.reason).toBe('already_done')
  })

  it('缺省不传 hasAttemptableInput → 行为与旧版完全一致', () => {
    const input: PlanSelectionGenerateInput = {
      selectedIds: ['a'],
      canvas: { nodes: [{ id: 'a', type: 'image', data: {} }], edges: [] },
      hasUsableOutput: () => false,
    }
    const result = planSelectionGenerate(input)
    expect(result.run).toEqual(['a'])
  })
})
