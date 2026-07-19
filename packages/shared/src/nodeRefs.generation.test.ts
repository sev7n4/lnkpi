import { describe, expect, it } from 'vitest'
import type { GenerationRefPayload } from './nodeRefs'

describe('GenerationRefPayload', () => {
  it('accepts T* and I* shapes', () => {
    const refs: GenerationRefPayload[] = [
      { refKey: 'T1', mediaType: 'text', text: 'hello' },
      { refKey: 'I1', mediaType: 'image', url: 'https://example.com/a.png' },
    ]
    expect(refs).toHaveLength(2)
  })
})
