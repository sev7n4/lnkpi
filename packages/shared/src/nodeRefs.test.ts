import { describe, it, expect } from 'vitest'
import { resolveNodeRefs } from './nodeRefs'

describe('resolveNodeRefs', () => {
  it('collects multiple texts and images with T/I keys', () => {
    const refs = resolveNodeRefs({
      targetNodeId: 'img1',
      targetType: 'image',
      nodes: [
        { id: 't1', type: 'text', data: { content: '文案A' } },
        { id: 'p1', type: 'prompt', data: { prompt: '短', content: '长文CONTENT' } },
        { id: 'i1', type: 'image', data: { url: 'https://a/1.png' } },
        { id: 'i2', type: 'image', data: { url: 'https://a/2.png' } },
        { id: 'img1', type: 'image', data: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'img1' },
        { id: 'e2', source: 'i1', target: 'img1' },
        { id: 'e3', source: 'p1', target: 'img1' },
        { id: 'e4', source: 'i2', target: 'img1' },
      ],
    })
    const texts = refs.filter((r) => r.mediaType === 'text')
    const images = refs.filter((r) => r.mediaType === 'image')
    expect(texts.map((r) => r.refKey)).toEqual(['T1', 'T2'])
    expect(texts.find((r) => r.sourceNodeId === 'p1')?.payload.text).toBe('长文CONTENT')
    expect(images).toHaveLength(2)
    expect(images.map((r) => r.refKey)).toEqual(['I1', 'I2'])
  })

  it('respects refOrder for same media type', () => {
    const refs = resolveNodeRefs({
      targetNodeId: 'img1',
      targetType: 'image',
      nodes: [
        { id: 't1', type: 'text', data: { content: 'A' } },
        { id: 't2', type: 'text', data: { content: 'B' } },
        { id: 'img1', type: 'image', data: {} },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'img1' },
        { id: 'e2', source: 't2', target: 'img1' },
      ],
      refOrder: ['e2', 'e1'],
    })
    expect(refs.filter((r) => r.mediaType === 'text').map((r) => r.payload.text)).toEqual(['B', 'A'])
    expect(refs[0].refKey).toBe('T1')
  })
})
