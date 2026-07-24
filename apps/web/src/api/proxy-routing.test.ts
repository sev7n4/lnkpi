/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildUpstreamPath,
  isStreamProxyPath,
  resolveUpstreamTimeoutMs,
  shouldRetryUpstream,
} from '../../api/proxy-routing'

describe('vercel api proxy routing', () => {
  it('maps agent conversation to 120s timeout and no retry', () => {
    const path = '/api/agent/chat/conversation'
    expect(resolveUpstreamTimeoutMs(path)).toBe(120_000)
    expect(isStreamProxyPath(path)).toBe(true)
    expect(shouldRetryUpstream('POST', path)).toBe(false)
  })

  it('keeps default 20s timeout for ordinary GETs', () => {
    expect(resolveUpstreamTimeoutMs('/api/sessions')).toBe(20_000)
    expect(isStreamProxyPath('/api/sessions')).toBe(false)
    expect(shouldRetryUpstream('GET', '/api/sessions')).toBe(true)
  })

  it('builds upstream path from vercel rewrite query', () => {
    expect(buildUpstreamPath({ path: 'agent/chat/conversation' })).toBe(
      '/api/agent/chat/conversation',
    )
  })
})
