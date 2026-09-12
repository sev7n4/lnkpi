export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type Rect = { x: number; y: number; width: number; height: number }
export type NodeLike = {
  id: string
  type?: string
  position: Point
  parentNode?: string
  parentId?: string
}

export const IMPORT_NODE_ESTIMATE = { width: 280, height: 180 } as const
export const IMPORT_PLACE_MARGIN = 64
export const IMPORT_PLACE_STEP = 120

const MAX_STEP_ATTEMPTS = 12

export function isRootNode(node: NodeLike, idSet?: Set<string>): boolean {
  const parentId = node.parentNode ?? node.parentId
  if (!parentId) return true
  if (idSet) return !idSet.has(parentId)
  return false
}

export function unionNodeBBox(nodes: NodeLike[], estimate: Size = IMPORT_NODE_ESTIMATE): Rect | null {
  if (nodes.length === 0) return null

  const idSet = new Set(nodes.map((n) => n.id))
  const roots = nodes.filter((n) => isRootNode(n, idSet))
  if (roots.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const node of roots) {
    const x = node.position.x
    const y = node.position.y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + estimate.width)
    maxY = Math.max(maxY, y + estimate.height)
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  const ax = a.x - margin
  const ay = a.y - margin
  const aw = a.width + 2 * margin
  const ah = a.height + 2 * margin
  return !(ax + aw <= b.x || b.x + b.width <= ax || ay + ah <= b.y || b.y + b.height <= ay)
}

export function viewportToFlowRect(
  viewport: { x: number; y: number; zoom: number },
  container: Size,
): Rect {
  const { x, y, zoom } = viewport
  return {
    x: -x / zoom,
    y: -y / zoom,
    width: container.width / zoom,
    height: container.height / zoom,
  }
}

function placedBBox(importBBox: Rect, dx: number, dy: number): Rect {
  return { ...importBBox, x: importBBox.x + dx, y: importBBox.y + dy }
}

function isClear(placed: Rect, canvasBBox: Rect | null, margin: number): boolean {
  if (!canvasBBox) return true
  return !rectsOverlap(placed, canvasBBox, margin)
}

function centerInView(view: Rect, size: Size): Point {
  return {
    x: view.x + view.width / 2 - size.width / 2,
    y: view.y + view.height / 2 - size.height / 2,
  }
}

function tryCandidate(
  importBBox: Rect,
  targetX: number,
  targetY: number,
  canvasBBox: Rect | null,
  margin: number,
): Point | null {
  const dx = targetX - importBBox.x
  const dy = targetY - importBBox.y
  const placed = placedBBox(importBBox, dx, dy)
  if (isClear(placed, canvasBBox, margin)) {
    return { x: dx, y: dy }
  }
  return null
}

export function computeImportTranslation(input: {
  importNodes: NodeLike[]
  canvasNodes: NodeLike[]
  viewport?: { x: number; y: number; zoom: number }
  containerSize?: Size
}): Point {
  const importBBox = unionNodeBBox(input.importNodes)
  if (!importBBox) return { x: 0, y: 0 }

  const canvasBBox = unionNodeBBox(input.canvasNodes)
  const margin = IMPORT_PLACE_MARGIN
  const step = IMPORT_PLACE_STEP
  const viewBBox =
    input.viewport && input.containerSize
      ? viewportToFlowRect(input.viewport, input.containerSize)
      : null

  const candidates: Point[] = []

  if (!canvasBBox && viewBBox) {
    candidates.push({
      x: viewBBox.x + viewBBox.width / 2 - importBBox.width / 2,
      y: viewBBox.y + viewBBox.height / 2 - importBBox.height / 2,
    })
  }

  if (viewBBox) {
    const viewCenter = centerInView(viewBBox, importBBox)
    const rightInteriorX = viewBBox.x + viewBBox.width - importBBox.width - margin
    const rightInteriorY = viewCenter.y
    candidates.push({ x: rightInteriorX, y: rightInteriorY })

    if (canvasBBox) {
      candidates.push({ x: canvasBBox.x + canvasBBox.width + margin, y: viewCenter.y })
    }

    const belowInteriorX = viewCenter.x
    const belowInteriorY = viewBBox.y + viewBBox.height - importBBox.height - margin
    candidates.push({ x: belowInteriorX, y: belowInteriorY })

    if (canvasBBox) {
      candidates.push({ x: viewCenter.x, y: canvasBBox.y + canvasBBox.height + margin })
    }

    const stepBases = [
      { x: rightInteriorX, y: rightInteriorY },
      { x: belowInteriorX, y: belowInteriorY },
    ]
    for (const base of stepBases) {
      for (let i = 1; i <= MAX_STEP_ATTEMPTS; i++) {
        candidates.push({ x: base.x + i * step, y: base.y })
        candidates.push({ x: base.x, y: base.y + i * step })
        candidates.push({ x: base.x + i * step, y: base.y + i * step })
      }
    }

    const exteriorRightX = viewBBox.x + viewBBox.width + margin
    candidates.push({ x: exteriorRightX, y: viewCenter.y })
    for (let i = 1; i <= MAX_STEP_ATTEMPTS; i++) {
      candidates.push({ x: exteriorRightX, y: viewCenter.y + i * step })
    }
  }

  if (!viewBBox && canvasBBox) {
    candidates.push({ x: canvasBBox.x + canvasBBox.width + margin, y: importBBox.y })
    candidates.push({ x: importBBox.x, y: canvasBBox.y + canvasBBox.height + margin })
  }

  if (canvasBBox) {
    candidates.push({
      x: canvasBBox.x + canvasBBox.width + margin,
      y: canvasBBox.y + canvasBBox.height + margin,
    })
  }

  for (const target of candidates) {
    const result = tryCandidate(importBBox, target.x, target.y, canvasBBox, margin)
    if (result) return result
  }

  if (canvasBBox) {
    return {
      x: canvasBBox.x + canvasBBox.width + margin - importBBox.x,
      y: canvasBBox.y + canvasBBox.height + margin - importBBox.y,
    }
  }

  return { x: 0, y: 0 }
}
