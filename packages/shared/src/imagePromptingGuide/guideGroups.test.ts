import { describe, expect, it } from 'vitest'
import { GUIDE_GROUP_ORDER, guideGroupLabel } from './guideGroups'

describe('guideGroups', () => {
  it('maps photo_ad to 摄影/广告', () => {
    expect(guideGroupLabel('photo_ad')).toBe('摄影/广告')
  })

  it('defines all seven groups in order', () => {
    expect(GUIDE_GROUP_ORDER).toHaveLength(7)
    expect(GUIDE_GROUP_ORDER).toEqual([
      'photo_ad',
      'info_design',
      'brand_ui',
      'narrative',
      'local_edit',
      'identity_product',
      'ref_compose',
    ])
  })
})
