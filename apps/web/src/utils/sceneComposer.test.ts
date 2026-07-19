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
})
