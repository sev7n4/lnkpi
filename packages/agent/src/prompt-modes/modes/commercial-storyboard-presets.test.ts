import { describe, it, expect } from 'vitest'
import {
  AITO_PRODUCT_SPECS,
  COMMERCIAL_RHYTHM_PRESETS,
  COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE,
  COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE,
  COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE,
} from './commercial-storyboard-presets'

describe('commercial-storyboard-presets', () => {
  it('defines three rhythm models', () => {
    expect(COMMERCIAL_RHYTHM_PRESETS.map((p) => p.id)).toEqual([
      'lightning_cut',
      'aida_narrative',
      'immersive_empathy',
    ])
  })

  it('includes AITO product specs', () => {
    expect(AITO_PRODUCT_SPECS.some((s) => s.model.includes('M9'))).toBe(true)
  })

  it('primary example has table and checklist', () => {
    expect(COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE.assistant).toContain('分镜执行脚本')
    expect(COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE.assistant).toContain('质量校验锁')
    expect(COMMERCIAL_STORYBOARD_PRIMARY_EXAMPLE.assistant).toContain('| 序号 |')
  })

  it('lightning example has 8 shots and lightning rhythm', () => {
    expect(COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE.assistant).toContain('闪电切割模型')
    expect(COMMERCIAL_STORYBOARD_LIGHTNING_EXAMPLE.assistant.match(/\| \d+ \|/g)?.length).toBe(8)
  })

  it('immersive example has 12 shots and immersive rhythm', () => {
    expect(COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE.assistant).toContain('沉浸移情模型')
    expect(COMMERCIAL_STORYBOARD_IMMERSIVE_EXAMPLE.assistant.match(/\| \d+ \|/g)?.length).toBe(12)
  })
})
