import type { CanvasAction, CanvasData } from '@lnkpi/shared'

export interface FlowNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  animated?: boolean
  style?: Record<string, unknown>
}

let nodeCounter = 0

export function applyActionsToFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
  actions: CanvasAction[],
): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const newNodes = [...nodes]
  const newEdges = [...edges]

  for (const action of actions) {
    switch (action.type) {
      case 'add_node': {
        const p = action.payload
        const parentNode = p.parentShotId
          ? newNodes.find((n) => n.id === p.parentShotId)
          : null
        const pos = parentNode
          ? { x: parentNode.position.x + 320, y: parentNode.position.y + 20 }
          : p.position ?? { x: 200, y: 200 }

        const nodeId = p.id ?? `node-${++nodeCounter}`
        newNodes.push({
          id: nodeId,
          type: p.nodeType ?? 'prompt',
          position: pos,
          data: p.data ?? {},
        })

        if (parentNode) {
          newEdges.push({
            id: `e-${parentNode.id}-${nodeId}`,
            source: parentNode.id,
            target: nodeId,
            animated: true,
            style: { stroke: '#7c3aed' },
          })
        }
        break
      }
      case 'update_node': {
        const node = newNodes.find((n) => n.id === action.payload.id)
        if (node) {
          if (action.payload.position) node.position = action.payload.position
          if (action.payload.data) node.data = { ...node.data, ...action.payload.data }
        }
        break
      }
      case 'remove_node': {
        const id = action.payload.id!
        const idx = newNodes.findIndex((n) => n.id === id)
        if (idx > -1) newNodes.splice(idx, 1)
        for (let i = newEdges.length - 1; i >= 0; i--) {
          if (newEdges[i].source === id || newEdges[i].target === id) {
            newEdges.splice(i, 1)
          }
        }
        break
      }
      case 'add_edge':
        newEdges.push({
          id: action.payload.id ?? `e-${action.payload.source}-${action.payload.target}`,
          source: action.payload.source!,
          target: action.payload.target!,
          animated: true,
          style: { stroke: '#7c3aed' },
        })
        break
    }
  }

  return { nodes: newNodes, edges: newEdges }
}

export function canvasDataToFlow(data: CanvasData): { nodes: FlowNode[]; edges: FlowEdge[] } {
  return {
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    })),
    edges: data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      animated: true,
      style: { stroke: '#7c3aed' },
    })),
  }
}

export function flowToCanvasData(nodes: FlowNode[], edges: FlowEdge[]): CanvasData {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      type: (n.type ?? 'prompt') as CanvasData['nodes'][0]['type'],
      position: n.position,
      data: n.data,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    })),
  }
}
