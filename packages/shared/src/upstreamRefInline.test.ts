import { describe, expect, it } from 'vitest'
import { needsUpstreamRefInline, parseUploadRefPath, upstreamRefInlineIndexes } from './upstreamRefInline'

describe('parseUploadRefPath', () => {
  it('parses relative upload path', () => {
    expect(parseUploadRefPath('/api/uploads/u1/a.png')).toEqual({ userId: 'u1', fileName: 'a.png' })
  })

  it('parses absolute upload URL with query', () => {
    expect(
      parseUploadRefPath('http://119.29.173.89:8888/api/uploads/u1/a.png?v=1'),
    ).toEqual({ userId: 'u1', fileName: 'a.png' })
  })

  it('returns null for third-party CDN', () => {
    expect(parseUploadRefPath('https://cdn.example.com/a.png')).toBeNull()
  })
})

describe('needsUpstreamRefInline', () => {
  it('inlines lnkpi uploads regardless of host/port', () => {
    expect(needsUpstreamRefInline('/api/uploads/u/x.png')).toBe(true)
    expect(
      needsUpstreamRefInline('http://119.29.173.89:8888/api/uploads/u/x.png'),
    ).toBe(true)
    expect(needsUpstreamRefInline('https://app.example.com/api/uploads/u/x.png')).toBe(true)
  })

  it('passes through public HTTPS CDN on 443', () => {
    expect(needsUpstreamRefInline('https://platform-outputs.agnes-ai.space/out.png')).toBe(false)
    expect(needsUpstreamRefInline('https://cdn.example.com/ref.jpg')).toBe(false)
  })

  it('inlines non-standard ports and loopback', () => {
    expect(needsUpstreamRefInline('http://119.29.173.89:8888/other.png')).toBe(true)
    expect(needsUpstreamRefInline('http://127.0.0.1:3000/x.png')).toBe(true)
    expect(needsUpstreamRefInline('http://localhost/api/x.png')).toBe(true)
  })

  it('skips already inlined data URLs', () => {
    expect(needsUpstreamRefInline('data:image/png;base64,abc')).toBe(false)
  })
})

describe('upstreamRefInlineIndexes', () => {
  it('returns indexes needing inline only', () => {
    expect(
      upstreamRefInlineIndexes([
        'https://cdn.example/a.png',
        'http://119.29.173.89:8888/api/uploads/u/x.png',
      ]),
    ).toEqual([1])
  })
})
