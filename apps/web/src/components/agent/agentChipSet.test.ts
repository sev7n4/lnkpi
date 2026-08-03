/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { detectAgentChipSet } from './agentChipSet'

describe('detectAgentChipSet', () => {
  it('detects plan structured options (new format)', () => {
    expect(
      detectAgentChipSet(
        '定位：高端\n请选择：\n1. 采纳推荐并确认方案\n2. 换个方向再改一版\n3. 我自己说明修改',
      ),
    ).toBe('plan')
  })

  it('detects plan structured options (legacy format)', () => {
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

  it('prefers copy when draft not yet written even if footer mentions 确认出图', () => {
    expect(
      detectAgentChipSet(
        '【主文案草稿】\n静音\n\n请确认后回复「写入主文案」。拓扑确认无误后回复「确认出图」。',
      ),
    ).toBe('copy')
  })

  it('shows topo after copy written and footer mentions 确认出图', () => {
    expect(
      detectAgentChipSet(
        '【主文案草稿】\n静音\n\n已将确认的主文案写入画布节点。拓扑确认无误后回复「确认出图」。',
      ),
    ).toBe('topo')
  })

  it('detects atomic confirm gate', () => {
    expect(
      detectAgentChipSet('视频/音频生成将消耗积分。回复「确认生成」开始，或「取消」放弃。'),
    ).toBe('atomic')
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

  // 修复 P1-4 + P2-1：modify intent 检测的新优先级逻辑
  describe('P1-4 + P2-1: modify intent 与 confirm 选项的优先级', () => {
    it('shows plan chip when agent replies with new confirm after modify', () => {
      // 用户输入"3" → agent 重新生成 → 回复新 confirm 选项
      // 这时应该显示 plan 按钮，让用户确认新方案
      expect(
        detectAgentChipSet(
          '定位：运动鞋\n请选择：\n1. 采纳推荐并确认方案\n2. 换个方向再改一版',
          { latestUserText: '3' },
        ),
      ).toBe('plan')
    })

    it('shows plan chip when agent replies after explicit modify instructions', () => {
      // 用户输入"把模特定妆改为双人模特" → agent 重新生成 → 回复新 confirm
      expect(
        detectAgentChipSet(
          '定位：蓝牙耳机\n请选择：\n1. 采纳推荐并确认方案',
          { latestUserText: '把模特定妆改为双人模特，增加产品材质特写图' },
        ),
      ).toBe('plan')
    })

    it('suppresses chip when agent is still transitioning (no confirm options)', () => {
      // 用户输入 modify intent → agent 回复过渡消息（"正在调整…"）
      // 此时不含 confirm 选项 → 抑制 chip
      expect(
        detectAgentChipSet(
          '好的，正在基于当前方案调整您提到的部分，保留其余节点不变，请稍候…',
          { latestUserText: '把模特定妆改为双人模特' },
        ),
      ).toBe(null)
    })

    it('still shows plan chip for "1/A" confirmation reply', () => {
      expect(
        detectAgentChipSet(
          '正在写入确认方案并拆解画布骨架（先不出图）\n请选择：1. 采纳推荐',
          { latestUserText: '1' },
        ),
      ).toBe('plan')
    })

    it('suppresses chip on lowercase "c" modify with transition message', () => {
      expect(
        detectAgentChipSet('好的，正在基于当前方案调整…', { latestUserText: 'c' }),
      ).toBe(null)
    })
  })
})
