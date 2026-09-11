import { describe, expect, it } from 'vitest'
import { applyGuideEditIntent, editIntentDisabledReason } from './guideEditIntentApply'

describe('editIntentDisabledReason', () => {
  it('disables E5 without transparent capability', () => {
    expect(
      editIntentDisabledReason('e5_transparent_cutout', {
        transparentBackground: false,
        qualityParam: true,
        maxRefImages: 4,
      }),
    ).toMatch(/透明|transparent/i)
  })

  it('allows E5 when transparent capability is present', () => {
    expect(
      editIntentDisabledReason('e5_transparent_cutout', {
        transparentBackground: true,
        qualityParam: true,
        maxRefImages: 4,
      }),
    ).toBeNull()
  })

  it('does not disable E3 for missing transparent capability', () => {
    expect(
      editIntentDisabledReason('e3_identity_clothing', {
        transparentBackground: false,
        qualityParam: true,
        maxRefImages: 4,
      }),
    ).toBeNull()
  })
})

describe('applyGuideEditIntent', () => {
  it('fills E3 template when ok', () => {
    const r = applyGuideEditIntent({
      intentId: 'e3_identity_clothing',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 2,
      mode: 'fill',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.prompt).toMatch(/clothing|衣服|face|身份/i)
  })

  it('blocks E5 when transparent capability is missing', () => {
    const r = applyGuideEditIntent({
      intentId: 'e5_transparent_cutout',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
      mode: 'fill',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.disabled).toBe(true)
      expect(r.reason).toMatch(/透明|transparent/i)
    }
  })

  it('fill mode still writes template when minRefImages not met', () => {
    const r = applyGuideEditIntent({
      intentId: 'e3_identity_clothing',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
      mode: 'fill',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.prompt).toMatch(/clothing|衣服|face|身份/i)
      expect(r.guideEditIntentId).toBe('e3_identity_clothing')
    }
  })

  it('submit mode blocks when minRefImages not met', () => {
    const r = applyGuideEditIntent({
      intentId: 'e3_identity_clothing',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
      mode: 'submit',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.disabled).toBe(false)
      expect(r.reason).toMatch(/ref|参考/i)
    }
  })

  it('submit mode blocks E5 when transparent capability is missing', () => {
    const r = applyGuideEditIntent({
      intentId: 'e5_transparent_cutout',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
      mode: 'submit',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.disabled).toBe(true)
      expect(r.reason).toMatch(/透明|transparent/i)
    }
  })

  it('submit mode allows when refs and capability ok', () => {
    const r = applyGuideEditIntent({
      intentId: 'e3_identity_clothing',
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 2,
      mode: 'submit',
    })
    expect(r.ok).toBe(true)
  })
})
