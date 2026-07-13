import { getNodeSize, type FlowNode } from '@/composables/useCanvasGrouping'

export const PLACEMENT_GRID = 20

export interface FlowCoordinateApi {
  screenToFlowCoordinate: (position: { x: number; y: number }) => { x: number; y: number }
}

export function snapToGrid(value: number, grid = PLACEMENT_GRID) {
  return Math.round(value / grid) * grid
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  pad: number,
) {
  return ax < bx + bw + pad && ax + aw + pad > bx && ay < by + bh + pad && ay + ah + pad > by
}

export function computeNewNodePosition(
  type: string,
  nodes: FlowNode[],
  flowApi: FlowCoordinateApi,
  canvasEl: HTMLElement,
  options?: { grid?: number; dockStudioReserve?: number; snapToGrid?: boolean },
) {
  const grid = options?.grid ?? PLACEMENT_GRID
  const snap = options?.snapToGrid ?? true
  const dockReserve = options?.dockStudioReserve ?? 120
  const rect = canvasEl.getBoundingClientRect()

  const screenX = rect.left + rect.width / 2
  const screenY = rect.top + Math.max(80, (rect.height - dockReserve) * 0.42)

  const flowPoint = flowApi.screenToFlowCoordinate({ x: screenX, y: screenY })
  const { w, h } = getNodeSize({ type } as FlowNode)

  let x = snap ? snapToGrid(flowPoint.x - w / 2, grid) : flowPoint.x - w / 2
  let y = snap ? snapToGrid(flowPoint.y - h / 2, grid) : flowPoint.y - h / 2

  for (let attempt = 0; attempt < 60; attempt += 1) {
    let blocked = false
    for (const node of nodes) {
      const size = getNodeSize(node)
      if (rectsOverlap(x, y, w, h, node.position.x, node.position.y, size.w, size.h, 12)) {
        blocked = true
        break
      }
    }
    if (!blocked) break
    x += grid * 2
    if (attempt > 0 && attempt % 6 === 0) {
      x -= grid * 14
      y += grid * 2
    }
  }

  return { x, y }
}
