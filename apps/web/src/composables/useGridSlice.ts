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
  return { urls, nodeIds }
}

export function useGridSlice() {
  return { runGridSlice }
}
