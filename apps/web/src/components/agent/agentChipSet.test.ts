/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { detectAgentChipSet } from './agentChipSet'

describe('detectAgentChipSet', () => {
  it('detects plan confirm gate', () => {
    expect(
      detectAgentChipSet('…请确认是否按此方案拆解画布并出图；如需修改请直接说明。'),
    ).toBe('plan')
  })

  it('detects copy draft gate and prefers copy over plan', () => {
    expect(
      detectAgentChipSet('【主文案草稿】\n静音\n\n请确认后回复「写入主文案」…'),
    ).toBe('copy')
  })

  it('returns null for ordinary replies', () => {
    expect(detectAgentChipSet('出图成功')).toBe(null)
  })
})
