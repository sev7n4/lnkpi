/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { detectAgentChipSet } from './agentChipSet'

describe('detectAgentChipSet', () => {
  it('detects plan structured options', () => {
    expect(
      detectAgentChipSet(
        '定位：高端\n请选择：\n1 / A：采纳推荐并确认方案\n2 / B：换个方向',
      ),
    ).toBe('plan')
  })

  it('detects copy draft gate', () => {
    expect(
      detectAgentChipSet('【主文案草稿】\n静音\n\n请确认后回复「写入主文案」…'),
    ).toBe('copy')
  })

  it('prefers topo when draft also mentions 确认出图', () => {
    expect(
      detectAgentChipSet(
        '【主文案草稿】\n静音\n\n请确认后回复「写入主文案」。拓扑确认无误后回复「确认出图」。',
      ),
    ).toBe('topo')
  })

  it('detects topo gate and prefers topo over bare plan words', () => {
    expect(
      detectAgentChipSet(
        '已拆解骨架\n当前资产拓扑：\n```mermaid\nflowchart LR\n```\n确认无误后回复「确认出图」。',
      ),
    ).toBe('topo')
  })

  it('returns null for ordinary replies', () => {
    expect(detectAgentChipSet('出图成功')).toBe(null)
  })
})
