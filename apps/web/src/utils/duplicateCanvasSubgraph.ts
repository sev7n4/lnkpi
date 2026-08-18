import type { FlowEdge, FlowNode } from '@/composables/useCanvasActions'
export {
  resolveDuplicateSourceIds,
  sanitizeNodeDataForDuplicate,
  type DuplicateEdgeMode,
  type DuplicateSubgraphOptions,
} from '@lnkpi/shared'
import {
  duplicateSubgraph as duplicateSubgraphCore,
  type DuplicateCanvasEdge,
  type DuplicateCanvasNode,
} from '@lnkpi/shared'

export type DuplicateFlowNode = FlowNode & {
  parentNode?: string
  selected?: boolean
}

export interface DuplicateSubgraphResult {
  nodes: DuplicateFlowNode[]
  edges: FlowEdge[]
  idMap: Map<string, string>
  newRootIds: string[]
}

let webDupCounter = 0
export function duplicateSubgraph(
  nodes: DuplicateFlowNode[],
  edges: FlowEdge[],
  sourceIds: string[],
  options?: import('@lnkpi/shared').DuplicateSubgraphOptions,
): DuplicateSubgraphResult {
  return duplicateSubgraphCore(
    nodes as DuplicateCanvasNode[],
    edges as DuplicateCanvasEdge[],
    sourceIds,
    {
      ...options,
      createNodeId: (type) => `${type}-dup-${Date.now()}-${++webDupCounter}`,
    },
  ) as DuplicateSubgraphResult
}
