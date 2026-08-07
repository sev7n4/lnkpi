import { describe, expect, it } from 'vitest'
import { resolvePublicMediaUrl, resolvePublicMediaUrls } from './publicMediaUrl'

const PUBLIC = 'http://119.29.173.89:8888'

describe('resolvePublicMediaUrl', () => {
  it('rewrites legacy :5100 upload URLs to public base', () => {
    const url =
      'http://119.29.173.89:5100/api/uploads/user/abc.jpg'
    expect(resolvePublicMediaUrl(url, { publicBase: PUBLIC })).toBe(
      `${PUBLIC}/api/uploads/user/abc.jpg`,
    )
  })

  it('rewrites relative upload paths', () => {
    expect(resolvePublicMediaUrl('/api/uploads/u/x.png', { publicBase: PUBLIC })).toBe(
      `${PUBLIC}/api/uploads/u/x.png`,
    )
  })

  it('leaves third-party HTTPS URLs unchanged', () => {
    const url = 'https://platform-outputs.agnes-ai.space/images/t2i/a.png'
    expect(resolvePublicMediaUrl(url, { publicBase: PUBLIC })).toBe(url)
  })

  it('leaves blob and data URLs unchanged', () => {
    expect(resolvePublicMediaUrl('blob:http://localhost/x', { publicBase: PUBLIC })).toBe(
      'blob:http://localhost/x',
    )
    expect(resolvePublicMediaUrl('data:image/png;base64,abc', { publicBase: PUBLIC })).toBe(
      'data:image/png;base64,abc',
    )
  })

  it('returns original when public base is missing', () => {
    const url = 'http://119.29.173.89:5100/api/uploads/u/x.png'
    expect(resolvePublicMediaUrl(url, { publicBase: '' })).toBe(url)
  })
})

describe('resolvePublicMediaUrls', () => {
  it('maps arrays', () => {
    expect(
      resolvePublicMediaUrls(
        [
          'http://119.29.173.89:5100/api/uploads/u/a.jpg',
          'https://cdn.example/b.png',
        ],
        { publicBase: PUBLIC },
      ),
    ).toEqual([`${PUBLIC}/api/uploads/u/a.jpg`, 'https://cdn.example/b.png'])
  })
})
