import { describe, expect, it } from 'vitest'
import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import { defaultModelKey } from '@/constants/studioModels'
import type { SceneComposerPayload } from '@lnkpi/shared'
import { buildBatchGenerateItems } from '@/utils/sceneComposer'

const payload: SceneComposerPayload = {
  title: 'Test Composer',
  prompt: '',
  scenes: [
    {
      id: 'scene-1',
      title: 'Scene 1',
      shots: [
        {
          id: 'shot-1',
          title: 'Shot 1',
          prompt: 'a sunset',
          mediaType: 'image',
          shotNodeId: 'shot-node-1',
          imageNodeId: 'img-1',
        },
      ],
    },
  ],
}

function node(id: string, type: string, data: Record<string, unknown>): EditableFlowNode {
  return { id, type, position: { x: 0, y: 0 }, data }
}

describe('buildBatchGenerateItems', () => {
  it('reads media child node model settings when expanded', () => {
    const items = buildBatchGenerateItems(payload, {
      nodes: [
        node('img-1', 'image', {
          imageModel: 'navo-pro',
          imageAspect: '9:16',
          imageResolution: '2K',
        }),
      ],
    })
    expect(items[0]).toMatchObject({
      mediaType: 'image',
      model: 'navo-pro',
      aspectRatio: '9:16',
      resolution: '2K',
      count: 1,
    })
  })

  it('falls back to catalog defaults when child missing', () => {
    const items = buildBatchGenerateItems(payload, { nodes: [] })
    expect(items[0].model).toBe(defaultModelKey('image'))
  })

  it('uses media child prompt and refs when expanded', () => {
    const textNode = node('text-1', 'text', { content: 'soft lighting', prompt: 'soft lighting' })
    const childNode = node('img-1', 'image', {
      prompt: 'child prompt @T1',
      imageModel: 'navo-pro',
      imageAspect: '16:9',
      imageResolution: '1K',
    })
    const composerNode = node('composer-1', 'sceneComposer', { prompt: 'composer prompt' })
    const items = buildBatchGenerateItems(payload, {
      nodes: [composerNode, childNode, textNode],
      edges: [{ id: 'e-text-child', source: 'text-1', target: 'img-1' }],
      composerNodeId: 'composer-1',
    })
    expect(items[0].prompt).toBe('child prompt @T1')
    expect(items[0].refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ refKey: 'T1', mediaType: 'text', text: 'soft lighting' })]),
    )
    expect(items[0].mentionedKeys).toEqual(['T1'])
  })

  it('falls back to shot prompt and composer refs when child missing', () => {
    const payloadNoChild: SceneComposerPayload = {
      ...payload,
      scenes: [
        {
          ...payload.scenes[0],
          shots: [
            {
              ...payload.scenes[0].shots[0],
              imageNodeId: undefined,
            },
          ],
        },
      ],
    }
    const textNode = node('text-1', 'text', { content: 'composer style', prompt: 'composer style' })
    const composerNode = node('composer-1', 'sceneComposer', { prompt: 'composer prompt' })
    const items = buildBatchGenerateItems(payloadNoChild, {
      nodes: [composerNode, textNode],
      edges: [{ id: 'e-text-composer', source: 'text-1', target: 'composer-1' }],
      composerNodeId: 'composer-1',
    })
    expect(items[0].prompt).toBe('a sunset')
    expect(items[0].refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ refKey: 'T1', mediaType: 'text', text: 'composer style' })]),
    )
    expect(items[0].mentionedKeys).toEqual([])
  })
})
