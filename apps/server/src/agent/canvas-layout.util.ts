import type { CanvasNode } from '@lnkpi/shared'

export const GROUP_PADDING = 80

export type LayoutNode = CanvasNode & {
  parentNode?: string
  style?: Record<string, unknown> | string
  extent?: string
  expandParent?: boolean
  draggable?: boolean
  selectable?: boolean
  zIndex?: number
  dimensions?: { width?: number; height?: number }
}

const NODE_SIZES: Record<string, { w: number; h: number }> = {
  text: { w: 280, h: 160 },
  image: { w: 280, h: 280 },
  video: { w: 280, h: 280 },
  audio: { w: 280, h: 140 },
  sceneComposer: { w: 280, h: 280 },
  shot: { w: 280, h: 280 },
  mediaInput: { w: 280, h: 280 },
  videoComposition: { w: 280, h: 200 },
  worldModel: { w: 280, h: 280 },
  group: { w: 280, h: 160 },
  prompt: { w: 280, h: 120 },
}

function parseStyleSize(style: LayoutNode['style']): { w?: number; h?: number } {
  if (!style || typeof style === 'string') return {}
  const width = style.width
  const height = style.height
  const w =
    typeof width === 'number'
      ? width
      : typeof width === 'string'
        ? Number.parseFloat(width)
        : undefined
  const h =
    typeof height === 'number'
      ? height
      : typeof height === 'string'
        ? Number.parseFloat(height)
        : undefined
  return { w: Number.isFinite(w) ? w : undefined, h: Number.isFinite(h) ? h : undefined }
}

export function getNodeSize(node: LayoutNode): { w: number; h: number } {
  const type = String(node.type ?? '')
  const fallback = NODE_SIZES[type] ?? { w: 280, h: 160 }
  const fromStyle = parseStyleSize(node.style)
  return {
    w: node.dimensions?.width ?? fromStyle.w ?? fallback.w,
    h: node.dimensions?.height ?? fromStyle.h ?? fallback.h,
  }
}

export function getAbsolutePosition(node: LayoutNode, nodes: LayoutNode[]): { x: number; y: number } {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentNode
  while (parentId) {
    const parent = nodes.find((n) => n.id === parentId)
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

function countGroups(nodes: LayoutNode[]): number {
  return nodes.filter((n) => n.type === 'group').length
}

export function createGroupFromNodes(
  nodes: LayoutNode[],
  selectedIds: string[],
  groupTitle?: string,
): { nodes: LayoutNode[]; groupId: string } | null {
  const eligible = selectedIds
    .map((id) => nodes.find((n) => n.id === id))
    .filter((n): n is LayoutNode => Boolean(n && n.type !== 'group' && !n.parentNode))
  if (eligible.length < 2) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of eligible) {
    const abs = getAbsolutePosition(node, nodes)
    const { w, h } = getNodeSize(node)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxX = Math.max(maxX, abs.x + w)
    maxY = Math.max(maxY, abs.y + h)
  }

  const groupId = `group-${Date.now()}`
  const groupX = minX - GROUP_PADDING
  const groupY = minY - GROUP_PADDING
  const groupW = maxX - minX + GROUP_PADDING * 2
  const groupH = maxY - minY + GROUP_PADDING * 2

  const next: LayoutNode[] = nodes.map((n) => ({
    ...n,
    data: { ...(n.data ?? {}) },
  }))

  next.push({
    id: groupId,
    type: 'group',
    position: { x: groupX, y: groupY },
    style: { width: groupW, height: groupH },
    data: {
      title: groupTitle ?? `分组 ${countGroups(next)}`,
      childIds: eligible.map((n) => n.id),
    },
    draggable: true,
    selectable: true,
    zIndex: 0,
  } as LayoutNode)

  for (const node of eligible) {
    const abs = getAbsolutePosition(node, nodes)
    const idx = next.findIndex((n) => n.id === node.id)
    if (idx < 0) continue
    next[idx] = {
      ...next[idx]!,
      parentNode: groupId,
      extent: 'parent',
      expandParent: true,
      draggable: true,
      selectable: true,
      position: { x: abs.x - groupX, y: abs.y - groupY },
      zIndex: 1,
    }
  }

  return { nodes: next, groupId }
}

function getGroupChildIds(nodes: LayoutNode[], groupId: string): string[] {
  const group = nodes.find((n) => n.id === groupId)
  const fromData = group?.data?.childIds
  if (Array.isArray(fromData) && fromData.length) {
    return fromData.map(String)
  }
  return nodes.filter((n) => n.parentNode === groupId).map((n) => n.id)
}

export function ungroupNode(nodes: LayoutNode[], groupId: string): LayoutNode[] {
  const childIdSet = new Set(getGroupChildIds(nodes, groupId))
  const next: LayoutNode[] = []
  for (const node of nodes) {
    if (node.id === groupId) continue
    if (node.parentNode === groupId || childIdSet.has(node.id)) {
      const abs = getAbsolutePosition(node, nodes)
      const { parentNode: _p, extent: _e, expandParent: _x, ...rest } = node
      next.push({
        ...rest,
        position: { x: abs.x, y: abs.y },
        zIndex: undefined,
      })
      continue
    }
    next.push({ ...node })
  }
  return next
}

function updateNodePosition(nodes: LayoutNode[], id: string, pos: { x: number; y: number }) {
  const idx = nodes.findIndex((n) => n.id === id)
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx]!, position: pos }
  }
}

export type LayoutEdge = { source: string; target: string }

function setAbsolutePosition(
  nodes: LayoutNode[],
  node: LayoutNode,
  abs: { x: number; y: number },
) {
  if (node.parentNode) {
    let parentAbs = { x: 0, y: 0 }
    for (const p of nodes) {
      if (p.id === node.parentNode) {
        parentAbs = getAbsolutePosition(p, nodes)
        break
      }
    }
    updateNodePosition(nodes, node.id, {
      x: abs.x - parentAbs.x,
      y: abs.y - parentAbs.y,
    })
    return
  }
  updateNodePosition(nodes, node.id, abs)
}

function assignRanks(
  component: string[],
  adj: Map<string, string[]>,
  absById: Map<string, { x: number; y: number }>,
): Map<string, number> {
  const inComp = new Set(component)
  const hasEdge = component.some((id) => (adj.get(id) ?? []).some((t) => inComp.has(t)))
  const rank = new Map<string, number>()

  if (!hasEdge) {
    const ordered = [...component].sort((a, b) => {
      const pa = absById.get(a)!
      const pb = absById.get(b)!
      return pa.x - pb.x || pa.y - pb.y
    })
    ordered.forEach((id, i) => rank.set(id, i))
    return rank
  }

  const indeg = new Map<string, number>()
  for (const id of component) indeg.set(id, 0)
  for (const id of component) {
    for (const t of adj.get(id) ?? []) {
      if (!inComp.has(t)) continue
      indeg.set(t, (indeg.get(t) ?? 0) + 1)
    }
  }

  let layer = 0
  let frontier = component.filter((id) => (indeg.get(id) ?? 0) === 0)
  const placed = new Set<string>()
  while (frontier.length) {
    frontier.sort((a, b) => {
      const pa = absById.get(a)!
      const pb = absById.get(b)!
      return pa.y - pb.y || pa.x - pb.x
    })
    for (const id of frontier) {
      rank.set(id, layer)
      placed.add(id)
    }
    const nextFrontier: string[] = []
    for (const id of frontier) {
      for (const t of adj.get(id) ?? []) {
        if (!inComp.has(t) || placed.has(t)) continue
        const nextDeg = (indeg.get(t) ?? 0) - 1
        indeg.set(t, nextDeg)
        if (nextDeg === 0) nextFrontier.push(t)
      }
    }
    frontier = nextFrontier
    layer += 1
  }

  const leftover = component.filter((id) => !placed.has(id))
  leftover.sort((a, b) => {
    const pa = absById.get(a)!
    const pb = absById.get(b)!
    return pa.x - pb.x || pa.y - pb.y
  })
  leftover.forEach((id, i) => rank.set(id, layer + i))
  return rank
}

/** Layered left-to-right along selected edges; same-rank nodes stack vertically and columns share a vertical center. */
export function layoutNodesAlongEdges(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  selectedIds: string[],
  gap = 40,
): LayoutNode[] {
  const selected = new Set(selectedIds)
  const targets: LayoutNode[] = []
  for (const n of nodes) {
    if (selected.has(n.id) && n.type !== 'group') targets.push(n)
  }
  if (targets.length < 2) return nodes

  const ids = new Set(targets.map((n) => n.id))
  const adj = new Map<string, string[]>()
  for (const id of ids) adj.set(id, [])
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) continue
    adj.get(edge.source)!.push(edge.target)
  }

  const next = nodes.map((n) => ({ ...n }))
  const absById = new Map<string, { x: number; y: number }>()
  const sizeById = new Map<string, { w: number; h: number }>()
  for (const node of targets) {
    absById.set(node.id, getAbsolutePosition(node, nodes))
    sizeById.set(node.id, getNodeSize(node))
  }

  const component = targets.map((n) => n.id)
  const ranks = assignRanks(component, adj, absById)
  const byRank = new Map<number, string[]>()
  let maxRank = 0
  for (const id of component) {
    const r = ranks.get(id) ?? 0
    maxRank = Math.max(maxRank, r)
    const list = byRank.get(r) ?? []
    list.push(id)
    byRank.set(r, list)
  }
  for (const list of byRank.values()) {
    list.sort((a, b) => {
      const pa = absById.get(a)!
      const pb = absById.get(b)!
      return pa.y - pb.y || pa.x - pb.x
    })
  }

  let minX = Infinity
  let minY = Infinity
  let maxBottom = -Infinity
  let colW = 0
  for (const id of component) {
    const abs = absById.get(id)!
    const size = sizeById.get(id)!
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
    maxBottom = Math.max(maxBottom, abs.y + size.h)
    colW = Math.max(colW, size.w)
  }

  const colHeights: number[] = []
  for (let r = 0; r <= maxRank; r += 1) {
    const list = byRank.get(r) ?? []
    let h = 0
    list.forEach((id, i) => {
      h += sizeById.get(id)!.h
      if (i > 0) h += gap
    })
    colHeights[r] = h
  }
  const tallest = Math.max(0, ...colHeights)
  const originY = minY + (maxBottom - minY - tallest) / 2

  for (let r = 0; r <= maxRank; r += 1) {
    const list = byRank.get(r) ?? []
    const colH = colHeights[r] ?? 0
    let y = originY + (tallest - colH) / 2
    const x = minX + r * (colW + gap)
    for (const id of list) {
      const node = next.find((n) => n.id === id)
      if (!node) continue
      const size = sizeById.get(id)!
      setAbsolutePosition(next, node, { x, y })
      y += size.h + gap
    }
  }

  return next
}

export function layoutNodesInGrid(
  nodes: LayoutNode[],
  selectedIds: string[],
  gap = 40,
): LayoutNode[] {
  const selected = new Set(selectedIds)
  const targets = nodes.filter((n) => selected.has(n.id) && n.type !== 'group')
  if (targets.length < 2) return nodes

  const cols = Math.ceil(Math.sqrt(targets.length))
  let minX = Infinity
  let minY = Infinity
  for (const node of targets) {
    const abs = getAbsolutePosition(node, nodes)
    minX = Math.min(minX, abs.x)
    minY = Math.min(minY, abs.y)
  }

  const next = nodes.map((n) => ({ ...n }))
  let idx = 0
  for (const node of targets) {
    const col = idx % cols
    const row = Math.floor(idx / cols)
    const { w, h } = getNodeSize(node)
    const newAbsX = minX + col * (w + gap)
    const newAbsY = minY + row * (h + gap)

    if (node.parentNode) {
      const parent = next.find((p) => p.id === node.parentNode)
      const parentAbs = parent ? getAbsolutePosition(parent, next) : { x: 0, y: 0 }
      updateNodePosition(next, node.id, {
        x: newAbsX - parentAbs.x,
        y: newAbsY - parentAbs.y,
      })
    } else {
      updateNodePosition(next, node.id, { x: newAbsX, y: newAbsY })
    }
    idx += 1
  }
  return next
}

export type CanvasLayoutOp =
  | { op: 'group'; nodeIds: string[]; title?: string }
  | { op: 'ungroup'; groupId: string }
  | { op: 'arrange_grid'; nodeIds: string[]; gap?: number }
  | { op: 'arrange_along_edges'; nodeIds: string[]; gap?: number }
  | { op: 'move'; items: Array<{ nodeId: string; x: number; y: number }> }

export type CanvasLayoutOpResult =
  | { op: 'group'; groupId: string; nodeIds: string[] }
  | { op: 'ungroup'; groupId: string; nodeIds: string[] }
  | { op: 'arrange_grid'; nodeIds: string[] }
  | { op: 'arrange_along_edges'; nodeIds: string[] }
  | { op: 'move'; nodeIds: string[] }

/** Move nodes by absolute canvas coordinates (converts to parent-relative when nested). */
export function moveNodes(
  nodes: LayoutNode[],
  items: Array<{ nodeId: string; x: number; y: number }>,
): { nodes: LayoutNode[]; movedIds: string[] } {
  const next = nodes.map((n) => ({ ...n, data: { ...(n.data ?? {}) } }))
  const movedIds: string[] = []
  for (const item of items) {
    const idx = next.findIndex((n) => n.id === item.nodeId)
    if (idx < 0) continue
    const node = next[idx]!
    let position = { x: item.x, y: item.y }
    if (node.parentNode) {
      const parent = next.find((n) => n.id === node.parentNode)
      if (parent) {
        const parentAbs = getAbsolutePosition(parent, next)
        position = {
          x: item.x - parentAbs.x,
          y: item.y - parentAbs.y,
        }
      }
    }
    next[idx] = { ...node, position }
    movedIds.push(item.nodeId)
  }
  return { nodes: next, movedIds }
}

/** Apply ordered layout ops on an in-memory node list (no persistence). */
export function applyLayoutOps(
  nodes: LayoutNode[],
  ops: CanvasLayoutOp[],
  edges: LayoutEdge[] = [],
): { nodes: LayoutNode[]; results: CanvasLayoutOpResult[] } {
  let current = nodes.map((n) => ({ ...n, data: { ...(n.data ?? {}) } }))
  const results: CanvasLayoutOpResult[] = []

  for (const op of ops) {
    switch (op.op) {
      case 'group': {
        const grouped = createGroupFromNodes(current, op.nodeIds, op.title)
        if (!grouped) {
          throw new Error(`group requires at least 2 eligible nodes: ${op.nodeIds.join(', ')}`)
        }
        current = grouped.nodes
        results.push({ op: 'group', groupId: grouped.groupId, nodeIds: op.nodeIds })
        break
      }
      case 'ungroup': {
        const childIds = getGroupChildIds(current, op.groupId)
        current = ungroupNode(current, op.groupId)
        results.push({ op: 'ungroup', groupId: op.groupId, nodeIds: childIds })
        break
      }
      case 'arrange_grid': {
        current = layoutNodesInGrid(current, op.nodeIds, op.gap ?? 40)
        results.push({ op: 'arrange_grid', nodeIds: op.nodeIds })
        break
      }
      case 'arrange_along_edges': {
        current = layoutNodesAlongEdges(current, edges, op.nodeIds, op.gap ?? 40)
        results.push({ op: 'arrange_along_edges', nodeIds: op.nodeIds })
        break
      }
      case 'move': {
        const moved = moveNodes(current, op.items)
        current = moved.nodes
        results.push({ op: 'move', nodeIds: moved.movedIds })
        break
      }
      default: {
        const _exhaustive: never = op
        throw new Error(`unknown layout op: ${JSON.stringify(_exhaustive)}`)
      }
    }
  }

  return { nodes: current, results }
}

export function summarizeLayoutGroups(nodes: LayoutNode[]): Array<{
  id: string
  title: string
  childIds: string[]
  position: { x: number; y: number }
  size: { w: number; h: number }
}> {
  return nodes
    .filter((n) => n.type === 'group')
    .map((group) => {
      const childIds = getGroupChildIds(nodes, group.id)
      const { w, h } = getNodeSize(group)
      return {
        id: group.id,
        title: String(group.data?.title ?? '分组'),
        childIds,
        position: group.position,
        size: { w, h },
      }
    })
}
