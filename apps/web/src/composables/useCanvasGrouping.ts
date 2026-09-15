import type { Node } from '@vue-flow/core'
import { getGroupChildIds } from '@lnkpi/shared'

export { getGroupChildIds }

export const GROUP_PADDING = 80

type FlowNode = Node & { dimensions?: { width?: number; height?: number } }

export type { FlowNode }

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

export function getNodeSize(node: FlowNode) {
  const type = String(node.type ?? '')
  const fallback = NODE_SIZES[type] ?? { w: 280, h: 160 }
  return {
    w: node.dimensions?.width ?? fallback.w,
    h: node.dimensions?.height ?? fallback.h,
  }
}

export function getAbsolutePosition(node: FlowNode, nodes: FlowNode[]) {
  let x = node.position.x
  let y = node.position.y
  let parentId = node.parentNode
  while (parentId) {
    let parent: FlowNode | null = null
    for (const n of nodes) {
      if (n.id === parentId) {
        parent = n
        break
      }
    }
    if (!parent) break
    x += parent.position.x
    y += parent.position.y
    parentId = parent.parentNode
  }
  return { x, y }
}

export function createGroupFromNodes(
  nodes: FlowNode[],
  selectedIds: string[],
  groupTitle?: string,
): { nodes: FlowNode[]; groupId: string } | null {
  const eligible: FlowNode[] = []
  for (const id of selectedIds) {
    for (const node of nodes) {
      if (node.id === id && node.type !== 'group' && !node.parentNode) {
        eligible.push(node)
        break
      }
    }
  }
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

  const next: FlowNode[] = nodes.map((n) => ({
    ...n,
    data: { ...((n.data ?? {}) as Record<string, unknown>) },
  }))

  next.push({
    id: groupId,
    type: 'group',
    position: { x: groupX, y: groupY },
    style: { width: `${groupW}px`, height: `${groupH}px` },
    data: {
      title: groupTitle ?? `分组 ${countGroups(next)}`,
      childIds: eligible.map((n) => n.id),
    },
    draggable: true,
    selectable: true,
    dragHandle: '.group-drag-handle',
    zIndex: 0,
  } as FlowNode)

  for (const node of eligible) {
    const abs = getAbsolutePosition(node, nodes)
    for (let i = 0; i < next.length; i += 1) {
      if (next[i]?.id !== node.id) continue
      next[i] = {
        ...next[i]!,
        parentNode: groupId,
        extent: 'parent',
        expandParent: true,
        draggable: true,
        selectable: true,
        position: { x: abs.x - groupX, y: abs.y - groupY },
        zIndex: 1,
      }
      break
    }
  }

  return { nodes: next, groupId }
}

export function resizeGroupToFitChildren(nodes: FlowNode[], groupId: string): FlowNode[] {
  const groupIndex = nodes.findIndex((n) => n.id === groupId && n.type === 'group')
  if (groupIndex < 0) return nodes

  const children = nodes.filter((n) => n.parentNode === groupId)
  if (!children.length) return nodes

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const child of children) {
    const { w, h } = getNodeSize(child)
    minX = Math.min(minX, child.position.x)
    minY = Math.min(minY, child.position.y)
    maxX = Math.max(maxX, child.position.x + w)
    maxY = Math.max(maxY, child.position.y + h)
  }

  if (!Number.isFinite(minX)) return nodes

  const pad = GROUP_PADDING
  const offsetX = minX - pad
  const offsetY = minY - pad
  const group = nodes[groupIndex]!
  const nextGroupX = group.position.x + offsetX
  const nextGroupY = group.position.y + offsetY
  const nextGroupW = maxX - minX + pad * 2
  const nextGroupH = maxY - minY + pad * 2

  return nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        position: { x: nextGroupX, y: nextGroupY },
        style: {
          ...(typeof node.style === 'object' ? node.style : {}),
          width: `${nextGroupW}px`,
          height: `${nextGroupH}px`,
        },
        data: {
          ...((node.data ?? {}) as Record<string, unknown>),
          childIds: children.map((child) => child.id),
        },
      }
    }
    if (node.parentNode === groupId) {
      return {
        ...node,
        position: {
          x: node.position.x - offsetX,
          y: node.position.y - offsetY,
        },
      }
    }
    return node
  })
}

export function ungroupNodes(nodes: FlowNode[], groupId: string): FlowNode[] | null {
  const group = nodes.find((n) => n.id === groupId && n.type === 'group')
  if (!group) return null

  const childIdSet = new Set(getGroupChildIds(nodes, groupId))

  const next: FlowNode[] = []
  for (const node of nodes) {
    if (node.id === groupId) continue
    if (node.parentNode === groupId || childIdSet.has(node.id)) {
      const abs = getAbsolutePosition(node, nodes)
      const {
        parentNode: _parentNode,
        extent: _extent,
        expandParent: _expandParent,
        ...rest
      } = node as FlowNode & { expandParent?: boolean }
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

function countGroups(nodes: FlowNode[]) {
  let c = 0
  for (const n of nodes) {
    if (n.type === 'group') c += 1
  }
  return c
}

export function layoutNodesInGrid(nodes: FlowNode[], selectedIds: string[], gap = 40): FlowNode[] {
  const selected = new Set(selectedIds)
  const targets: FlowNode[] = []
  for (const n of nodes) {
    if (selected.has(n.id) && n.type !== 'group') targets.push(n)
  }
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
      let parentAbs = { x: 0, y: 0 }
      for (const p of next) {
        if (p.id === node.parentNode) {
          parentAbs = getAbsolutePosition(p, next)
          break
        }
      }
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

function updateNodePosition(nodes: FlowNode[], id: string, pos: { x: number; y: number }) {
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]?.id === id) {
      nodes[i] = { ...nodes[i]!, position: pos }
      break
    }
  }
}

export type LayoutEdge = { source: string; target: string }

function setAbsolutePosition(
  nodes: FlowNode[],
  node: FlowNode,
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
  nodes: FlowNode[],
  edges: LayoutEdge[],
  selectedIds: string[],
  gap = 40,
): FlowNode[] {
  const selected = new Set(selectedIds)
  const targets: FlowNode[] = []
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

export function getSelectionBounds(nodes: FlowNode[], selectedIds: string[]) {
  const frame = getSelectionFrame(nodes, selectedIds)
  if (!frame) return null
  return {
    centerX: frame.centerX,
    bottomY: frame.bottomY,
    connectX: frame.connectX,
    connectY: frame.connectY,
  }
}

export function getSelectionFrame(nodes: FlowNode[], selectedIds: string[]) {
  if (!selectedIds.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of selectedIds) {
    for (const node of nodes) {
      if (node.id !== id) continue
      const abs = getAbsolutePosition(node, nodes)
      const { w, h } = getNodeSize(node)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + w)
      maxY = Math.max(maxY, abs.y + h)
    }
  }
  if (!Number.isFinite(minX)) return null
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    bottomY: maxY + 12,
    connectX: maxX,
    connectY: (minY + maxY) / 2,
  }
}
