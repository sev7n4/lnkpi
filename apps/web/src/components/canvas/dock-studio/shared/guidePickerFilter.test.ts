import { GUIDE_GROUP_ORDER, listGenerationScenes } from '@lnkpi/shared'
import { describe, expect, it } from 'vitest'
import { filterGuideItems, groupGuideItems } from './guidePickerFilter'

type GuideItem = {
  id: string
  label: string
  description: string
  groupId?: string
}

const sampleItems: GuideItem[] = [
  {
    id: 'g1_style_lighting',
    label: '风格与光照',
    description: 'Adjust mood and lighting on a subject.',
    groupId: 'photo_ad',
  },
  {
    id: 'g4_reusable_logo',
    label: '可复用 Logo',
    description: 'Create a simple, reusable logo mark with a clean transparent background.',
    groupId: 'brand_ui',
  },
  {
    id: 'g2_process_infographic',
    label: '流程信息图',
    description: 'Explain a process with labeled steps.',
    groupId: 'info_design',
  },
  {
    id: 'legacy_item',
    label: 'Legacy',
    description: 'Item without a group.',
  },
]

describe('filterGuideItems', () => {
  it('returns all items when query is empty', () => {
    expect(filterGuideItems(sampleItems, '')).toEqual(sampleItems)
  })

  it('returns all items when query is whitespace only', () => {
    expect(filterGuideItems(sampleItems, '   \t  ')).toEqual(sampleItems)
  })

  it('matches logo against id, label, or description (case-insensitive)', () => {
    const scenes = listGenerationScenes()
    const matches = filterGuideItems(scenes, 'logo')
    expect(matches.some((item) => item.id === 'g4_reusable_logo')).toBe(true)
    expect(matches.every((item) => {
      const haystack = `${item.id} ${item.label} ${item.description}`.toLowerCase()
      return haystack.includes('logo')
    })).toBe(true)
  })

  it('matches against groupId when present', () => {
    const matches = filterGuideItems(sampleItems, 'brand_ui')
    expect(matches.map((item) => item.id)).toEqual(['g4_reusable_logo'])
  })

  it('is case-insensitive', () => {
    const matches = filterGuideItems(sampleItems, 'LOGO')
    expect(matches.map((item) => item.id)).toEqual(['g4_reusable_logo'])
  })
})

describe('groupGuideItems', () => {
  it('clusters items by groupId following order and skips empty groups', () => {
    const grouped = groupGuideItems(sampleItems, GUIDE_GROUP_ORDER)

    expect(grouped.map((g) => g.groupId)).toEqual(['photo_ad', 'info_design', 'brand_ui', 'ungrouped'])
    expect(grouped[0]?.groupLabel).toBe('摄影/广告')
    expect(grouped[0]?.items.map((item) => item.id)).toEqual(['g1_style_lighting'])
    expect(grouped[1]?.groupLabel).toBe('信息设计')
    expect(grouped[2]?.groupLabel).toBe('品牌/UI')
    expect(grouped[2]?.items.map((item) => item.id)).toEqual(['g4_reusable_logo'])
  })

  it('places items without groupId in a final ungrouped bucket labeled 其他', () => {
    const grouped = groupGuideItems(sampleItems, GUIDE_GROUP_ORDER)
    const ungrouped = grouped.find((g) => g.groupId === 'ungrouped')

    expect(ungrouped?.groupLabel).toBe('其他')
    expect(ungrouped?.items.map((item) => item.id)).toEqual(['legacy_item'])
  })

  it('preserves item order within each group', () => {
    const items: GuideItem[] = [
      { id: 'a', label: 'A', description: 'first', groupId: 'photo_ad' },
      { id: 'b', label: 'B', description: 'second', groupId: 'photo_ad' },
      { id: 'c', label: 'C', description: 'third', groupId: 'brand_ui' },
    ]

    const grouped = groupGuideItems(items, GUIDE_GROUP_ORDER)
    const photoAd = grouped.find((g) => g.groupId === 'photo_ad')

    expect(photoAd?.items.map((item) => item.id)).toEqual(['a', 'b'])
  })
})
