import { describe, expect, it } from 'vitest'
import { mergeFocusNodeRef, useSidebarAttachments } from './useSidebarAttachments'

describe('useSidebarAttachments', () => {
  it('dedupes by url', () => {
    const { addFromPayload, pendingAttachments } = useSidebarAttachments()
    addFromPayload({ id: '1', mediaType: 'image', sourceKind: 'upload', label: 'a', url: 'https://x/1.jpg' })
    addFromPayload({ id: '2', mediaType: 'image', sourceKind: 'upload', label: 'b', url: 'https://x/1.jpg' })
    expect(pendingAttachments.value).toHaveLength(1)
  })

  it('assigns ref keys I1 T1', () => {
    const { addFromPayload, assignRefKeys } = useSidebarAttachments()
    addFromPayload({ id: '1', mediaType: 'image', sourceKind: 'upload', label: 'a', url: 'https://x/1.jpg' })
    addFromPayload({ id: '2', mediaType: 'text', sourceKind: 'upload', label: 'b', text: '卖点' })
    const keys = assignRefKeys()
    expect(keys).toEqual(['I1', 'T1'])
  })
})

describe('mergeFocusNodeRef', () => {
  const imageNode = {
    id: 'node-a',
    type: 'image',
    data: { url: 'https://cdn/a.jpg', title: '主图' },
  }

  it('adds canvasNode attachment from focus node', () => {
    const merged = mergeFocusNodeRef([], imageNode)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      id: 'focus-node-a',
      mediaType: 'image',
      sourceKind: 'canvasNode',
      url: 'https://cdn/a.jpg',
      sourceNodeId: 'node-a',
    })
  })

  it('dedupes by sourceNodeId', () => {
    const existing = [{
      id: '1',
      mediaType: 'image' as const,
      sourceKind: 'canvasNode' as const,
      label: 'dup',
      url: 'https://cdn/other.jpg',
      sourceNodeId: 'node-a',
    }]
    expect(mergeFocusNodeRef(existing, imageNode)).toHaveLength(1)
  })

  it('dedupes by url', () => {
    const existing = [{
      id: '1',
      mediaType: 'image' as const,
      sourceKind: 'upload' as const,
      label: 'dup',
      url: 'https://cdn/a.jpg',
    }]
    expect(mergeFocusNodeRef(existing, imageNode)).toHaveLength(1)
  })

  it('returns unchanged when node has no url or text', () => {
    const existing = [{
      id: '1',
      mediaType: 'text' as const,
      sourceKind: 'upload' as const,
      label: 't',
      text: 'hello',
    }]
    expect(mergeFocusNodeRef(existing, { id: 'empty', type: 'image', data: {} })).toBe(existing)
  })
})
