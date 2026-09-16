/** @vitest-environment node */
import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import {
  buildCanonicalVideoRequestFromBody,
  resolveVideoStartRequest,
} from './video-generation-request.util'

function canvasNode(
  id: string,
  type: 'image' | 'text' | 'video',
  data: Record<string, unknown>,
) {
  return { id, type, position: { x: 0, y: 0 }, data }
}

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

  it('keeps body prompt when canvas exists but video node and P block are absent', () => {
    const { request } = resolveVideoStartRequest({
      body: { prompt: 'body prompt' },
      sessionId: 's1',
      nodeId: 'video-v',
      canvas: {
        nodes: [canvasNode('image-i0', 'image', { prompt: 'I0' })],
        edges: [],
      },
    })
    expect(request.prompt).toBe('body prompt')
  })

  it('replaces video node snapshot with live text-p prompt', () => {
    const { request } = resolveVideoStartRequest({
      body: { prompt: 'OLD' },
      sessionId: 's1',
      nodeId: 'video-v',
      canvas: {
        nodes: [
          canvasNode('image-i0', 'image', { prompt: 'I0' }),
          canvasNode('image-look-0', 'image', { prompt: 'LOOK' }),
          canvasNode('text-p', 'text', { prompt: 'NEW SCRIPT' }),
          canvasNode('video-v', 'video', { prompt: 'OLD' }),
        ],
        edges: [],
      },
    })
    expect(request.prompt).toBe('NEW SCRIPT')
  })

  it('throws when composition text-p is empty', () => {
    expect(() =>
      resolveVideoStartRequest({
        body: { prompt: 'OLD' },
        sessionId: 's1',
        nodeId: 'video-v',
        canvas: {
          nodes: [
            canvasNode('text-p', 'text', { prompt: '' }),
            canvasNode('video-v', 'video', { prompt: 'OLD' }),
          ],
          edges: [],
        },
      }),
    ).toThrow(BadRequestException)
    expect(() =>
      resolveVideoStartRequest({
        body: { prompt: 'OLD' },
        sessionId: 's1',
        nodeId: 'video-v',
        canvas: {
          nodes: [
            canvasNode('text-p', 'text', { prompt: '' }),
            canvasNode('video-v', 'video', { prompt: 'OLD' }),
          ],
          edges: [],
        },
      }),
    ).toThrow('分镜还是空的，写好后再生成视频。')
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

  it('passes seed and negativePrompt from body', () => {
    const req = buildCanonicalVideoRequestFromBody({
      prompt: 'x',
      seed: 42.7,
      negativePrompt: ' watermark ',
    })
    expect(req.seed).toBe(42)
    expect(req.negativePrompt).toBe('watermark')
  })
})
