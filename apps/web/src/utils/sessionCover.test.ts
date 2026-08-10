import { describe, expect, it } from 'vitest'
import type { Session } from '@lnkpi/shared'
import { extractSessionCover } from './sessionCover'

const pos = { x: 0, y: 0 }

describe('extractSessionCover', () => {
  it('returns first image node cover', () => {
    const session = {
      id: '1',
      title: 't',
      userId: 'u',
      updatedAt: '',
      createdAt: '',
      canvasData: {
        nodes: [
          { id: 'a', type: 'text', position: pos, data: { content: 'hello' } },
          { id: 'b', type: 'image', position: pos, data: { url: 'https://cdn/x.jpg' } },
        ],
        edges: [],
      },
    } satisfies Session
    expect(extractSessionCover(session)).toEqual({ url: 'https://cdn/x.jpg', kind: 'image' })
  })

  it('prefers coverUrl over url', () => {
    const session = {
      id: '1',
      title: 't',
      userId: 'u',
      updatedAt: '',
      createdAt: '',
      canvasData: {
        nodes: [{ id: 'b', type: 'image', position: pos, data: { url: 'a.jpg', coverUrl: 'cover.jpg' } }],
        edges: [],
      },
    } satisfies Session
    expect(extractSessionCover(session)?.url).toBe('cover.jpg')
  })
})
