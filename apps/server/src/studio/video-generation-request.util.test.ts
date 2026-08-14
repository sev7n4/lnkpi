/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  buildCanonicalVideoRequestFromBody,
  resolveVideoStartRequest,
} from './video-generation-request.util'

describe('resolveVideoStartRequest', () => {
  it('uses canvas node when session canvas is available', () => {
    const { request } = resolveVideoStartRequest({
      body: { prompt: 'ignored' },
      sessionId: 's1',
      nodeId: 'v1',
      canvas: {
        nodes: [
          {
            id: 'v1',
            type: 'video',
            position: { x: 0, y: 0 },
            data: {
              prompt: '来自节点',
              localRefs: [
                {
                  id: 'a1',
                  mediaType: 'image',
                  sourceKind: 'upload',
                  label: '图',
                  url: 'https://cdn.example/a.png',
                },
              ],
            },
          },
        ],
        edges: [],
      },
    })
    expect(request.prompt).toBe('来自节点')
    expect(request.refs[0]?.url).toBe('https://cdn.example/a.png')
  })

  it('falls back to request body when canvas node missing', () => {
    const { request } = resolveVideoStartRequest({
      body: {
        prompt: 'body prompt',
        duration: 15,
        refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://cdn.example/b.png' }],
        sessionId: 's1',
        nodeId: 'v1',
      },
    })
    expect(request.prompt).toBe('body prompt')
    expect(request.videoSettings.duration).toBe(15)
  })
})

describe('buildCanonicalVideoRequestFromBody', () => {
  it('infers image_to_video when refs contain image', () => {
    const req = buildCanonicalVideoRequestFromBody({
      prompt: 'x',
      refs: [{ refKey: 'I1', mediaType: 'image', url: 'https://x/y.png' }],
    })
    expect(req.videoMode).toBe('image_to_video')
  })
})
