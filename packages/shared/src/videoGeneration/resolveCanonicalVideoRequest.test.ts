/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { resolveCanonicalVideoRequest } from './resolveCanonicalVideoRequest'

const IMG = 'https://cdn.example/ref.png'

const baseVideoNode = {
  id: 'v1',
  type: 'video' as const,
  position: { x: 0, y: 0 },
  data: { prompt: '产品展示', videoSettings: { duration: 15 } },
}

describe('resolveCanonicalVideoRequest', () => {
  it('path1: localRefs upload → single I1 image ref', () => {
    const req = resolveCanonicalVideoRequest({
      node: {
        ...baseVideoNode,
        data: {
          ...baseVideoNode.data,
          localRefs: [
            { id: 'a1', mediaType: 'image', sourceKind: 'upload', label: '图', url: IMG },
          ],
        },
      },
      canvas: { nodes: [baseVideoNode], edges: [] },
      sessionId: 's1',
    })
    expect(req.refs).toHaveLength(1)
    expect(req.refs[0].refKey).toBe('I1')
    expect(req.refs[0].url).toBe(IMG)
    expect(req.videoMode).toBe('image_to_video')
    expect(req.videoSettings.duration).toBe(15)
    expect(req.scope).toEqual({ sessionId: 's1', nodeId: 'v1' })
  })

  it('path2: edge from image node → same I1', () => {
    const req = resolveCanonicalVideoRequest({
      node: baseVideoNode,
      canvas: {
        nodes: [
          baseVideoNode,
          {
            id: 'i1',
            type: 'image',
            position: { x: 0, y: 0 },
            data: { url: IMG },
          },
        ],
        edges: [{ id: 'e1', source: 'i1', target: 'v1' }],
      },
    })
    expect(req.refs).toHaveLength(1)
    expect(req.refs[0].url).toBe(IMG)
    expect(req.videoMode).toBe('image_to_video')
  })

  it('path3: agent localRefs + mentionedKeys → same I1', () => {
    const req = resolveCanonicalVideoRequest({
      node: {
        ...baseVideoNode,
        data: {
          ...baseVideoNode.data,
          localRefs: [
            {
              id: 'sidebar-att-1',
              mediaType: 'image',
              sourceKind: 'upload',
              label: '@I1',
              url: IMG,
            },
          ],
          mentionedKeys: ['I1'],
        },
      },
      canvas: { nodes: [baseVideoNode], edges: [] },
    })
    expect(req.refs[0].url).toBe(IMG)
    expect(req.mentionedKeys).toEqual(['I1'])
  })

  it('falls back to account defaults for missing videoSettings', () => {
    const req = resolveCanonicalVideoRequest({
      node: {
        ...baseVideoNode,
        data: { prompt: '展示' },
      },
      canvas: { nodes: [baseVideoNode], edges: [] },
      accountDefaults: {
        duration: 10,
        aspectRatio: '9:16',
        resolution: '1080p',
        crop: 'center',
        model: 'platform::default-video',
      },
    })
    expect(req.videoSettings.duration).toBe(10)
    expect(req.videoSettings.aspectRatio).toBe('9:16')
    expect(req.model).toBe('platform::default-video')
    expect(req.videoMode).toBe('text_to_video')
  })
})
