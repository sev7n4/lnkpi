import { describe, expect, it } from 'vitest'
import { layoutNodesAlongEdges, type FlowNode } from './useCanvasGrouping'

function node(id: string, type: string, x: number, y: number): FlowNode {
  return {
    id,
    type,
    position: { x, y },
    data: {},
  }
}

describe('layoutNodesAlongEdges', () => {
  it('returns input unchanged when fewer than two layout targets', () => {
    const nodes = [node('a', 'image', 10, 10)]
    expect(layoutNodesAlongEdges(nodes, [], ['a'])).toBe(nodes)
  })

  it('aligns an unconnected pair on one horizontal row (same y)', () => {
    const nodes = [node('a', 'image', 400, 300), node('b', 'image', 100, 80)]
    const next = layoutNodesAlongEdges(nodes, [], ['a', 'b'], 40)
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.b.y).toBe(byId.a.y)
    expect(byId.b.x).toBeLessThan(byId.a.x)
    expect(byId.a.x - byId.b.x).toBe(280 + 40)
  })

  it('places a chain left-to-right with shared y', () => {
    const nodes = [
      node('a', 'image', 0, 200),
      node('b', 'image', 50, 10),
      node('c', 'image', 80, 400),
    ]
    const next = layoutNodesAlongEdges(
      nodes,
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      ['a', 'b', 'c'],
      40,
    )
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.a.y).toBe(byId.b.y)
    expect(byId.b.y).toBe(byId.c.y)
    expect(byId.b.x - byId.a.x).toBe(280 + 40)
    expect(byId.c.x - byId.b.x).toBe(280 + 40)
  })

  it('stacks siblings in the same rank vertically', () => {
    const nodes = [
      node('a', 'image', 0, 0),
      node('b', 'image', 400, 0),
      node('c', 'image', 400, 400),
    ]
    const next = layoutNodesAlongEdges(
      nodes,
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
      ['a', 'b', 'c'],
      40,
    )
    const byId = Object.fromEntries(next.map((n) => [n.id, n.position]))
    expect(byId.b.x).toBe(byId.c.x)
    expect(byId.b.x).toBe(byId.a.x + 280 + 40)
    expect(Math.abs(byId.c.y - byId.b.y)).toBe(280 + 40)
  })
})
