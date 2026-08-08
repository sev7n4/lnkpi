import type { CanvasAction, CanvasData } from '@lnkpi/shared'

/** Apply agent canvas mutations to an in-memory canvas snapshot. */
export function applyCanvasActions(data: CanvasData, actions: CanvasAction[]): CanvasData {
  const result: CanvasData = {
    nodes: [...data.nodes],
    edges: [...data.edges],
    viewport: data.viewport,
  }

  for (const action of actions) {
    switch (action.type) {
      case 'add_node': {
        const p = action.payload
        const parentShot = p.parentShotId
          ? result.nodes.find((n) => n.id === p.parentShotId)
          : null
        const pos = parentShot
          ? { x: parentShot.position.x + 280, y: parentShot.position.y }
          : (p.position ?? { x: 0, y: 0 })
        if (!p.id) break
        result.nodes.push({
          id: p.id,
          type: (p.nodeType ?? 'prompt') as CanvasData['nodes'][0]['type'],
          position: pos,
          data: p.data ?? {},
        })
        if (parentShot && p.id) {
          result.edges.push({
            id: `e-${parentShot.id}-${p.id}`,
            source: parentShot.id,
            target: p.id,
          })
        }
        break
      }
      case 'update_node': {
        const node = result.nodes.find((n) => n.id === action.payload.id)
        if (node) {
          if (action.payload.position) node.position = action.payload.position
          if (action.payload.data) node.data = { ...node.data, ...action.payload.data }
        }
        break
      }
      case 'add_edge': {
        const { id, source, target } = action.payload
        if (!id || !source || !target) break
        result.edges.push({ id, source, target })
        break
      }
      case 'remove_node':
        result.nodes = result.nodes.filter((n) => n.id !== action.payload.id)
        result.edges = result.edges.filter(
          (e) => e.source !== action.payload.id && e.target !== action.payload.id,
        )
        break
    }
  }

  return result
}
