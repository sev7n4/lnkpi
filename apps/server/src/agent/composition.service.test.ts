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
    expect(importWorkflow).not.toHaveBeenCalled()
  })

  it('confirm imports dump once then idempotent', async () => {
    const { prisma } = createPrisma()
    const importWorkflow = vi.fn()
    const svc = new CompositionService(prisma, { importWorkflow } as never)
    importWorkflow.mockResolvedValue({
      addedNodeIds: ['image-i0', 'image-look-0'],
      canvasCommands: [{ type: 'focus_nodes', nodeIds: ['image-i0'] }],
    })
    const out = await svc.preview({
      sessionId: 's1',
      userId: 'u1',
      utterance: GOLD_COMPOSE_1,
      existingNodeCount: 0,
    })
    const storedHash = out.dumpHash
    const first = await svc.confirm({ sessionId: 's1', userId: 'u1', dumpHash: storedHash })
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
})
