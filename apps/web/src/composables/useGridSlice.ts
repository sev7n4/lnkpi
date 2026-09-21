import { studioApi } from '@/services/studio-api'
import { clampGridDims } from '@/utils/gridSlice'

export type GridSliceNode = {
  id: string
  data?: Record<string, unknown>
}

export type ImageSliceApiResult = {
  urls: string[]
  cols: number
  rows: number
  width?: number
  height?: number
}

export type SliceApiFn = (args: {
  sourceUrl: string
  cols: number
  rows: number
  sessionId: string
}) => Promise<ImageSliceApiResult>

export type SliceNotifyAction = {
  label: string
  onClick: () => void
}

export type RunGridSliceInput = {
  sourceUrl: string
  cols: number
  rows: number
  sessionId: string
  sourceNodeId: string
  getSourceNode: () => GridSliceNode | undefined
  addNode: (
    type: string,
    data: Record<string, unknown>,
    opts?: { id?: string; position?: { x: number; y: number } },
  ) => string
  addEdge: (edge: { id: string; source: string; target: string }) => void
  layoutChildren: (childIds: string[]) => void
  /** 撤回切分时移除单个子节点（实现方需连带清理关联边） */
  removeNode?: (id: string) => void
  /** 按 id 反查画布节点，供撤回时校验 gridSlice 归属 */
  getNode?: (id: string) => GridSliceNode | undefined
  /** 切分成功后的提示回调；actions 为可挂载的撤回按钮 */
  notify?: (msg: string, actions?: SliceNotifyAction[]) => void
  sliceApi?: SliceApiFn
}

export type GridSliceResult = {
  urls: string[]
  nodeIds: string[]
}

function sourceLabel(node: GridSliceNode | undefined): string {
  const data = node?.data ?? {}
  const label = data.label ?? data.title
  return typeof label === 'string' && label.trim() ? label : '图片'
}

export type SliceUndoDeps = {
  removeNode: (id: string) => void
  /** 提供时按 data.gridSlice.sourceNodeId === sourceNodeId 过滤，防止误删同名批次的后续节点 */
  getNode?: (id: string) => GridSliceNode | undefined
}

/**
 * 构造「撤回本次切分」：按 data.gridSlice.sourceNodeId === sourceNodeId && id ∈ childIds
 * 移除子节点与关联边（边由 removeNode 注入方清理）。
 */
export function makeSliceUndo(
  deps: SliceUndoDeps,
  sessionId: string,
  sourceNodeId: string,
  childIds: string[],
): () => void {
  if (!sessionId) return () => {}
  return () => {
    for (const id of childIds) {
      if (deps.getNode) {
        const node = deps.getNode(id)
        const gridSlice = node?.data?.gridSlice as { sourceNodeId?: unknown } | undefined
        if (!node || gridSlice?.sourceNodeId !== sourceNodeId) continue
      }
      deps.removeNode(id)
    }
  }
}

export async function runGridSlice(input: RunGridSliceInput): Promise<GridSliceResult> {
  const dims = clampGridDims(input.cols, input.rows)
  const sliceApi = input.sliceApi ?? ((args) => studioApi.imageSlice(args))

  const { urls, cols, rows } = await sliceApi({
    sourceUrl: input.sourceUrl,
    cols: dims.cols,
    rows: dims.rows,
    sessionId: input.sessionId,
  })

  const labelBase = sourceLabel(input.getSourceNode())
  const nodeIds: string[] = []
  for (let i = 0; i < urls.length; i++) {
    const id = input.addNode('image', {
      url: urls[i],
      status: 'completed',
      label: `${labelBase} · 格${i + 1}`,
      gridSlice: {
        sourceNodeId: input.sourceNodeId,
        index: i,
        cols,
        rows,
      },
    })
    input.addEdge({
      id: `e-${input.sourceNodeId}-${id}`,
      source: input.sourceNodeId,
      target: id,
    })
    nodeIds.push(id)
  }

  input.layoutChildren(nodeIds)

  if (input.notify) {
    const actions: SliceNotifyAction[] = []
    if (input.removeNode) {
      const undo = makeSliceUndo(
        { removeNode: input.removeNode, getNode: input.getNode },
        input.sessionId,
        input.sourceNodeId,
        nodeIds,
      )
      actions.push({ label: '撤回本次切分', onClick: undo })
    }
    input.notify(`已裁剪为 ${nodeIds.length} 张`, actions.length ? actions : undefined)
  }

  return { urls, nodeIds }
}

export function useGridSlice() {
  return { runGridSlice }
}
