import type { CanvasAction, NodeType } from '../index'
import type { DuplicateSubgraphResult } from './duplicateSubgraph'

export function duplicateResultToCanvasActions(result: DuplicateSubgraphResult): CanvasAction[] {
  const actions: CanvasAction[] = []
  for (const node of result.nodes) {
    actions.push({
      type: 'add_node',
      payload: {
        id: node.id,
        nodeType: node.type as NodeType | undefined,
        position: node.position,
        data: node.data ?? {},
      },
    })
  }
  for (const edge of result.edges) {
    actions.push({
      type: 'add_edge',
      payload: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
      },
    })
  }
  return actions
}
