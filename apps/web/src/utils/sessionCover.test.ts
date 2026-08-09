import { describe, expect, it } from 'vitest'
import type { Session } from '@lnkpi/shared'
import { extractSessionCover } from './sessionCover'

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
          { id: 'a', type: 'text', data: { content: 'hello' } },
          { id: 'b', type: 'image', data: { url: 'https://cdn/x.jpg' } },
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
        nodes: [{ id: 'b', type: 'image', data: { url: 'a.jpg', coverUrl: 'cover.jpg' } }],
        edges: [],
      },
    } satisfies Session
    expect(extractSessionCover(session)?.url).toBe('cover.jpg')
  })
})
