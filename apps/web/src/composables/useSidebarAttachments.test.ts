import { describe, expect, it } from 'vitest'
import { useSidebarAttachments } from './useSidebarAttachments'

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
