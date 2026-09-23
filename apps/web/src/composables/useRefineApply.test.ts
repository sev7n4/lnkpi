import { describe, expect, it, vi } from 'vitest'
import { applyRefineAsChild, type RefineApplyAsChildInput } from './useRefineApply'
import { containFitSize } from '@/utils/centerExpand'

/** 复刻 CanvasPage 的 addNode 包装：注入 prompt/imageModel 默认值（brief Step 5）。 */
function makeWrappedAddNode() {
  let n = 0
  const calls: Array<{ data: Record<string, unknown>; opts?: Record<string, unknown> }> = []
  const addNode = vi.fn((_type: 'image', data: Record<string, unknown>, opts?: Record<string, unknown>) => {
    n += 1
    const id = `node-${n}`
    calls.push({ data: { prompt: '', imageModel: 'test-image-model', ...data }, opts })
    return id
  })
  return { addNode, calls }
}

describe('applyRefineAsChild', () => {
  const sourceNode = { id: 'src-1', position: { x: 100, y: 200 } }

  it('首次应用：新建下游节点 + 连边，携带 appliedKey 与 recordId', () => {
    const { addNode, calls } = makeWrappedAddNode()
    const addEdge = vi.fn()
    const findAppliedNode = vi.fn(() => undefined)

    const res = applyRefineAsChild({
      sourceNode,
      result: {
        url: 'https://x/r.png',
        prompt: '去背景',
        recordId: 'rec-9',
        appliedKey: 'matting:https://x/r.png',
      },
      addNode,
      addEdge,
      findAppliedNode,
    })

    expect(res.created).toBe(true)
    expect(res.nodeId).toBe('node-1')
    expect(addNode).toHaveBeenCalledTimes(1)
    expect(addEdge).toHaveBeenCalledTimes(1)

    const data = calls[0].data
    expect(data.url).toBe('https://x/r.png')
    expect(data.prompt).toBe('去背景')
    expect(data.generationRecordId).toBe('rec-9')
    expect(data.status).toBe('completed')
    expect(data.appliedKey).toBe('matting:https://x/r.png')
    expect(data.imageModel).toBe('test-image-model')
    const versions = data.imageVersions as Array<{ url: string; source: string }>
    expect(versions).toHaveLength(1)
    expect(versions[0].url).toBe('https://x/r.png')

    // 连边：源 → 新节点
    expect(addEdge).toHaveBeenCalledWith({
      id: 'e-src-1-node-1',
      source: 'src-1',
      target: 'node-1',
    })

    // position：源右侧偏移 40px，纵向对齐源 top
    expect(calls[0].opts?.position).toEqual({ x: 140, y: 200 })
  })

  it('重复应用同 appliedKey：不新建，返回已有节点（幂等）', () => {
    const { addNode } = makeWrappedAddNode()
    const addEdge = vi.fn()
    const findAppliedNode = vi.fn(() => ({ id: 'existing-7' }))

    const res = applyRefineAsChild({
      sourceNode,
      result: {
        url: 'https://x/r.png',
        prompt: '去背景',
        recordId: 'rec-9',
        appliedKey: 'matting:https://x/r.png',
      },
      addNode,
      addEdge,
      findAppliedNode,
    })

    expect(res).toEqual({ nodeId: 'existing-7', created: false })
    expect(addNode).not.toHaveBeenCalled()
    expect(addEdge).not.toHaveBeenCalled()
  })

  it('扩图结果 nodeSize 按 outpaintTo contain-fit 进 280 框', () => {
    const { addNode, calls } = makeWrappedAddNode()
    const addEdge = vi.fn()
    const findAppliedNode = vi.fn(() => undefined)

    const outpaintTo = { width: 560, height: 280 }
    const expected = containFitSize({ width: 280, height: 280 }, outpaintTo)

    applyRefineAsChild({
      sourceNode,
      result: {
        url: 'https://x/out.png',
        prompt: '扩图',
        appliedKey: 'rec-out',
        nodeSize: expected,
      },
      addNode,
      addEdge,
      findAppliedNode,
    })

    expect(calls[0].data.nodeSize).toEqual(expected)
    // scale = min(280/560, 280/280) = 0.5 → { width: 280, height: 140 }
    expect(expected).toEqual({ width: 280, height: 140 })
  })

  it('不修改源节点：函数对 sourceNode 无 data 写回路径（结构性保证）', () => {
    const { addNode } = makeWrappedAddNode()
    const addEdge = vi.fn()
    // 冻结源节点，任何写回都会抛错；同时断言 position 未被改动
    const frozenSource = Object.freeze({
      id: 'src-1',
      position: Object.freeze({ x: 100, y: 200 }),
    })

    const res = applyRefineAsChild({
      sourceNode: frozenSource as unknown as RefineApplyAsChildInput['sourceNode'],
      result: {
        url: 'https://x/r.png',
        prompt: '去背景',
        recordId: 'rec-9',
        appliedKey: 'matting:https://x/r.png',
      },
      addNode,
      addEdge,
      findAppliedNode: vi.fn(() => undefined),
    })

    // 源节点 identity 与 position 完全未被触碰
    expect(res.created).toBe(true)
    expect(frozenSource.position).toEqual({ x: 100, y: 200 })
    expect(frozenSource.id).toBe('src-1')

    // sourceNode 类型仅含 { id, position }，刻意不含 data/url —— 类型层面排除写回；
    // 且本函数从未对 sourceNode 做属性赋值（无 patch 调用），仅只读派生新节点 position。
    expect(Object.keys(frozenSource)).toEqual(['id', 'position'])
  })
})
