import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useSelectionGenerate, type UseSelectionGenerateDeps } from './useSelectionGenerate'
import type { CanvasEdgeLike } from './useUpstreamNodeContext'
import type { EditableFlowNode } from './useSelectedNodeEditor'

function makeDeps(overrides?: Partial<UseSelectionGenerateDeps>): UseSelectionGenerateDeps {
  return {
    nodes: ref([]),
    edges: ref([]),
    generateForNode: async () => {},
    hasUsableOutput: () => false,
    resolveUpstreamIds: () => [],
    cancelGeneration: () => {},
    isInFlight: () => false,
    toast: () => {},
    ...overrides,
  }
}

describe('useSelectionGenerate entry', () => {
  it('exports useSelectionGenerate factory', () => {
    expect(typeof useSelectionGenerate).toBe('function')
  })

  it('initial state is idle and progress zero', () => {
    const api = useSelectionGenerate(makeDeps())
    expect(api.state.value).toBe('idle')
    expect(api.progress.value).toMatchObject({
      done: 0, failed: 0, cancelled: 0, timeout: 0, skipped: 0, total: 0,
      abortReason: 'none',
    })
  })
})

describe('start(): initialization', () => {
  it('构建 waitingMap：链 p→i 选中，p 入 queue、i 入 waiting', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'p', type: 'prompt', data: { content: 'x' }, position: { x: 0, y: 0 } } as EditableFlowNode,
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      edges: ref([{ id: 'e1', source: 'p', target: 'i' }] as CanvasEdgeLike[]),
      hasUsableOutput: () => false,
    })
    const api = useSelectionGenerate(deps)
    const result = await api.start({ run: ['p', 'i'], skip: [], blockedBy: [], groupExpanded: [] })
    // p ok 一次后 done = 1；i 缺上游也跑（因为 hasUsableOutput 假）
    // 这里只验证"不崩、最终 state=done"
    expect(api.state.value).toBe('done')
    expect(result.abortReason).toBe('none')
  })

  it('节点消失（deps.nodes 缺 id）→ 计入 skipped，不崩', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
        // 'ghost' 不在 nodes 里
      ]),
      hasUsableOutput: () => false,
    })
    const api = useSelectionGenerate(deps)
    await api.start({ run: ['i', 'ghost'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(api.state.value).toBe('done')
    expect(api.progress.value.skipped).toBeGreaterThanOrEqual(1)
  })

  it('isInFlight 的节点 + 下游：in-flight 节点 skip，下游在 executor 端报 upstream_in_flight', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
        { id: 'v', type: 'video', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      edges: ref([{ id: 'e1', source: 'i', target: 'v' }] as CanvasEdgeLike[]),
      hasUsableOutput: () => false,
      isInFlight: (id) => id === 'i',
    })
    const api = useSelectionGenerate(deps)
    // 直接传 plan：i 已在跑 → planner 不会进 run（Task 5）；这里模拟 plan 已包含 i
    // 执行器侧需要再判一遍：i 不在 queue，但选了 v
    await api.start({ run: ['i', 'v'], skip: [], blockedBy: [], groupExpanded: [] })
    // i 在 batch 启动时还在飞 → 仍记 in_flight skip（与 planner 一致）
    // v 的上游 i 还在飞 → upstream_in_flight
    expect(api.progress.value.skipped).toBeGreaterThanOrEqual(2)
  })
})
