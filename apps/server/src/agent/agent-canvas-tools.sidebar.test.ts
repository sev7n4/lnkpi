import 'reflect-metadata'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import type { CanvasData, SidebarAttachment } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { StudioService } from '../studio/studio.service'
import { MaterialService } from '../canvas/material.service'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'

const emptyCanvas = (): CanvasData => ({ nodes: [], edges: [] })

describe('AgentCanvasToolsService.applySidebarAttachments', () => {
  let svc: AgentCanvasToolsService
  let canvas: CanvasData
  const sessionFindUnique = vi.fn()
  const sessionUpdate = vi.fn()

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
            userAiPreferences: { findUnique: vi.fn() },
            $transaction,
          },
        },
        {
          provide: StudioService,
          useValue: {
            generateImage: vi.fn(),
            generateVideo: vi.fn(),
            generateText: vi.fn(),
            generatePrompt: vi.fn(),
            generateAudio: vi.fn(),
            getGeneration: vi.fn(),
            expandPromptContent: vi.fn(),
          },
        },
        {
          provide: MaterialService,
          useValue: {
            cancelGeneration: vi.fn(),
            getMaterialDiagnostic: vi.fn(),
            confirmPlatformFallback: vi.fn(),
            cancelPlatformFallback: vi.fn(),
          },
        },
      ],
    }).compile()
    svc = moduleRef.get(AgentCanvasToolsService)
  })

  const attachments: SidebarAttachment[] = [
    {
      id: 'ref-upload',
      mediaType: 'image',
      sourceKind: 'upload',
      label: 'product.jpg',
      url: 'https://cdn.example.com/product.jpg',
    },
    {
      id: 'ref-asset',
      mediaType: 'text',
      sourceKind: 'asset',
      label: 'brief',
      text: '白底产品图',
    },
    {
      id: 'ref-canvas',
      mediaType: 'image',
      sourceKind: 'canvasNode',
      label: 'plan node',
      url: 'https://cdn.example.com/plan.png',
      sourceNodeId: 'src-1',
    },
  ]

  it('localRefs mode preserves canvas-node snapshots as consumable local refs', async () => {
    canvas = {
      nodes: [
        { id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} },
        { id: 'img-2', type: 'image', position: { x: 280, y: 0 }, data: {} },
      ],
      edges: [],
    }

    const result = await svc.applySidebarAttachments({
      sessionId: 's1',
      nodeIds: ['img-1', 'img-2'],
      attachments,
      mode: 'localRefs',
    })

    expect(result.sourceNodeIds).toEqual([])
    expect(result.actions).toHaveLength(2)
    expect(result.actions.every((a) => a.type === 'update_node')).toBe(true)

    const expectedLocalRefs = [
      {
        id: 'ref-upload',
        mediaType: 'image',
        sourceKind: 'upload',
        label: 'product.jpg',
        url: 'https://cdn.example.com/product.jpg',
        text: undefined,
      },
      {
        id: 'ref-asset',
        mediaType: 'text',
        sourceKind: 'asset',
        label: 'brief',
        url: undefined,
        text: '白底产品图',
      },
      {
        id: 'ref-canvas',
        mediaType: 'image',
        sourceKind: 'upload',
        label: 'plan node',
        url: 'https://cdn.example.com/plan.png',
        text: undefined,
      },
    ]
    const expectedRefOrder = ['ref-upload', 'ref-asset', 'ref-canvas']

    for (const nodeId of ['img-1', 'img-2']) {
      const action = result.actions.find(
        (a) => a.type === 'update_node' && a.payload.id === nodeId,
      )
      expect(action?.payload.data?.localRefs).toEqual(expectedLocalRefs)
      expect(action?.payload.data?.refOrder).toEqual(expectedRefOrder)

      const node = canvas.nodes.find((n) => n.id === nodeId)
      expect(node?.data.localRefs).toEqual(expectedLocalRefs)
      expect(node?.data.refOrder).toEqual(expectedRefOrder)
    }

    expect(sessionUpdate).toHaveBeenCalled()
  })

  it('localRefs mode uses explicit refOrder when provided', async () => {
    canvas = {
      nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }

    const result = await svc.applySidebarAttachments({
      sessionId: 's1',
      nodeIds: ['img-1'],
      attachments,
      refOrder: ['ref-asset', 'ref-upload'],
      mode: 'localRefs',
    })

    const action = result.actions[0]
    expect(action.payload.data?.refOrder).toEqual(['ref-asset', 'ref-upload'])
    expect(canvas.nodes[0].data.refOrder).toEqual(['ref-asset', 'ref-upload'])
  })

  it('attach_edges mode materializes uploads and returns ordered source nodes', async () => {
    canvas = {
      nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }

    const result = await svc.applySidebarAttachments({
      sessionId: 's1',
      nodeIds: ['img-1'],
      attachments,
      refOrder: ['ref-canvas', 'ref-upload', 'ref-asset'],
      mode: 'attach_edges',
    })

    expect(result.sourceNodeIds).toHaveLength(3)
    expect(result.actions).toHaveLength(2)
    expect(result.actions.map((a) => a.type)).toEqual(['add_node', 'add_node'])
    expect(result.sourceNodeIds[0]).toBe('src-1')

    const mediaAction = result.actions[0]
    expect(mediaAction.payload.nodeType).toBe('mediaInput')
    expect(mediaAction.payload.data).toMatchObject({
      title: 'product.jpg',
      url: 'https://cdn.example.com/product.jpg',
      mediaKind: 'image',
      status: 'completed',
    })

    const textAction = result.actions[1]
    expect(textAction.payload.nodeType).toBe('text')
    expect(textAction.payload.data).toMatchObject({
      title: 'brief',
      content: '白底产品图',
      prompt: '白底产品图',
      status: 'completed',
    })
    expect(sessionUpdate).toHaveBeenCalled()
  })

  it('localRefs mode writes mentionedKeys on target nodes', async () => {
    canvas = {
      nodes: [{ id: 'img-1', type: 'image', position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    }
    const oneAttachment: SidebarAttachment[] = [
      {
        id: 'ref-upload',
        mediaType: 'image',
        sourceKind: 'upload',
        label: 'product.jpg',
        url: 'https://cdn.example.com/product.jpg',
      },
    ]

    const result = await svc.applySidebarAttachments({
      sessionId: 's1',
      nodeIds: ['img-1'],
      attachments: oneAttachment,
      mode: 'localRefs',
      mentionedKeys: ['I1', 'T2'],
    })

    expect(result.actions[0].payload.data).toMatchObject({
      mentionedKeys: ['I1', 'T2'],
    })
    expect(sessionUpdate).toHaveBeenCalled()
  })
})
