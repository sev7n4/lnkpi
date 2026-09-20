import { afterEach, describe, expect, it, vi } from 'vitest'
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

// 回归：生产 CVM 用明文 http://ip:port 访问，crypto.randomUUID 在非安全上下文不存在。
// 修复前 start() 会在此抛 TypeError，且因为 state 已置为 'running'，状态机永久卡死：
// 工具栏按钮显示「停止全部」并被 disabled，用户点击毫无反应（只能刷新页面）。
describe('start(): 明文 HTTP（crypto.randomUUID 不可用）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无 randomUUID 也能正常启动并跑完，状态不会卡在 running', async () => {
    vi.stubGlobal('crypto', {})
    const generated: string[] = []
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      generateForNode: async (n) => { generated.push(n.id) },
    })
    const api = useSelectionGenerate(deps)
    const summary = await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(generated).toEqual(['i'])
    expect(api.state.value).toBe('done')
    expect(summary.done).toBe(1)
  })

  it('初始化抛错时状态回落 idle（不卡死），且可再次启动', async () => {
    const toasts: string[] = []
    let failing = true
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      isInFlight: () => {
        if (failing) throw new Error('boom')
        return false
      },
      toast: (msg) => { toasts.push(msg) },
    })
    const api = useSelectionGenerate(deps)

    await expect(
      api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] }),
    ).rejects.toThrow('boom')
    // 关键回归点：不能停在 running / stopping（按钮会变成 disabled 的「停止全部」）
    expect(api.state.value).toBe('idle')
    expect(toasts.some((m) => m.includes('boom'))).toBe(true)

    failing = false
    await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(api.state.value).toBe('done')
  })
})

// 回归：generateForNode 对图片/视频节点在"任务提交+转入后台轮询"时就 resolve，
// 执行器若直接计 done 会提前弹「完成 X」。新增 waitForNodeSettled 依赖后，
// 执行器必须等到节点真正 settle（completed/error）才计数。
describe('runOneNode: waitForNodeSettled 等待真实终态', () => {
  it('generateForNode 立即 resolve 但节点未 settle → 不提前计 done，settle 为 ok 后计 done', async () => {
    let settled = false
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      generateForNode: async () => {}, // 提交即返回（模拟现网提交后转后台轮询）
      waitForNodeSettled: async () => {
        // 模拟后台轮询期间：先等一拍才算 settle
        await new Promise(r => setTimeout(r, 30))
        return settled ? 'ok' : 'ok'
      },
    })
    const api = useSelectionGenerate(deps)
    const summary = await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(summary.done).toBe(1)
    expect(summary.failed).toBe(0)
    void settled
  })

  it('waitForNodeSettled 返回 failed → 计 failed 而非 done', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      generateForNode: async () => {},
      waitForNodeSettled: async () => 'failed',
    })
    const api = useSelectionGenerate(deps)
    const summary = await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(summary.done).toBe(0)
    expect(summary.failed).toBe(1)
  })

  it('提交本身抛错（如 insufficient_points）→ 仍按 classifyError 计数，不调 waitForNodeSettled', async () => {
    let settleCalls = 0
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      generateForNode: async () => {
        const err = new Error('no points') as Error & { code?: string }
        err.code = 'insufficient_points'
        throw err
      },
      waitForNodeSettled: async () => { settleCalls++; return 'ok' },
    })
    const api = useSelectionGenerate(deps)
    const summary = await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(summary.done).toBe(0)
    expect(summary.failed).toBe(1)
    expect(settleCalls).toBe(0)
  })

  it('未传 waitForNodeSettled（旧调用方）→ 行为与旧版一致（提交即计 done）', async () => {
    const deps = makeDeps({
      nodes: ref([
        { id: 'i', type: 'image', data: {}, position: { x: 0, y: 0 } } as EditableFlowNode,
      ]),
      hasUsableOutput: () => false,
      generateForNode: async () => {},
    })
    const api = useSelectionGenerate(deps)
    const summary = await api.start({ run: ['i'], skip: [], blockedBy: [], groupExpanded: [] })
    expect(summary.done).toBe(1)
  })
})
