/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { detectAgentChipSet } from './agentChipSet'

describe('detectAgentChipSet', () => {
  it('detects plan structured options', () => {
    expect(
      detectAgentChipSet(
        '定位：高端\n请选择：\n1. 采纳推荐并确认方案\n2. 换个方向',
      ),
    ).toBe('plan')
  })

  it('detects plan structured options (legacy 1 / A format)', () => {
    // 旧历史消息可能仍然是 "1 / A" 格式，前端需向后兼容
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

  // 修复 P1-4：modify intent 检测
  describe('P1-4: modify intent suppresses plan chip', () => {
    it('suppresses plan chip when user typed "3" (modify branch)', () => {
      // 用户在 plan 阶段输入"3"=选择 C 自己说明修改 → agent 重新进入 modify 模式
      // 此时 assistant 可能仍然包含"请选择"等 plan 关键词，但前端不应该再显示 1/A 按钮
      expect(
        detectAgentChipSet(
          '定位：运动鞋\n请选择：\n1. 采纳推荐并确认方案',
          { latestUserText: '3' },
        ),
      ).toBe(null)
    })

    it('suppresses plan chip when user typed explicit modify instructions', () => {
      expect(
        detectAgentChipSet(
          '定位：运动鞋\n请选择：\n1. 采纳推荐并确认方案',
          { latestUserText: '请把模特定妆改为双人模特，增加产品材质特写图' },
        ),
      ).toBe(null)
    })

    it('still shows plan chip for "1/A" confirmation reply', () => {
      // 用户说"1" 或"确认方案" → agent 走 confirm 分支 → 应该显示 plan chip
      expect(
        detectAgentChipSet(
          '正在写入确认方案并拆解画布骨架（先不出图）\n请选择：1. 采纳',
          { latestUserText: '1' },
        ),
      ).toBe('plan')
    })

    it('suppresses chip on lowercase "c" modify', () => {
      expect(
        detectAgentChipSet('请选择：\n1. 采纳', { latestUserText: 'c' }),
      ).toBe(null)
    })
  })
})
