import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { GOLD_COMPOSE_1 } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { CompositionService } from './composition.service'

type SessionRow = {
  id: string
  userId: string
  canvasData: string | null
  compositionPreview: string | null
  compositionPending: string | null
}

const CONFIRM_ID_MAP = {
  'image-i0': 'n-i0',
  'image-look-0': 'n-look0',
  'image-src-I1': 'n-src1',
}

function createPrisma() {
  const sessions = new Map<string, SessionRow>()
  sessions.set('s1', {
    id: 's1',
    userId: 'u1',
    canvasData: null,
    compositionPreview: null,
    compositionPending: null,
  })
  const prisma = {
    session: {
      findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Partial<SessionRow>
      }) => {
        const current = sessions.get(where.id)
        if (!current) throw new Error('session not found')
        const next = { ...current, ...data }
        sessions.set(where.id, next)
        return next
      },
    },
  }
  return { sessions, prisma: prisma as unknown as PrismaService }
}

function mockImportWritingCanvas(sessions: Map<string, SessionRow>) {
  return vi.fn(async () => {
    const row = sessions.get('s1')
    if (row) {
      row.canvasData = JSON.stringify({
        nodes: [
          { id: 'n-i0', type: 'image', position: { x: 0, y: 0 }, data: {} },
          { id: 'n-look0', type: 'image', position: { x: 80, y: 0 }, data: {} },
          { id: 'n-src1', type: 'image', position: { x: 160, y: 0 }, data: {} },
        ],
        edges: [{ id: 'e-n-src1-n-i0', source: 'n-src1', target: 'n-i0' }],
      })
    }
    return {
      addedNodeIds: ['n-i0', 'n-look0', 'n-src1'],
      idMap: CONFIRM_ID_MAP,
      canvasCommands: [{ type: 'focus_nodes', nodeIds: ['n-i0'] }],
    }
  })
}

describe('CompositionService', () => {
  it('preview gold 1 persists hash and does not import', async () => {
    const { prisma } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    expect(out.dumpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(out.userMessage).toContain('请确认是否把构图落到画布')
    expect(out.userMessage).toContain('选中构图里要生成的节点，用 Dock 生成，会按运行组排队')
    expect(out.userMessage).not.toContain('Dock 生成工作流')
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('confirm imports dump once then idempotent', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = mockImportWritingCanvas(sessions)
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    const storedHash = out.dumpHash
    const first = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: storedHash })
    const saved = JSON.parse(sessions.get('s1')!.canvasData!) as {
      compositionRunGroup?: { nodeIds: string[]; dumpHash: string }
    }
    expect(saved.compositionRunGroup?.dumpHash).toBe(storedHash)
    expect(saved.compositionRunGroup?.nodeIds).toEqual(expect.arrayContaining(['n-i0', 'n-look0']))
    expect(saved.compositionRunGroup?.nodeIds).not.toContain('n-src1')
    expect(saved.compositionRunGroup?.nodeIds.every((id) => !id.startsWith('image-src-'))).toBe(true)
    const second = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: storedHash })
    expect(importWorkflow).toHaveBeenCalledTimes(1)
    expect(second.idempotent).toBe(true)
    expect(second.addedNodeIds).toEqual(first.addedNodeIds)
  })

  it('confirm with wrong hash throws persist_missing userMessage', async () => {
    const { prisma } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    await expect(
      svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: 'dead'.repeat(16) }),
    ).rejects.toMatchObject({ response: { userMessage: '请先确认构图，再落到画布。' } })
  })

  it('extract incomplete writes pending and does not import', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const utterance = '作为模特换装，服装图'
    await expect(
      svc.preview({ sessionId: 's1', userId: 'u1', utterance, existingNodeCount: 0 }),
    ).rejects.toMatchObject({ response: { userMessage: '请指明哪张是模特、哪张是服装。' } })
    const pending = JSON.parse(sessions.get('s1')!.compositionPending!) as { utterance?: string }
    expect(pending.utterance).toBe(utterance)
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('preview gold 1 stamps sidebar image localRefs on source nodes; confirm imports frozen dump', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = mockImportWritingCanvas(sessions)
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const attachments = [
      {
        id: 'att-i1',
        mediaType: 'image' as const,
        sourceKind: 'upload' as const,
        label: 'I1',
        url: 'https://cdn.example/i1.png',
      },
      {
        id: 'att-i2',
        mediaType: 'image' as const,
        sourceKind: 'upload' as const,
        label: 'I2',
        url: 'https://cdn.example/i2.png',
      },
    ]
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
      attachments,
    })
    const stored = JSON.parse(sessions.get('s1')!.compositionPreview!) as {
      dump: {
        graph: {
          nodes: Array<{ id: string; data?: { localRefs?: Array<{ id?: string; url?: string }> } }>
        }
      }
    }
    const srcI1 = stored.dump.graph.nodes.find((node) => node.id === 'image-src-I1')
    expect(srcI1?.data?.localRefs?.[0]).toMatchObject({
      id: 'att-i1',
      url: 'https://cdn.example/i1.png',
    })
    const srcI2 = stored.dump.graph.nodes.find((node) => node.id === 'image-src-I2')
    expect(srcI2?.data?.localRefs?.[0]).toMatchObject({
      id: 'att-i2',
      url: 'https://cdn.example/i2.png',
    })
    await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: out.dumpHash })
    expect(importWorkflow).toHaveBeenCalledTimes(1)
    expect(importWorkflow.mock.calls[0][0].workflow).toEqual(stored.dump)
  })

  it('resumes pending extract by merging follow-up into original utterance', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    await expect(
      svc.preview({
        sessionId: 's1',
        userId: 'u1',
        utterance: '作为模特换装，服装图',
        existingNodeCount: 0,
      }),
    ).rejects.toMatchObject({ response: { userMessage: '请指明哪张是模特、哪张是服装。' } })
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: 'I1 模特 I2 I3 服装',
      existingNodeCount: 0,
    })
    expect(out.dumpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(sessions.get('s1')!.compositionPending).toBeNull()
    const stored = JSON.parse(sessions.get('s1')!.compositionPreview!) as {
      dump: { graph: { nodes: Array<{ id: string }> } }
      primitives?: { identityRef?: string; garmentRefs?: string[] }
    }
    const ids = stored.dump.graph.nodes.map((node) => node.id)
    expect(ids).toEqual(
      expect.arrayContaining(['image-src-I1', 'image-src-I2', 'image-src-I3', 'image-look-0']),
    )
    expect(ids).toContain('image-i0')
    expect(stored.primitives?.identityRef).toBe('I1')
    expect(stored.primitives?.garmentRefs).toEqual(['I2', 'I3'])
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('ignores compositionPending older than 15 minutes', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    sessions.get('s1')!.compositionPending = JSON.stringify({
      utterance: '作为模特换装，服装图',
      primitivesPartial: {},
      ts: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    })
    await expect(
      svc.preview({
        sessionId: 's1',
        userId: 'u1',
        utterance: '@I2 @I3 是服装图',
        existingNodeCount: 0,
      }),
    ).rejects.toMatchObject({ response: { userMessage: '请指明哪张是模特、哪张是服装。' } })
    const pending = JSON.parse(sessions.get('s1')!.compositionPending!) as { utterance?: string }
    expect(pending.utterance).toBe('@I2 @I3 是服装图')
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('replaces pending when the follow-up is a new structure utterance', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    sessions.get('s1')!.compositionPending = JSON.stringify({
      utterance: '@I1 作为模特，@I2 @I3 @I4 @I5 @I6 这些是服装图',
      primitivesPartial: {},
      ts: new Date().toISOString(),
    })
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    expect(out.dumpHash).toMatch(/^[a-f0-9]{64}$/)
    expect(sessions.get('s1')!.compositionPending).toBeNull()
    const stored = JSON.parse(sessions.get('s1')!.compositionPreview!) as {
      primitives?: { identityRef?: string; garmentRefs?: string[] }
    }
    expect(stored.primitives?.identityRef).toBe('I1')
    expect(stored.primitives?.garmentRefs).toEqual(['I2', 'I3'])
  })

  it('lint fail throws compile_failed and does not import', async () => {
    const { prisma } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    await expect(
      svc.preview({
        sessionId: 's1',
        userId: 'u1',
        utterance: GOLD_COMPOSE_1,
        existingNodeCount: 0,
        copy: { promptSlots: { 'look-0': 'data:image/png;base64,aaaa' } },
      }),
    ).rejects.toMatchObject({
      response: { userMessage: '这版构图还不能放到画布，请稍后再试或简化步骤。' },
    })
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('confirm after preview stores remapped generating ids only', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = mockImportWritingCanvas(sessions)
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: out.dumpHash })
    const saved = JSON.parse(sessions.get('s1')!.canvasData!) as {
      compositionRunGroup?: { nodeIds: string[]; dumpHash: string }
    }
    const nodeIds = saved.compositionRunGroup?.nodeIds ?? []
    expect(nodeIds).toEqual(expect.arrayContaining(['n-i0', 'n-look0']))
    expect(nodeIds).not.toContain('n-src1')
    expect(nodeIds.some((id) => id.startsWith('image-src-'))).toBe(false)
  })

  it('confirm does not write empty canvas when post-import parse fails', async () => {
    const { prisma, sessions } = createPrisma()
    const importWorkflow = vi.fn(async () => {
      sessions.get('s1')!.canvasData = '{not-json'
      return {
        addedNodeIds: ['n-i0'],
        idMap: CONFIRM_ID_MAP,
        canvasCommands: [{ type: 'focus_nodes', nodeIds: ['n-i0'] }],
      }
    })
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    await expect(
      svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: out.dumpHash }),
    ).rejects.toMatchObject({
      response: { userMessage: '这版构图还不能放到画布，请稍后再试或简化步骤。' },
    })
    expect(sessions.get('s1')!.canvasData).toBe('{not-json')
  })
})
