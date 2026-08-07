import { describe, expect, it } from 'vitest'
import {
  SidebarAttachmentSchema,
  validateSidebarAttachments,
  SIDEBAR_ATTACHMENT_MAX,
} from './sidebarAttachments'

describe('SidebarAttachmentSchema', () => {
  it('accepts image upload', () => {
    const parsed = SidebarAttachmentSchema.parse({
      id: 'a1',
      mediaType: 'image',
      sourceKind: 'upload',
      label: 'product.jpg',
      url: 'https://cdn.example.com/a.jpg',
    })
    expect(parsed.mediaType).toBe('image')
  })

  it('rejects blob url', () => {
    expect(() =>
      validateSidebarAttachments([
        {
          id: 'a1',
          mediaType: 'image',
          sourceKind: 'upload',
          label: 'x',
          url: 'blob:http://localhost/abc',
        },
      ]),
    ).toThrow(/blob/)
  })

  it('rejects more than max', () => {
    const items = Array.from({ length: SIDEBAR_ATTACHMENT_MAX + 1 }, (_, i) => ({
      id: `a${i}`,
      mediaType: 'image' as const,
      sourceKind: 'upload' as const,
      label: 'x',
      url: `https://cdn.example.com/${i}.jpg`,
    }))
    expect(() => validateSidebarAttachments(items)).toThrow(/最多/)
  })
})
