import { describe, expect, it } from 'vitest'
import { wipeHoldRatio } from './compareViewModel'

describe('wipeHoldRatio', () => {
  it('snaps to full Before while holding original', () => {
    expect(wipeHoldRatio(true, 0.7)).toBe(0)
  })

  it('keeps the current wipe ratio when not holding', () => {
    expect(wipeHoldRatio(false, 0.7)).toBe(0.7)
  })
})
