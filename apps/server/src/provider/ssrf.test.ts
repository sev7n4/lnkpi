import { describe, expect, it } from 'vitest'
import { assertSafeOutboundUrl } from './ssrf'

describe('assertSafeOutboundUrl', () => {
  it('rejects loopback http', () => {
    expect(() => assertSafeOutboundUrl('http://127.0.0.1')).toThrow()
  })

  it('rejects cloud metadata', () => {
    expect(() => assertSafeOutboundUrl('http://169.254.169.254')).toThrow()
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => assertSafeOutboundUrl('file:///etc/passwd')).toThrow()
    expect(() => assertSafeOutboundUrl('ftp://example.com')).toThrow()
  })

  it('allows public https', () => {
    const url = assertSafeOutboundUrl('https://api.openai.com')
    expect(url.hostname).toBe('api.openai.com')
  })

  it('allows http localhost when opted in', () => {
    const url = assertSafeOutboundUrl('http://localhost:3000', { allowHttpLocalhost: true })
    expect(url.hostname).toBe('localhost')
    expect(url.port).toBe('3000')
  })

  it('rejects http localhost by default', () => {
    expect(() => assertSafeOutboundUrl('http://localhost:3000')).toThrow()
  })

  it('rejects bracketed IPv6 loopback over https', () => {
    expect(() => assertSafeOutboundUrl('https://[::1]')).toThrow(
      'URL points to a private or restricted address',
    )
  })

  it('rejects bracketed IPv4-mapped loopback over https', () => {
    expect(() => assertSafeOutboundUrl('https://[::ffff:127.0.0.1]')).toThrow(
      'URL points to a private or restricted address',
    )
  })

  it('rejects bracketed IPv4-mapped metadata over https', () => {
    expect(() => assertSafeOutboundUrl('https://[::ffff:169.254.169.254]')).toThrow(
      'URL points to a private or restricted address',
    )
  })

  it('rejects bracketed IPv6 ULA over https', () => {
    expect(() => assertSafeOutboundUrl('https://[fc00::1]')).toThrow(
      'URL points to a private or restricted address',
    )
  })
})
