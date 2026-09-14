/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import { buildGenerationProposePresentation } from './generationProposePresentation'

describe('buildGenerationProposePresentation (Phase 2c.2 D1–D4)', () => {
  it('D1: kind generation_propose with title/type and prompt preview from node', () => {
    const envelope = buildGenerationProposePresentation({
      id: 'img-1',
      type: 'image',
      data: {
        title: '礼盒主视觉',
        prompt: '红金礼盒正面特写，柔和顶光',
        imageModel: 'nano-banana',
        imageAspect: '16:9',
      },
    })
    expect(envelope.kind).toBe('generation_propose')
    expect(envelope.title).toBe('礼盒主视觉')
    expect(envelope.body?.text).toContain('红金礼盒正面特写')
    expect(envelope.body?.hint).toContain('nano-banana')
    expect(envelope.body?.hint).toContain('16:9')
    expect(envelope.primary_action).toBeUndefined()
  })

  it('D1 fallback: no title → type label', () => {
    const envelope = buildGenerationProposePresentation({
      id: 'vid-1',
      type: 'video',
      data: { prompt: '产品旋转展示' },
    })
    expect(envelope.kind).toBe('generation_propose')
    expect(envelope.title).toBe('视频')
    expect(envelope.body?.text).toBe('产品旋转展示')
  })

  it('D2: rebuild follows node prompt (SSOT), ignores stale summary promptPreview', () => {
    const node = {
      id: 'img-1',
      type: 'image',
      data: { prompt: '新提示词：蓝金礼盒' },
    }
    const stale = { promptPreview: '过期聊天文案：旧红金' }
    const envelope = buildGenerationProposePresentation(node, stale)
    expect(envelope.body?.text).toContain('蓝金礼盒')
    expect(envelope.body?.text).not.toContain('过期')
    expect(envelope.body?.text).not.toContain('旧红金')

    node.data.prompt = '再次改写：银白礼盒'
    const next = buildGenerationProposePresentation(node, stale)
    expect(next.body?.text).toContain('银白礼盒')
  })

  it('D3: missing credits_hint still yields a valid envelope', () => {
    const envelope = buildGenerationProposePresentation({
      id: 'img-2',
      type: 'image',
      data: { prompt: '白底产品图' },
    })
    expect(envelope.kind).toBe('generation_propose')
    expect(envelope.body?.credits_hint).toBeUndefined()
    expect(envelope.body?.text).toBe('白底产品图')
  })

  it('D4: surfaces credits_hint from node', () => {
    const envelope = buildGenerationProposePresentation({
      id: 'img-3',
      type: 'image',
      data: { prompt: '场景图', credits_hint: '约 12 积分' },
    })
    expect(envelope.body?.credits_hint).toBe('约 12 积分')
  })

  it('D4: surfaces credits_hint from summary when node lacks it', () => {
    const envelope = buildGenerationProposePresentation(
      { id: 'img-4', type: 'image', data: { prompt: '场景图' } },
      { credits_hint: '约 8 积分' },
    )
    expect(envelope.body?.credits_hint).toBe('约 8 积分')
  })
})
