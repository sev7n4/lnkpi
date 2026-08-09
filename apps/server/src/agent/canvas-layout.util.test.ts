import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyLayoutOps,
  createGroupFromNodes,
  getAbsolutePosition,
  getNodeSize,
  layoutNodesInGrid,
  moveNodes,
  type LayoutNode,
  ungroupNode,
} from './canvas-layout.util'

function node(
  id: string,
  type: string,
  x: number,
  y: number,
  extra: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    id,
    type,
    position: { x, y },
    data: {},
    ...extra,
  }
}

describe('canvas-layout.util', () => {
  describe('getNodeSize', () => {
    it('uses type defaults', () => {
      expect(getNodeSize(node('a', 'image', 0, 0))).toEqual({ w: 280, h: 280 })
      expect(getNodeSize(node('b', 'prompt', 0, 0))).toEqual({ w: 280, h: 120 })
      expect(getNodeSize(node('c', 'unknown', 0, 0))).toEqual({ w: 280, h: 160 })
    })

    it('prefers dimensions over style and type defaults', () => {
      const sized = node('a', 'image', 0, 0, {
        dimensions: { width: 400, height: 300 },
        style: { width: 100, height: 100 },
      })
      expect(getNodeSize(sized)).toEqual({ w: 400, h: 300 })
    })

    it('parses numeric style sizes', () => {
      const styled = node('a', 'text', 0, 0, {
        style: { width: 320, height: 180 },
      })
      expect(getNodeSize(styled)).toEqual({ w: 320, h: 180 })
    })

    it('parses string style sizes', () => {
      const styled = node('a', 'text', 0, 0, {
        style: { width: '360px', height: '200' },
      })
      expect(getNodeSize(styled)).toEqual({ w: 360, h: 200 })
    })
  })

  describe('getAbsolutePosition', () => {
    it('returns position for root nodes', () => {
      const nodes = [node('a', 'image', 100, 50)]
      expect(getAbsolutePosition(nodes[0]!, nodes)).toEqual({ x: 100, y: 50 })
    })

    it('accumulates parent offsets for nested groups', () => {
      const nodes = [
        node('g1', 'group', 200, 100),
        node('a', 'image', 40, 30, { parentNode: 'g1' }),
        node('g2', 'group', 10, 20, { parentNode: 'g1' }),
        node('b', 'text', 5, 5, { parentNode: 'g2' }),
      ]
      expect(getAbsolutePosition(nodes[1]!, nodes)).toEqual({ x: 240, y: 130 })
      expect(getAbsolutePosition(nodes[3]!, nodes)).toEqual({ x: 215, y: 125 })
    })

    it('stops when parent chain is broken', () => {
      const orphan = node('a', 'image', 10, 20, { parentNode: 'missing' })
      expect(getAbsolutePosition(orphan, [orphan])).toEqual({ x: 10, y: 20 })
    })
  })

  describe('createGroupFromNodes', () => {
    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('returns null when fewer than two eligible nodes', () => {
      const nodes = [node('a', 'image', 0, 0)]
      expect(createGroupFromNodes(nodes, ['a'])).toBeNull()
      expect(createGroupFromNodes(nodes, ['missing', 'a'])).toBeNull()
    })

    it('ignores nodes already in a group or group nodes', () => {
      const nodes = [
        node('a', 'image', 0, 0),
        node('b', 'text', 300, 0, { parentNode: 'existing-group' }),
        node('g', 'group', 0, 0),
      ]
      expect(createGroupFromNodes(nodes, ['a', 'b'])).toBeNull()
      expect(createGroupFromNodes(nodes, ['a', 'g'])).toBeNull()
    })

    it('wraps nodes in a padded group with relative child positions', () => {
      const nodes = [
        node('a', 'image', 100, 100),
        node('b', 'text', 420, 160),
      ]

      const result = createGroupFromNodes(nodes, ['a', 'b'], 'Campaign block')
      expect(result).not.toBeNull()

      const { groupId, nodes: next } = result!
      expect(groupId).toBe('group-1700000000000')

      const group = next.find((n) => n.id === groupId)
      expect(group?.type).toBe('group')
      expect(group?.data?.title).toBe('Campaign block')
      expect(group?.style).toEqual({ width: 760, height: 440 })
      expect(group?.position).toEqual({ x: 20, y: 20 })

      const childA = next.find((n) => n.id === 'a')
      const childB = next.find((n) => n.id === 'b')
      expect(childA?.parentNode).toBe(groupId)
      expect(childB?.parentNode).toBe(groupId)
      expect(childA?.position).toEqual({ x: 80, y: 80 })
      expect(childB?.position).toEqual({ x: 400, y: 140 })
    })
  })

  describe('ungroupNode', () => {
    it('dissolves group and restores absolute positions for children', () => {
      const grouped = createGroupFromNodes(
        [node('a', 'image', 50, 80), node('b', 'text', 360, 120)],
        ['a', 'b'],
      )
      expect(grouped).not.toBeNull()

      const ungrouped = ungroupNode(grouped!.nodes, grouped!.groupId)
      expect(ungrouped.some((n) => n.id === grouped!.groupId)).toBe(false)
      expect(ungrouped.find((n) => n.id === 'a')?.position).toEqual({ x: 50, y: 80 })
      expect(ungrouped.find((n) => n.id === 'b')?.position).toEqual({ x: 360, y: 120 })
      expect(ungrouped.find((n) => n.id === 'a')?.parentNode).toBeUndefined()
    })

    it('uses childIds from group data when present', () => {
      const nodes: LayoutNode[] = [
        {
          id: 'g1',
          type: 'group',
          position: { x: 0, y: 0 },
          data: { childIds: ['a'] },
        },
        node('a', 'image', 25, 35, { parentNode: 'g1', extent: 'parent' }),
        node('b', 'text', 500, 500),
      ]

      const ungrouped = ungroupNode(nodes, 'g1')
      expect(ungrouped.find((n) => n.id === 'a')?.position).toEqual({ x: 25, y: 35 })
      expect(ungrouped.find((n) => n.id === 'b')?.position).toEqual({ x: 500, y: 500 })
    })
  })

  describe('layoutNodesInGrid', () => {
    it('returns input unchanged when fewer than two layout targets', () => {
      const nodes = [node('a', 'image', 10, 10)]
      expect(layoutNodesInGrid(nodes, ['a'])).toBe(nodes)
      expect(layoutNodesInGrid(nodes, ['a', 'missing'])).toBe(nodes)
    })

    it('ignores group nodes in the selection', () => {
      const nodes = [
        node('a', 'image', 0, 0),
        node('g', 'group', 100, 100),
      ]
      expect(layoutNodesInGrid(nodes, ['a', 'g'])).toBe(nodes)
    })

    it('arranges root nodes in a sqrt grid anchored at selection bounding-box origin', () => {
      const nodes = [
        node('a', 'image', 200, 100),
        node('b', 'text', 500, 300),
        node('c', 'video', 800, 50),
        node('d', 'prompt', 900, 900),
      ]

      const next = layoutNodesInGrid(nodes, ['a', 'b', 'c', 'd'], 20)
      const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))

      // Anchor = min absolute x/y across selected nodes (c.y=50 is the top edge).
      expect(byId.a).toEqual({ x: 200, y: 50 })
      expect(byId.b).toEqual({ x: 200 + 280 + 20, y: 50 })
      expect(byId.c).toEqual({ x: 200, y: 50 + 280 + 20 })
      expect(byId.d).toEqual({ x: 200 + 280 + 20, y: 50 + 120 + 20 })
    })

    it('updates relative positions for nodes inside a parent group', () => {
      const grouped = createGroupFromNodes(
        [node('a', 'image', 0, 0), node('b', 'text', 400, 0), node('c', 'video', 0, 400)],
        ['a', 'b', 'c'],
      )
      expect(grouped).not.toBeNull()

      const next = layoutNodesInGrid(grouped!.nodes, ['a', 'b', 'c'], 10)
      const group = next.find((n) => n.id === grouped!.groupId)!
      const groupAbs = getAbsolutePosition(group, next)

      for (const id of ['a', 'b', 'c']) {
        const child = next.find((n) => n.id === id)!
        const abs = getAbsolutePosition(child, next)
        expect(child.parentNode).toBe(grouped!.groupId)
        expect(child.position.x).toBe(abs.x - groupAbs.x)
        expect(child.position.y).toBe(abs.y - groupAbs.y)
      }

      const absA = getAbsolutePosition(next.find((n) => n.id === 'a')!, next)
      const absB = getAbsolutePosition(next.find((n) => n.id === 'b')!, next)
      expect(absB.x - absA.x).toBe(280 + 10)
    })
  })

  describe('moveNodes', () => {
    it('moves root nodes to absolute coordinates', () => {
      const nodes = [node('a', 'image', 0, 0), node('b', 'text', 200, 200)]
      const { nodes: next, movedIds } = moveNodes(nodes, [
        { nodeId: 'a', x: 500, y: 600 },
      ])
      expect(movedIds).toEqual(['a'])
      expect(next.find((n) => n.id === 'a')?.position).toEqual({ x: 500, y: 600 })
      expect(next.find((n) => n.id === 'b')?.position).toEqual({ x: 200, y: 200 })
    })

    it('converts absolute coordinates to parent-relative positions', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
      const grouped = createGroupFromNodes(
        [node('a', 'image', 100, 100), node('b', 'text', 400, 100)],
        ['a', 'b'],
      )!
      const { nodes: next } = moveNodes(grouped.nodes, [{ nodeId: 'a', x: 300, y: 300 }])
      const child = next.find((n) => n.id === 'a')!
      const abs = getAbsolutePosition(child, next)
      expect(abs).toEqual({ x: 300, y: 300 })
      vi.restoreAllMocks()
    })
  })

  describe('applyLayoutOps', () => {
    beforeEach(() => {
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('chains group, grid, and ungroup', () => {
      const base = [node('a', 'image', 0, 0), node('b', 'text', 400, 0), node('c', 'video', 0, 400)]
      const { nodes, results } = applyLayoutOps(base, [
        { op: 'group', nodeIds: ['a', 'b'], title: 'Pair' },
        { op: 'arrange_grid', nodeIds: ['c'], gap: 20 },
        { op: 'move', items: [{ nodeId: 'c', x: 800, y: 800 }] },
      ])
      expect(results.map((r) => r.op)).toEqual(['group', 'arrange_grid', 'move'])
      expect(nodes.some((n) => n.type === 'group')).toBe(true)
      expect(nodes.find((n) => n.id === 'c')?.position).toEqual({ x: 800, y: 800 })

      const group = nodes.find((n) => n.type === 'group')!
      const ungrouped = applyLayoutOps(nodes, [{ op: 'ungroup', groupId: group.id }])
      expect(ungrouped.results[0]?.op).toBe('ungroup')
      expect(ungrouped.nodes.some((n) => n.id === group.id)).toBe(false)
    })
  })
})
