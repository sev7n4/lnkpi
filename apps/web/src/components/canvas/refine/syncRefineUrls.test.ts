import { describe, expect, it } from 'vitest'
import { syncRefineUrls } from './syncRefineUrls'

describe('syncRefineUrls', () => {
  it('keeps N | N+1 compare when parent writes the applied url onto the node', () => {
    const next = syncRefineUrls({
      beforeUrl: 'https://cdn/n-plus-1.png',
      afterUrl: 'https://cdn/n-plus-1.png',
      compareBeforeUrl: 'https://cdn/n.png',
    })
    expect(next.afterUrl).toBe('https://cdn/n-plus-1.png')
    expect(next.compareBeforeUrl).toBe('https://cdn/n.png')
    expect(next.reset).toBe(false)
  })

  it('resets both urls when the working image actually changes', () => {
    const next = syncRefineUrls({
      beforeUrl: 'https://cdn/other.png',
      afterUrl: 'https://cdn/n-plus-1.png',
      compareBeforeUrl: 'https://cdn/n.png',
    })
    expect(next.afterUrl).toBe('https://cdn/other.png')
    expect(next.compareBeforeUrl).toBe('https://cdn/other.png')
    expect(next.reset).toBe(true)
  })

  it('resets both urls on revert to a previous version', () => {
    const next = syncRefineUrls({
      beforeUrl: 'https://cdn/n.png',
      afterUrl: 'https://cdn/n-plus-1.png',
      compareBeforeUrl: 'https://cdn/n.png',
    })
    expect(next.afterUrl).toBe('https://cdn/n.png')
    expect(next.compareBeforeUrl).toBe('https://cdn/n.png')
    expect(next.reset).toBe(true)
  })
})
