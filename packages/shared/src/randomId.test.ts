import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomId } from './randomId'

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1234' })
    expect(randomId()).toBe('uuid-1234')
  })

  it('falls back when crypto.randomUUID is unavailable (HTTP)', () => {
    vi.stubGlobal('crypto', {})
    expect(randomId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })

  it('falls back when crypto is undefined', () => {
    vi.stubGlobal('crypto', undefined)
    expect(randomId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })

  it('fallback ids are unique', () => {
    vi.stubGlobal('crypto', {})
    const ids = new Set(Array.from({ length: 200 }, () => randomId()))
    expect(ids.size).toBe(200)
  })
})
