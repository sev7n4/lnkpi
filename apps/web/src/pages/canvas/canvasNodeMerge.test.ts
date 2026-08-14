/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { mergeCanvasNodesFromServer } from './canvasNodeMerge'

describe('mergeCanvasNodesFromServer', () => {
  it('prefers server url over local empty', () => {
    const merged = mergeCanvasNodesFromServer(
      [{ id: 'i1', data: { url: '', status: 'draft' } }],
      [{ id: 'i1', data: { url: 'https://x/a.png', status: 'completed' } }],
    )
    expect(merged[0].data?.url).toBe('https://x/a.png')
    expect(merged[0].data?.status).toBe('completed')
  })

  it('preserves generationStartedAt while server node is generating', () => {
    const merged = mergeCanvasNodesFromServer(
      [{ id: 'v1', data: { status: 'draft' } }],
      [{
        id: 'v1',
        data: {
          status: 'generating',
          generationRecordId: 'rec-1',
          generationStartedAt: '2026-08-14T12:00:00.000Z',
        },
      }],
    )
    expect(merged[0].data?.status).toBe('generating')
    expect(merged[0].data?.generationRecordId).toBe('rec-1')
    expect(merged[0].data?.generationStartedAt).toBe('2026-08-14T12:00:00.000Z')
  })

  it('appends server-only nodes', () => {
    const merged = mergeCanvasNodesFromServer(
      [{ id: 'a', data: {} }],
      [
        { id: 'a', data: {} },
        { id: 'b', data: { title: '新' } },
      ],
    )
    expect(merged.map((n) => n.id)).toEqual(['a', 'b'])
  })
})
