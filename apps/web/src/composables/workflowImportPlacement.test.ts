import { describe, expect, it } from 'vitest'
import {
  computeImportTranslation,
  rectsOverlap,
  unionNodeBBox,
  viewportToFlowRect,
  IMPORT_PLACE_MARGIN,
  IMPORT_PLACE_STEP,
} from './workflowImportPlacement'

describe('workflowImportPlacement', () => {
  it('viewportToFlowRect matches (-x/zoom, -y/zoom, w/zoom, h/zoom)', () => {
    const r = viewportToFlowRect({ x: -100, y: -50, zoom: 2 }, { width: 800, height: 600 })
    expect(r).toEqual({ x: 50, y: 25, width: 400, height: 300 })
  })

  it('separates import bbox from overlapping canvas with margin', () => {
    const canvasNodes = [{ id: 'a', position: { x: 0, y: 0 } }]
    const importNodes = [{ id: 'b', position: { x: 0, y: 0 } }]
    const { x: dx, y: dy } = computeImportTranslation({
      importNodes,
      canvasNodes,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerSize: { width: 1000, height: 800 },
    })
    const placed = importNodes.map((n) => ({
      ...n,
      position: { x: n.position.x + dx, y: n.position.y + dy },
    }))
    const a = unionNodeBBox(canvasNodes)!
    const b = unionNodeBBox(placed)!
    expect(rectsOverlap(a, b, IMPORT_PLACE_MARGIN)).toBe(false)
  })

  it('clamps the free axis into the current viewport, not file coordinates', () => {
    const canvasNodes = [{ id: 'existing', position: { x: 2000, y: 2000 } }]
    const importNodes = [{ id: 'imported', position: { x: 0, y: 0 } }]
    const viewport = { x: -2000, y: -2000, zoom: 1 }
    const containerSize = { width: 1000, height: 800 }
    const viewBBox = viewportToFlowRect(viewport, containerSize)
    expect(viewBBox).toEqual({ x: 2000, y: 2000, width: 1000, height: 800 })

    const { x: dx, y: dy } = computeImportTranslation({
      importNodes,
      canvasNodes,
      viewport,
      containerSize,
    })
    const placed = unionNodeBBox(
      importNodes.map((n) => ({
        ...n,
        position: { x: n.position.x + dx, y: n.position.y + dy },
      })),
    )!

    expect(placed.y).not.toBeCloseTo(0)
    expect(placed.y).toBeGreaterThan(viewBBox.y - IMPORT_PLACE_MARGIN)

    const viewRight = viewBBox.x + viewBBox.width
    const viewBottom = viewBBox.y + viewBBox.height
    const insideView =
      placed.x >= viewBBox.x &&
      placed.y >= viewBBox.y &&
      placed.x + placed.width <= viewRight &&
      placed.y + placed.height <= viewBottom
    const tightlyRightExterior =
      placed.x >= viewRight &&
      placed.x <= viewRight + IMPORT_PLACE_MARGIN + IMPORT_PLACE_STEP &&
      placed.y >= viewBBox.y &&
      placed.y + placed.height <= viewBottom

    expect(insideView || tightlyRightExterior).toBe(true)
  })

  it('keeps child relative coords out of translation input roots', () => {
    const nodes = [
      { id: 'g', type: 'group', position: { x: 10, y: 10 } },
      { id: 'c', position: { x: 5, y: 5 }, parentNode: 'g' },
    ]
    const box = unionNodeBBox(nodes)!
    expect(box.x).toBe(10)
    expect(box.y).toBe(10)
  })
})
