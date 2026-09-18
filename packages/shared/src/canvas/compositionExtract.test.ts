import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1, GOLD_COMPOSE_2 } from './compositionGold'
import {
  extractCompositionPrimitives,
  isCompositionStructureUtterance,
} from './compositionExtract'

describe('compositionExtract', () => {
  it('gold 1 is structure intent and extracts identity, garments, wantVideo', () => {
    expect(isCompositionStructureUtterance(GOLD_COMPOSE_1)).toBe(true)
    const got = extractCompositionPrimitives(GOLD_COMPOSE_1)
    expect(got).toEqual({
      ok: true,
      primitives: {
        identityRef: 'I1',
        skipI0: false,
        garmentRefs: ['I2', 'I3'],
        otherRefs: [],
        wantVideo: true,
        sequence: [],
      },
    })
  })

  it('gold 2 is structure intent with product sequence, no garments', () => {
    expect(isCompositionStructureUtterance(GOLD_COMPOSE_2)).toBe(true)
    const got = extractCompositionPrimitives(GOLD_COMPOSE_2)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.identityRef).toBe('I1')
    expect(got.primitives.garmentRefs).toEqual([])
    expect(got.primitives.otherRefs).toEqual([{ ref: 'I2', role: 'scene' }])
    expect(got.primitives.wantVideo).toBe(false)
    expect(got.primitives.sequence).toEqual(['white_bg', 'scene'])
  })

  it('does not treat 换装 or 生图生视频 alone as structure intent', () => {
    expect(isCompositionStructureUtterance('换装')).toBe(false)
    expect(isCompositionStructureUtterance('生图生视频')).toBe(false)
    expect(isCompositionStructureUtterance('改画布上那个节点的提示词')).toBe(false)
  })

  it('做一个图生视频工作流 is structure + wantVideo, not incomplete', () => {
    expect(isCompositionStructureUtterance('做一个图生视频工作流')).toBe(true)
    const got = extractCompositionPrimitives('做一个图生视频工作流')
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.wantVideo).toBe(true)
    expect(got.primitives.garmentRefs).toEqual([])
  })

  it('skipI0 only when user says already 白底三视图/四视图', () => {
    const u = GOLD_COMPOSE_1.replace('作为模特', '作为模特，已经是清晰白底三视图')
    const got = extractCompositionPrimitives(u)
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.primitives.skipI0).toBe(true)
  })

  it('more than 4 garments is extract_incomplete', () => {
    const u =
      '@I1 作为模特，@I2 @I3 @I4 @I5 @I6 这些是服装图，设计一段工作流并做好连线，写入画布'
    const got = extractCompositionPrimitives(u)
    expect(got).toEqual({ ok: false, code: 'extract_incomplete' })
  })

  it('resumes extract from I1/I2 assignment without @', () => {
    const got = extractCompositionPrimitives('作为模特换装，服装图 I1 模特 I2 I3 服装')
    expect(got).toEqual({
      ok: true,
      primitives: {
        identityRef: 'I1',
        skipI0: false,
        garmentRefs: ['I2', 'I3'],
        otherRefs: [],
        wantVideo: false,
        sequence: [],
      },
    })
  })

  it('production oral 这个是模特 / 这几个是服装 extracts I1 + I2-I5', () => {
    const u =
      '@I1 这个是模特， @I2  @I3  @I4  @I5 这几个是服装，请帮我设计一套模特换装工作流方案，含一键生图生视频'
    expect(isCompositionStructureUtterance(u)).toBe(true)
    const got = extractCompositionPrimitives(u)
    expect(got).toEqual({
      ok: true,
      primitives: {
        identityRef: 'I1',
        skipI0: false,
        garmentRefs: ['I2', 'I3', 'I4', 'I5'],
        otherRefs: [],
        wantVideo: true,
        sequence: [],
      },
    })
  })
})
