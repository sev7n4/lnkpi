import { describe, it, expect, afterEach } from 'vitest'
import { shouldPreferChunkedUpload } from './upload-api'

describe('shouldPreferChunkedUpload', () => {
  const originalHostname = window.location.hostname

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: { hostname: originalHostname },
      writable: true,
    })
  })

  it('uses chunked upload on Vercel hosts', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'lnkpi-web.vercel.app' },
      writable: true,
    })
    const small = new File(['x'], 'a.png', { type: 'image/png' })
    expect(shouldPreferChunkedUpload(small)).toBe(true)
  })

  it('uses multipart for small files on localhost', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    })
    const small = new File(['x'], 'a.png', { type: 'image/png' })
    expect(shouldPreferChunkedUpload(small)).toBe(false)
  })

  it('uses chunked upload for files larger than 40MB everywhere', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      writable: true,
    })
    const huge = new File([new Uint8Array(41 * 1024 * 1024)], 'big.mp4', { type: 'video/mp4' })
    expect(shouldPreferChunkedUpload(huge)).toBe(true)
  })
})
