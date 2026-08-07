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

  it('falls back when crypto.randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', {})
    const id = randomId()
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })
})
