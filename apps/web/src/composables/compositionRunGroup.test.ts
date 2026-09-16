/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  GOLD_COMPOSE_1,
  extractCompositionPrimitives,
  expandComposition,
  renderCompositionCopy,
} from '@lnkpi/shared'
import { flowToCanvasData, extrasForCanvasSave } from '@/composables/useCanvasActions'
import {
  compositionGenerateIdsForClick,
  orderedCompositionGenerateIds,
  type CompositionRunCanvas,
} from '@/composables/compositionRunGroup'

function goldCanvas(): CompositionRunCanvas {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('gold extract failed')
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  return {
    nodes: dump.graph.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      data: node.data as Record<string, unknown>,
    })),
    edges: dump.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    compositionRunGroup: {
      nodeIds: dump.graph.nodes.map((n) => n.id).filter((id) => !id.startsWith('image-src-')),
      dumpHash: 'gold-dump',
      createdAt: '2026-09-16T00:00:00.000Z',
    },
  }
}

describe('orderedCompositionGenerateIds', () => {
  it('returns I0 then looks then video for gold graph + run group', () => {
    expect(orderedCompositionGenerateIds(goldCanvas())).toEqual([
      'image-i0',
      'image-look-0',
      'image-look-1',
      'video-v',
    ])
  })

  it('drops image-src-* and text-p / type=text from generate order', () => {
    const canvas: CompositionRunCanvas = {
      nodes: [
        { id: 'image-src-I1', type: 'image' },
        { id: 'image-i0', type: 'image' },
        { id: 'text-p', type: 'text' },
        { id: 'story-a', type: 'text' },
        { id: 'video-v', type: 'video' },
      ],
      edges: [
        { id: 'e-src-i0', source: 'image-src-I1', target: 'image-i0' },
        { id: 'e-i0-v', source: 'image-i0', target: 'video-v' },
        { id: 'e-p-v', source: 'text-p', target: 'video-v' },
      ],
      compositionRunGroup: {
        nodeIds: ['image-src-I1', 'image-i0', 'text-p', 'story-a', 'video-v'],
        dumpHash: 'h',
        createdAt: 't',
      },
    }
    expect(orderedCompositionGenerateIds(canvas)).toEqual(['image-i0', 'video-v'])
  })

  it('returns empty when run group is missing', () => {
    expect(
      orderedCompositionGenerateIds({
        nodes: [{ id: 'image-i0', type: 'image' }],
        edges: [],
      }),
    ).toEqual([])
  })
})

describe('compositionGenerateIdsForClick', () => {
  it('expands a generating member to the ordered run group', () => {
    expect(compositionGenerateIdsForClick('video-v', goldCanvas())).toEqual([
      'image-i0',
      'image-look-0',
      'image-look-1',
      'video-v',
    ])
    expect(compositionGenerateIdsForClick('image-look-0', goldCanvas())).toEqual([
      'image-i0',
      'image-look-0',
      'image-look-1',
      'video-v',
    ])
  })

  it('keeps single-node generate when the click is outside the run group', () => {
    expect(compositionGenerateIdsForClick('image-other', goldCanvas())).toEqual(['image-other'])
  })

  it('skips text-p always', () => {
    expect(compositionGenerateIdsForClick('text-p', goldCanvas())).toEqual([])
  })
})

describe('flowToCanvasData compositionRunGroup', () => {
  it('keeps compositionRunGroup when provided', () => {
    const group = {
      nodeIds: ['image-i0', 'video-v'],
      dumpHash: 'h',
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    const data = flowToCanvasData(
      [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      [],
      { compositionRunGroup: group },
    )
    expect(data.compositionRunGroup).toEqual(group)
  })

  it('omits compositionRunGroup when not provided', () => {
    const data = flowToCanvasData(
      [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      [],
    )
    expect(data.compositionRunGroup).toBeUndefined()
  })

  it('keeps previous compositionRunGroup when extras omit the group', () => {
    const group = {
      nodeIds: ['image-i0', 'video-v'],
      dumpHash: 'h',
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    const data = flowToCanvasData(
      [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      [],
      { previousCanvas: { compositionRunGroup: group } },
    )
    expect(data.compositionRunGroup).toEqual(group)
  })

  it('preserves server compositionRunGroup when current and lastKnown are empty', () => {
    const group = {
      nodeIds: ['image-i0', 'video-v'],
      dumpHash: 'h',
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    const extras = extrasForCanvasSave({
      current: null,
      lastKnown: null,
      server: group,
    })
    const data = flowToCanvasData(
      [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      [],
      extras,
    )
    expect(data.compositionRunGroup).toEqual(group)
  })

  it('does not invent a compositionRunGroup when server also has none', () => {
    const extras = extrasForCanvasSave({
      current: null,
      lastKnown: null,
      server: null,
    })
    const data = flowToCanvasData(
      [{ id: 'image-i0', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      [],
      extras,
    )
    expect(data.compositionRunGroup).toBeUndefined()
  })
})
