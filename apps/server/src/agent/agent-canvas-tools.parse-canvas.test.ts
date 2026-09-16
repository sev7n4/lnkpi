import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import type { CanvasData } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { AgentCanvasToolsService } from './agent-canvas-tools.service'

describe('AgentCanvasToolsService parseCanvas', () => {
  it('layout persist keeps compositionRunGroup', async () => {
    const group = {
      nodeIds: ['img-1'],
      dumpHash: 'cd'.repeat(32),
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    let canvas: CanvasData = {
      nodes: [{ id: 'img-1', type: 'image', position: { x: 100, y: 100 }, data: {} }],
      edges: [],
      compositionRunGroup: group,
    }
    const sessionFindUnique = async () => ({
      id: 's1',
      userId: 'u1',
      canvasData: JSON.stringify(canvas),
    })
    const sessionUpdate = async ({ data }: { data: { canvasData?: string } }) => {
      if (data.canvasData) canvas = JSON.parse(data.canvasData) as CanvasData
      return { id: 's1', canvasData: data.canvasData }
    }
    const $transaction = (
      fn: (tx: {
        session: { findUnique: typeof sessionFindUnique; update: typeof sessionUpdate }
      }) => Promise<unknown>,
    ) => fn({ session: { findUnique: sessionFindUnique, update: sessionUpdate } })
    const svc = new AgentCanvasToolsService(
      {
        session: { findUnique: sessionFindUnique, update: sessionUpdate },
        $transaction,
      } as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    await svc.moveNodes({
      sessionId: 's1',
      userId: 'u1',
      items: [{ nodeId: 'img-1', x: 300, y: 400 }],
    })
    expect(canvas.compositionRunGroup).toEqual(group)
    expect(canvas.nodes.find((n) => n.id === 'img-1')?.position).toEqual({ x: 300, y: 400 })
  })

  it('upsert persist keeps compositionRunGroup', async () => {
    const group = {
      nodeIds: ['prompt-1'],
      dumpHash: 'ef'.repeat(32),
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    let canvas: CanvasData = {
      nodes: [{ id: 'prompt-1', type: 'prompt', position: { x: 80, y: 80 }, data: { prompt: 'old' } }],
      edges: [],
      compositionRunGroup: group,
    }
    const sessionFindUnique = async () => ({
      id: 's1',
      userId: 'u1',
      canvasData: JSON.stringify(canvas),
    })
    const sessionUpdate = async ({ data }: { data: { canvasData?: string } }) => {
      if (data.canvasData) canvas = JSON.parse(data.canvasData) as CanvasData
      return { id: 's1', canvasData: data.canvasData }
    }
    const $transaction = (
      fn: (tx: {
        session: { findUnique: typeof sessionFindUnique; update: typeof sessionUpdate }
      }) => Promise<unknown>,
    ) => fn({ session: { findUnique: sessionFindUnique, update: sessionUpdate } })
    const svc = new AgentCanvasToolsService(
      {
        session: { findUnique: sessionFindUnique, update: sessionUpdate },
        $transaction,
      } as unknown as PrismaService,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
    await svc.upsertPromptNode({
      sessionId: 's1',
      userId: 'u1',
      nodeId: 'prompt-1',
      prompt: 'updated prompt',
      content: 'updated content',
    })
    expect(canvas.compositionRunGroup).toEqual(group)
    expect(canvas.nodes.find((n) => n.id === 'prompt-1')?.data).toMatchObject({
      prompt: 'updated prompt',
      content: 'updated content',
    })
  })
})
