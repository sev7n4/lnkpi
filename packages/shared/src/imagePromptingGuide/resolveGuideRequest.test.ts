import { describe, expect, it } from 'vitest'
import { resolveGuideRequest } from './resolveGuideRequest'
import type { EditIntent } from './types'

const e5: EditIntent = {
  id: 'e5_transparent_cutout',
  kind: 'edit_intent',
  label: '透明抠图',
  description: 'x',
  fundamentalsRefs: ['separate_changes'],
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
    expect(r.blocked?.reason).toMatch(/透明/)
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
    expect(r.blocked?.reason).toMatch(/需要至少 1 张参考图/)
    expect(r.blocked?.reason).toMatch(/产品图/)
  })

  it('minRef block lists required refRoles for multi-ref intents', () => {
    const e3: EditIntent = {
      id: 'e3_identity_clothing',
      kind: 'edit_intent',
      label: '换装保身份',
      description: 'x',
      fundamentalsRefs: ['separate_changes'],
      changePreserveTemplate: 'Edit…',
      refRoles: [
        { role: 'subject', required: true, hint: '人物' },
        { role: 'clothing', required: true, hint: '服装' },
      ],
      preferredParams: {},
      capability: { minRefImages: 2 },
    }
    const r = resolveGuideRequest({
      guide: e3,
      capabilities: { transparentBackground: false, qualityParam: true, maxRefImages: 4 },
      refImageCount: 1,
    })
    expect(r.blocked?.reason).toBe('需要至少 2 张参考图：人物 + 服装')
  })
})
