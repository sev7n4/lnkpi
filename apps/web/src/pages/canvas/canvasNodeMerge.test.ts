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
