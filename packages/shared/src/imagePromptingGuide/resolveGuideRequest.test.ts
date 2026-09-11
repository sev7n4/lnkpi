import { describe, expect, it } from 'vitest'
import { resolveGuideRequest } from './resolveGuideRequest'
import type { EditIntent } from './types'

const e5: EditIntent = {
  id: 'e5_transparent_cutout',
  kind: 'edit_intent',
  label: '透明抠图',
  description: 'x',
  changePreserveTemplate: 'Extract…',
  refRoles: [{ role: 'product', required: true, hint: '产品图' }],
  preferredParams: { background: 'transparent', outputFormat: 'png', quality: 'medium' },
  capability: { requiresTransparentBackground: true, minRefImages: 1 },
}

describe('resolveGuideRequest', () => {
  it('blocks E5 when transparentBackground is false', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.blocked?.reason).toMatch(/transparent/i)
    expect(r.applied).toEqual([])
  })

  it('applies transparent when capability true', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.blocked).toBeUndefined()
    expect(r.params.background).toBe('transparent')
    expect(r.applied).toContain('background')
  })

  it('skips quality when qualityParam false', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: false, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.skipped).toContain('quality')
    expect(r.params.quality).toBeUndefined()
  })

  it('blocks when minRefImages not met', () => {
    const r = resolveGuideRequest({
      guide: e5,
      capabilities: { transparentBackground: true, qualityParam: true, maxRefImages: 4 },
      refImageCount: 0,
    })
    expect(r.blocked?.reason).toMatch(/ref/i)
  })
})
