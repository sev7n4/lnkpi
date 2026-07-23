import 'reflect-metadata'
import { NotFoundException } from '@nestjs/common'
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
  const generateImage = vi.fn()
  const getGeneration = vi.fn()

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
    generateImage.mockResolvedValue({
      id: 'gen-1',
      status: 'completed',
      url: 'https://cdn.example/img.png',
    })
    getGeneration.mockResolvedValue({
      id: 'gen-1',
      status: 'completed',
      url: 'https://cdn.example/img.png',
    })

    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentCanvasToolsService,
        {
          provide: PrismaService,
          useValue: {
            session: { findUnique: sessionFindUnique, update: sessionUpdate },
          },
        },
        {
          provide: StudioService,
          useValue: { generateImage, getGeneration },
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
})
