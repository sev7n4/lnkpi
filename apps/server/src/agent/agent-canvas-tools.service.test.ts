import 'reflect-metadata'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import type { CanvasData } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { StudioService } from '../studio/studio.service'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'

const emptyCanvas = (): CanvasData => ({ nodes: [], edges: [] })

describe('AgentCanvasToolsService', () => {
  let svc: AgentCanvasToolsService
  let canvas: CanvasData
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()
  const prefsFindUnique = vi.fn()
  const generateImage = vi.fn()
  const generateVideo = vi.fn()
  const generateText = vi.fn()
  const generatePrompt = vi.fn()
  const generateAudio = vi.fn()
  const getGeneration = vi.fn()

  const defaultPrefs = {
    userId: 'u1',
    defaultImageModel: 'platform::user-default-image',
    defaultVideoModel: 'platform::user-default-video',
    defaultTextModel: 'platform::user-default-text',
    defaultAudioModel: 'platform::user-default-audio',
    canvasImageCount: 2,
    defaultImageAspect: '9:16',
    defaultImageResolution: '2K',
    defaultVideoAspect: '9:16',
    defaultVideoDuration: 10,
    defaultVideoResolution: '1080p',
    defaultVideoCrop: 'center',
    audioVoice: 'female-shaonv',
    audioFormat: 'mp3',
    audioSpeed: 1,
    audioInstructions: null,
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    canvas = emptyCanvas()
    sessionFindUnique.mockImplementation(async () => ({
      id: 's1',
      userId: 'u1',
      canvasData: JSON.stringify(canvas),
    }))
    sessionUpdate.mockImplementation(async ({ data }: { data: { canvasData: string } }) => {
      canvas = JSON.parse(data.canvasData) as CanvasData
      return { id: 's1', canvasData: data.canvasData }
    })
    prefsFindUnique.mockResolvedValue(defaultPrefs)
    generateImage.mockResolvedValue({
      id: 'gen-1',
      status: 'completed',
      url: 'https://cdn.example/img.png',
    })
    generateVideo.mockResolvedValue({
      id: 'gen-v1',
      status: 'completed',
      url: 'https://cdn.example/vid.mp4',
    })
    getGeneration.mockResolvedValue({
      id: 'gen-1',
      status: 'completed',
      url: 'https://cdn.example/img.png',
    })
    generateText.mockResolvedValue({
      id: 'gen-t1',
      status: 'completed',
      metadata: JSON.stringify({ text: '买它！限时优惠。' }),
    })
    generatePrompt.mockResolvedValue({
      id: 'gen-p1',
      status: 'completed',
      metadata: JSON.stringify({ mode: 'image_prompt_multi_style', content: '扩写后的 prompt...' }),
    })
    generateAudio.mockResolvedValue({
      id: 'gen-a1',
      status: 'completed',
      url: 'https://cdn.example/audio.mp3',
    })

    // Serialize concurrent $transaction callbacks.
    // serializable / read-committed TX chain would queue concurrent
    // persist() calls so each one sees the post-commit state of the
    // previous. Without this queue, the mock would let N concurrent
    // findUnique calls race ahead of any update and the race-condition
    // regression test would lose updates even though persist() is now
    // correct.
    let txChain: Promise<unknown> = Promise.resolve()
    const $transaction = (fn: (tx: {
      session: { findUnique: typeof sessionFindUnique; update: typeof sessionUpdate }
    }) => Promise<unknown>) => {
      const next = txChain.then(() =>
        fn({ session: { findUnique: sessionFindUnique, update: sessionUpdate } }),
      )
      txChain = next.catch(() => undefined)
      return next
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentCanvasToolsService,
        {
          provide: PrismaService,
          useValue: {
            session: { findUnique: sessionFindUnique, update: sessionUpdate },
            userAiPreferences: { findUnique: prefsFindUnique },
            $transaction,
          },
        },
        {
          provide: StudioService,
          useValue: { generateImage, generateVideo, generateText, generatePrompt, generateAudio, getGeneration },
        },
      ],
    }).compile()
    svc = moduleRef.get(AgentCanvasToolsService)
    // Speed up polling in unit tests
    svc.pollIntervalMs = 1
    svc.pollTimeoutMs = 50
  })

  it('upsertPromptNode creates prompt node and returns add_node action', async () => {
    const result = await svc.upsertPromptNode({
      sessionId: 's1',
      userId: 'u1',
      prompt: '卫生洁具营销',
      content: '# 方案\n...',
    })
    expect(result.nodeId).toBeTruthy()
    expect(result.actions.some((a) => a.type === 'add_node')).toBe(true)
    expect(sessionUpdate).toHaveBeenCalled()
    expect(canvas.nodes).toHaveLength(1)
    expect(canvas.nodes[0].type).toBe('prompt')
    expect(canvas.nodes[0].data.prompt).toBe('卫生洁具营销')
    expect(canvas.nodes[0].data.content).toBe('# 方案\n...')
  })

  it('upsertPromptNode updates existing prompt node', async () => {
    canvas = {
      nodes: [
        {
          id: 'prompt-1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { prompt: 'old', content: 'old' },
        },
      ],
      edges: [],
    }
    const result = await svc.upsertPromptNode({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'prompt-1',
      prompt: 'new prompt',
      content: 'new content',
    })
    expect(result.nodeId).toBe('prompt-1')
    expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
    expect(canvas.nodes[0].data.prompt).toBe('new prompt')
    expect(canvas.nodes[0].data.content).toBe('new content')
  })

  it('getNode returns node snapshot', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 100, y: 0 },
          data: { title: '白底', url: 'https://x/a.png', status: 'completed' },
        },
      ],
      edges: [],
    }
    const node = await svc.getNode({ sessionId: 's1', nodeId: 'img-1' })
    expect(node.id).toBe('img-1')
    expect(node.data.url).toBe('https://x/a.png')
  })

  it('getCanvasSummary returns id/type/title/status without full content', async () => {
    canvas = {
      nodes: [
        {
          id: 'p1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { title: '方案', status: 'draft', content: '# huge' },
        },
      ],
      edges: [],
    }
    const summary = await svc.getCanvasSummary({ sessionId: 's1' })
    expect(summary.nodes).toEqual([{ id: 'p1', type: 'prompt', title: '方案', status: 'draft' }])
    expect(JSON.stringify(summary)).not.toContain('# huge')
  })

  it('addNodesBatch creates skeleton nodes with grid offset and returns key map', async () => {
    const result = await svc.addNodesBatch({
      sessionId: 's1',
      userId: 'u1',
      items: [
        { key: 'white_bg', title: '白底图', targetType: 'image' },
        { key: 'hero_main', title: '主图', targetType: 'image' },
      ],
    })
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0].key).toBe('white_bg')
    expect(result.nodes[1].key).toBe('hero_main')
    expect(result.actions.every((a) => a.type === 'add_node')).toBe(true)
    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes[1].position.x - canvas.nodes[0].position.x).toBe(280)
  })

  it('connectNodes adds edges', async () => {
    canvas = {
      nodes: [
        { id: 'a', type: 'image', position: { x: 0, y: 0 }, data: {} },
        { id: 'b', type: 'image', position: { x: 280, y: 0 }, data: {} },
      ],
      edges: [],
    }
    const result = await svc.connectNodes({
      sessionId: 's1',
      edges: [{ source: 'a', target: 'b' }],
    })
    expect(result.actions.some((a) => a.type === 'add_edge')).toBe(true)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.edges[0].source).toBe('a')
    expect(canvas.edges[0].target).toBe('b')
  })

  it('setNodePrompt updates prompt on node', async () => {
    canvas = {
      nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }
    const result = await svc.setNodePrompt({
      sessionId: 's1',
      nodeId: 'img-1',
      prompt: '白底产品图',
    })
    expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
    expect(canvas.nodes[0].data.prompt).toBe('白底产品图')
  })

  it('setNodeContent writes content and completed status', async () => {
    canvas = {
      nodes: [{ id: 't1', type: 'text', position: { x: 0, y: 0 }, data: { prompt: '主文案' } }],
      edges: [],
    }
    const result = await svc.setNodeContent({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 't1',
      content: '静音·洁净·极简',
    })
    expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
    expect(canvas.nodes.find((n) => n.id === 't1')?.data.content).toBe('静音·洁净·极简')
    expect(canvas.nodes.find((n) => n.id === 't1')?.data.status).toBe('completed')
  })

  it('attachRefs sets refOrder and ensures edges exist', async () => {
    canvas = {
      nodes: [
        { id: 'src', type: 'prompt', position: { x: 0, y: 0 }, data: { content: 'plan' } },
        { id: 'img-1', type: 'image', position: { x: 280, y: 0 }, data: {} },
      ],
      edges: [],
    }
    const result = await svc.attachRefs({
      sessionId: 's1',
      nodeId: 'img-1',
      refOrder: ['src'],
    })
    expect(canvas.edges.some((e) => e.source === 'src' && e.target === 'img-1')).toBe(true)
    expect(canvas.nodes.find((n) => n.id === 'img-1')?.data.refOrder).toEqual(
      expect.arrayContaining([expect.stringContaining('src')]),
    )
    expect(result.actions.length).toBeGreaterThan(0)
  })

  it('runImageGeneration calls Studio, writes url, returns actions', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { prompt: '洁具白底图', status: 'draft' },
        },
      ],
      edges: [],
    }
    const result = await svc.runImageGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'img-1',
    })
    expect(generateImage).toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.url).toBe('https://cdn.example/img.png')
    expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
    expect(canvas.nodes[0].data.url).toBe('https://cdn.example/img.png')
    expect(canvas.nodes[0].data.status).toBe('completed')
  })

  it('runImageGeneration falls back to account default image prefs when node lacks fields', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { prompt: '洁具白底图', status: 'draft' },
        },
      ],
      edges: [],
    }
    await svc.runImageGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'img-1',
    })
    expect(prefsFindUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(generateImage).toHaveBeenCalledWith(
      'u1',
      '洁具白底图',
      'platform::user-default-image',
      '9:16',
      expect.any(Array),
      undefined,
      '2K',
      2,
      { sessionId: 's1', nodeId: 'img-1' },
    )
  })

  it('runVideoGeneration falls back to account default video prefs when node lacks fields', async () => {
    canvas = {
      nodes: [
        {
          id: 'vid-1',
          type: 'video',
          position: { x: 0, y: 0 },
          data: { prompt: '产品展示视频', status: 'draft' },
        },
      ],
      edges: [],
    }
    getGeneration.mockResolvedValue({
      id: 'gen-v1',
      status: 'completed',
      url: 'https://cdn.example/vid.mp4',
    })
    const result = await svc.runVideoGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'vid-1',
    })
    expect(prefsFindUnique).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    expect(generateVideo).toHaveBeenCalledWith(
      'u1',
      '产品展示视频',
      'platform::user-default-video',
      10,
      '9:16',
      expect.any(Array),
      undefined,
      '1080p',
      'center',
      { sessionId: 's1', nodeId: 'vid-1' },
    )
    expect(result.status).toBe('completed')
    expect(result.url).toBe('https://cdn.example/vid.mp4')
    expect(canvas.nodes[0].data.url).toBe('https://cdn.example/vid.mp4')
  })

  it('runTextGeneration calls Studio and writes content', async () => {
    canvas = {
      nodes: [
        {
          id: 'txt-1',
          type: 'text',
          position: { x: 0, y: 0 },
          data: { prompt: '写一段天猫开场文案', status: 'draft' },
        },
      ],
      edges: [],
    }
    const result = await svc.runTextGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'txt-1',
    })
    expect(generateText).toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.generationRecordId).toBe('gen-t1')
    expect(canvas.nodes[0].data.content).toBe('买它！限时优惠。')
    expect(canvas.nodes[0].data.status).toBe('completed')
  })

  it('runPromptGeneration writes content and promptMode', async () => {
    canvas = {
      nodes: [
        {
          id: 'prm-1',
          type: 'prompt',
          position: { x: 0, y: 0 },
          data: { prompt: '蓝牙耳机白底图', status: 'draft' },
        },
      ],
      edges: [],
    }
    const result = await svc.runPromptGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'prm-1',
    })
    expect(generatePrompt).toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(canvas.nodes[0].data.content).toBe('扩写后的 prompt...')
    expect(canvas.nodes[0].data.promptMode).toBe('image_prompt_multi_style')
  })

  it('runAudioGeneration writes url and completed status', async () => {
    canvas = {
      nodes: [
        {
          id: 'aud-1',
          type: 'audio',
          position: { x: 0, y: 0 },
          data: { prompt: '给这段文案配旁白', status: 'draft' },
        },
      ],
      edges: [],
    }
    const result = await svc.runAudioGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'aud-1',
    })
    expect(generateAudio).toHaveBeenCalled()
    expect(result.status).toBe('completed')
    expect(result.url).toBe('https://cdn.example/audio.mp3')
    expect(canvas.nodes[0].data.url).toBe('https://cdn.example/audio.mp3')
  })

  it('runImageGeneration prefers node image fields over account defaults', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: {
            prompt: '洁具白底图',
            status: 'draft',
            imageModel: 'platform::node-model',
            imageAspect: '1:1',
            imageResolution: '4K',
            imageCount: 1,
          },
        },
      ],
      edges: [],
    }
    await svc.runImageGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'img-1',
    })
    expect(generateImage).toHaveBeenCalledWith(
      'u1',
      '洁具白底图',
      'platform::node-model',
      '1:1',
      expect.any(Array),
      undefined,
      '4K',
      1,
      { sessionId: 's1', nodeId: 'img-1' },
    )
  })

  it('addNodesBatch stamps account defaults onto image/video/text/audio skeletons', async () => {
    const result = await svc.addNodesBatch({
      sessionId: 's1',
      userId: 'u1',
      items: [
        { key: 'white_bg', title: '白底图', targetType: 'image' },
        { key: 'show_video', title: '视频', targetType: 'video' },
        { key: 'copy', title: '文案', targetType: 'text' },
        { key: 'vo', title: '配音', targetType: 'audio' },
      ],
    })
    expect(result.nodes).toHaveLength(4)
    const byType = Object.fromEntries(canvas.nodes.map((n) => [n.type, n.data]))
    expect(byType.image).toMatchObject({
      imageModel: 'platform::user-default-image',
      imageAspect: '9:16',
      imageResolution: '2K',
      imageCount: 2,
    })
    expect(byType.video).toMatchObject({
      videoModel: 'platform::user-default-video',
      videoSettings: {
        aspectRatio: '9:16',
        duration: 10,
        resolution: '1080p',
        crop: 'center',
      },
    })
    expect(byType.text).toMatchObject({
      textModel: 'platform::user-default-text',
    })
    expect(byType.audio).toMatchObject({
      audioModel: 'platform::user-default-audio',
      audioVoice: 'female-shaonv',
      audioFormat: 'mp3',
      audioSpeed: 1,
    })
  })

  it('runImageGeneration persists error status when Studio fails after generating', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { prompt: '洁具白底图', status: 'draft' },
        },
      ],
      edges: [],
    }
    generateImage.mockRejectedValueOnce(new Error('studio unavailable'))
    const result = await svc.runImageGeneration({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'img-1',
    })
    expect(result.status).toBe('error')
    expect(canvas.nodes[0].data.status).toBe('error')
    expect(canvas.nodes[0].data.errorMessage).toBe('studio unavailable')
    expect(result.actions.some((a) => a.type === 'update_node')).toBe(true)
  })

  it('write paths reject when session.userId mismatches input.userId', async () => {
    await expect(
      svc.upsertPromptNode({
        sessionId: 's1',
        userId: 'other-user',
        prompt: 'x',
        content: 'y',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    await expect(
      svc.addNodesBatch({
        sessionId: 's1',
        userId: 'other-user',
        items: [{ key: 'k', title: 't', targetType: 'image' }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { prompt: 'p', status: 'draft' },
        },
      ],
      edges: [],
    }
    await expect(
      svc.runImageGeneration({
        sessionId: 's1',
        userId: 'other-user',
        nodeId: 'img-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('getGenerationStatus returns node status and url', async () => {
    canvas = {
      nodes: [
        {
          id: 'img-1',
          type: 'image',
          position: { x: 0, y: 0 },
          data: { status: 'completed', url: 'https://cdn.example/img.png' },
        },
      ],
      edges: [],
    }
    const result = await svc.getGenerationStatus({ sessionId: 's1', nodeId: 'img-1' })
    expect(result).toEqual({ status: 'completed', url: 'https://cdn.example/img.png' })
  })

  it('throws when session missing', async () => {
    sessionFindUnique.mockResolvedValueOnce(null)
    await expect(
      svc.getNode({ sessionId: 'missing', nodeId: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  // Regression test for the production race condition that caused
  // Session.canvasData to lose update_node patches when multiple
  // runImageGeneration calls landed concurrently (Phase 2.5 evidence
  // in debug-task-node-desync.md). With persist() now using a
  // Prisma $transaction that re-reads canvasData inside the TX,
  // every concurrent call's update must land in the final canvas.
  it('runImageGeneration under 3-way concurrency persists all updates to canvasData', async () => {
    canvas = {
      nodes: [
        { id: 'img-a', type: 'image', position: { x: 0, y: 0 }, data: { prompt: 'A', status: 'draft' } },
        { id: 'img-b', type: 'image', position: { x: 280, y: 0 }, data: { prompt: 'B', status: 'draft' } },
        { id: 'img-c', type: 'image', position: { x: 560, y: 0 }, data: { prompt: 'C', status: 'draft' } },
      ],
      edges: [],
    }
    generateImage
      .mockResolvedValueOnce({ id: 'rec-a', status: 'completed', url: 'https://cdn/a.png' })
      .mockResolvedValueOnce({ id: 'rec-b', status: 'completed', url: 'https://cdn/b.png' })
      .mockResolvedValueOnce({ id: 'rec-c', status: 'completed', url: 'https://cdn/c.png' })
    getGeneration.mockImplementation(async (_uid: string, recordId: string) => {
      const urls: Record<string, string> = {
        'rec-a': 'https://cdn/a.png',
        'rec-b': 'https://cdn/b.png',
        'rec-c': 'https://cdn/c.png',
      }
      return { id: recordId, status: 'completed', url: urls[recordId] }
    })

    const results = await Promise.all([
      svc.runImageGeneration({ sessionId: 's1', userId: 'u1', nodeId: 'img-a' }),
      svc.runImageGeneration({ sessionId: 's1', userId: 'u1', nodeId: 'img-b' }),
      svc.runImageGeneration({ sessionId: 's1', userId: 'u1', nodeId: 'img-c' }),
    ])

    expect(results.every((r) => r.status === 'completed')).toBe(true)

    // The critical assertion: every node must carry all three persisted
    // patches (started, recordId, finish) in the final canvas. Before
    // the TX re-read fix, the in-memory canvas was used to compute the
    // patch, so concurrent writers would clobber each other and
    // recordId / url / status would be missing on some nodes.
    const byNode = new Map(canvas.nodes.map((n) => [n.id, n]))
    for (const [nodeId, recordId, url] of [
      ['img-a', 'rec-a', 'https://cdn/a.png'],
      ['img-b', 'rec-b', 'https://cdn/b.png'],
      ['img-c', 'rec-c', 'https://cdn/c.png'],
    ] as const) {
      const node = byNode.get(nodeId)
      expect(node, `node ${nodeId} should be in final canvas`).toBeTruthy()
      expect(node!.data.status, `${nodeId} status`).toBe('completed')
      expect(node!.data.generationRecordId, `${nodeId} recordId`).toBe(recordId)
      expect(node!.data.url, `${nodeId} url`).toBe(url)
      expect(node!.data.generationStartedAt, `${nodeId} startedAt`).toBeTruthy()
    }
  })

  describe('W8 stage/commit', () => {
    const stagedAt = new Date()

    beforeEach(() => {
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: null,
        stagedAt: null,
      }))
      sessionUpdate.mockImplementation(
        async ({
          data,
        }: {
          data: {
            canvasData?: string
            stagedActions?: string | null
            stagedAt?: Date | null
          }
        }) => {
          if (data.canvasData) canvas = JSON.parse(data.canvasData) as CanvasData
          return { id: 's1', ...data }
        },
      )
    })

    it('stageCanvasActions accumulates without changing canvasData', async () => {
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: null,
        stagedAt: null,
      }))
      const action = {
        type: 'add_node' as const,
        payload: {
          id: 'staged-1',
          nodeType: 'image' as const,
          position: { x: 0, y: 0 },
          data: { title: 'staged' },
        },
      }
      const result = await svc.stageCanvasActions({ sessionId: 's1', actions: [action] })
      expect(result.stagedCount).toBe(1)
      expect(canvas.nodes).toHaveLength(0)
      expect(sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stagedActions: expect.stringContaining('staged-1'),
            stagedAt: expect.any(Date),
          }),
        }),
      )
    })

    it('commitStage applies staged actions to canvasData', async () => {
      const action = {
        type: 'add_node' as const,
        payload: {
          id: 'staged-1',
          nodeType: 'image' as const,
          position: { x: 0, y: 0 },
          data: { title: 'staged' },
        },
      }
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: JSON.stringify([action]),
        stagedAt,
      }))
      const result = await svc.commitStage({ sessionId: 's1' })
      expect(result.actions).toHaveLength(1)
      expect(canvas.nodes).toHaveLength(1)
      expect(canvas.nodes[0].id).toBe('staged-1')
    })

    it('rollbackStage clears stagedActions without touching canvas', async () => {
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: '[]',
        stagedAt,
      }))
      const result = await svc.rollbackStage({ sessionId: 's1' })
      expect(result.cleared).toBe(true)
      expect(canvas.nodes).toHaveLength(0)
      expect(sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { stagedActions: null, stagedAt: null },
        }),
      )
    })

    it('expireStaleStage auto-clears stage older than TTL on commit', async () => {
      const stale = new Date(Date.now() - 31 * 60 * 1000)
      const action = {
        type: 'add_node' as const,
        payload: {
          id: 'old-staged',
          nodeType: 'image' as const,
          position: { x: 0, y: 0 },
          data: {},
        },
      }
      let stagedActions: string | null = JSON.stringify([action])
      let stagedAtVal: Date | null = stale
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions,
        stagedAt: stagedAtVal,
      }))
      sessionUpdate.mockImplementation(
        async ({
          data,
        }: {
          data: {
            canvasData?: string
            stagedActions?: string | null
            stagedAt?: Date | null
          }
        }) => {
          if (data.canvasData) canvas = JSON.parse(data.canvasData) as CanvasData
          if (data.stagedActions !== undefined) stagedActions = data.stagedActions
          if (data.stagedAt !== undefined) stagedAtVal = data.stagedAt
          return { id: 's1', ...data }
        },
      )
      const result = await svc.commitStage({ sessionId: 's1' })
      expect(result.actions).toHaveLength(0)
      expect(canvas.nodes).toHaveLength(0)
      expect(stagedActions).toBeNull()
    })

    it('persist rejects when stagedActions pending', async () => {
      canvas = {
        nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: '[]',
        stagedAt,
      }))
      await expect(
        svc.setNodePrompt({ sessionId: 's1', nodeId: 'img-1', prompt: 'p' }),
      ).rejects.toThrow(/staged actions pending/i)
    })

    it('upsertPromptNode with stage does not mutate canvasData', async () => {
      canvas = {
        nodes: [
          {
            id: 'plan-1',
            type: 'prompt',
            position: { x: 0, y: 0 },
            data: { prompt: 'old', content: 'old', title: 'old' },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: null,
        stagedAt: null,
      }))
      await svc.upsertPromptNode({
        sessionId: 's1',
        userId: 'u1',
        nodeId: 'plan-1',
        prompt: '营销方案',
        content: 'new draft',
        stage: true,
      })
      expect(canvas.nodes[0].data.content).toBe('old')
      expect(sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stagedActions: expect.stringContaining('plan-1'),
          }),
        }),
      )
    })

    it('setNodeContent with stage does not mutate canvasData', async () => {
      canvas = {
        nodes: [
          {
            id: 'copy-1',
            type: 'text',
            position: { x: 0, y: 0 },
            data: { content: 'draft', title: '主文案' },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      sessionFindUnique.mockImplementation(async () => ({
        id: 's1',
        userId: 'u1',
        canvasData: JSON.stringify(canvas),
        stagedActions: null,
        stagedAt: null,
      }))
      await svc.setNodeContent({
        sessionId: 's1',
        userId: 'u1',
        nodeId: 'copy-1',
        content: 'confirmed copy',
        stage: true,
      })
      expect(canvas.nodes[0].data.content).toBe('draft')
      expect(sessionUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stagedActions: expect.stringContaining('copy-1'),
          }),
        }),
      )
    })
  })
})
