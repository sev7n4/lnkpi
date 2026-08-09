import { describe, expect, it } from 'vitest'
import { computeRefPreviewStyle } from './refPreviewPosition'

describe('computeRefPreviewStyle', () => {
  it('places preview above anchor when near bottom', () => {
    const style = computeRefPreviewStyle(
      { left: 100, top: 700, right: 132, bottom: 732, width: 32, height: 32 },
      340,
      300,
    )
    const top = Number.parseFloat(style.top)
    expect(top).toBeLessThan(700)
  })
})
