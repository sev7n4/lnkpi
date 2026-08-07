import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SidebarAttachment } from '@lnkpi/shared'
import { useAgentStore } from './agent'

describe('useAgentStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('preserves an attachment snapshot on user messages', () => {
    const store = useAgentStore()
    const attachments: SidebarAttachment[] = [
      {
        id: 'attachment-1',
        mediaType: 'image',
        sourceKind: 'upload',
        label: 'product.png',
        url: 'https://cdn.example.com/product.png',
      },
    ]

    store.addUserMessage('参考这张图生成海报', {
      attachments,
      attachmentRefKeys: ['I1'],
    })
    attachments[0].label = 'changed.png'

    expect(store.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: '参考这张图生成海报',
        attachments: [
          expect.objectContaining({ label: 'product.png' }),
        ],
        attachmentRefKeys: ['I1'],
      }),
    ])
  })
})
