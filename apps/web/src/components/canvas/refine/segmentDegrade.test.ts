import { describe, expect, it } from 'vitest'
import { isSegmentUpstreamDegradable } from './segmentDegrade'

describe('isSegmentUpstreamDegradable', () => {
  it('treats 502 and 503 as degradable', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 502 } })).toBe(true)
    expect(isSegmentUpstreamDegradable({ response: { status: 503 } })).toBe(true)
  })

  it('treats network errors without response as degradable', () => {
    expect(isSegmentUpstreamDegradable({ message: 'Network Error' })).toBe(true)
    expect(isSegmentUpstreamDegradable({ code: 'ECONNABORTED' })).toBe(true)
  })

  it('does not degrade 400 or platform 429', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 400 } })).toBe(false)
    expect(isSegmentUpstreamDegradable({ response: { status: 429 } })).toBe(false)
  })

  it('does not degrade unrelated 4xx', () => {
    expect(isSegmentUpstreamDegradable({ response: { status: 401 } })).toBe(false)
    expect(isSegmentUpstreamDegradable({ response: { status: 404 } })).toBe(false)
  })
})
