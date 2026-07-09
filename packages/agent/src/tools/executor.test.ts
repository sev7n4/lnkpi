import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CanvasToolExecutor } from './executor'

describe('CanvasToolExecutor', () => {
  it('create_shot returns shotId and add_node action', async () => {
    const executor = new CanvasToolExecutor()
    const ctx = {
      sessionId: 'sess-1',
      canvasData: { nodes: [], edges: [] },
      shots: [],
      userMessage: 'test',
      history: [],
    }
    const { result, actions } = await executor.execute(
      'create_shot',
      { prompt: '赛博朋克城市', title: '分镜1' },
      ctx,
    )
    expect(result).toMatchObject({ title: '分镜1' })
    expect(actions[0].type).toBe('add_node')
    expect(actions[0].payload.nodeType).toBe('shot')
  })

  describe('generate_image', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }),
      }))
      process.env.OPENAI_API_KEY = 'test-key'
    })

    afterEach(() => {
      vi.unstubAllGlobals()
      delete process.env.OPENAI_API_KEY
    })

    it('uses image provider and returns url', async () => {
      const executor = new CanvasToolExecutor()
      const shotId = 'shot-test-1'
      const ctx = {
        sessionId: 'sess-1',
        canvasData: { nodes: [], edges: [] },
        shots: [{ id: shotId, sessionId: 'sess-1', title: '分镜', prompt: '', order: 0, status: 'draft' as const, position: { x: 0, y: 0 }, materials: [] }],
        userMessage: 'test',
        history: [],
      }
      const { result, actions } = await executor.execute(
        'generate_image',
        { prompt: '赛博朋克城市', shotId },
        ctx,
      )
      expect(result).toMatchObject({ imageUrl: 'https://example.com/img.png', prompt: '赛博朋克城市' })
      expect(actions[0].payload.nodeType).toBe('image')
      expect(actions[0].payload.data?.url).toBe('https://example.com/img.png')
    })
  })
})
