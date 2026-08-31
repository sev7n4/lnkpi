import { describe, expect, it } from 'vitest'
import { mergeMaskRgba } from './maskRemote'

function rgba(vals: number[]) {
  return new Uint8ClampedArray(vals)
}

describe('mergeMaskRgba', () => {
  it('add paints remote opaque pixels', () => {
    const base = rgba([0, 0, 0, 0, 0, 0, 0, 0])
    const remote = rgba([255, 255, 255, 255, 0, 0, 0, 0])
    const out = mergeMaskRgba({
      width: 2,
      height: 1,
      baseMaskRgba: base,
      remoteMaskRgba: remote,
      fillRgb: [9, 9, 9],
      mode: 'add',
    })
    expect([...out.slice(0, 4)]).toEqual([9, 9, 9, 255])
    expect([...out.slice(4, 8)]).toEqual([0, 0, 0, 0])
  })

  it('subtract clears remote opaque pixels', () => {
    const base = rgba([9, 9, 9, 255, 9, 9, 9, 255])
    const remote = rgba([255, 255, 255, 200, 0, 0, 0, 0])
    const out = mergeMaskRgba({
      width: 2,
      height: 1,
      baseMaskRgba: base,
      remoteMaskRgba: remote,
      fillRgb: [9, 9, 9],
      mode: 'subtract',
    })
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([9, 9, 9, 255])
  })
})
