import { Test } from '@nestjs/testing'
import { vi } from 'vitest'
import { StudioService } from './studio.service'
import { PrismaService } from '../prisma/prisma.service'

export function createPrismaMock() {
  return {
    user: {
      findUnique: async () => ({ id: 'u1', points: 9999 }),
      update: async () => ({ id: 'u1', points: 9994 }),
    },
    pointTransaction: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: 'pt1',
        ...args.data,
      }),
    },
    generationRecord: {
      create: async (args: { data: Record<string, unknown> }) => ({
        id: 'g1',
        createdAt: new Date(),
        ...args.data,
      }),
      update: async () => ({}),
      findFirst: async () => null,
      findMany: async () => [],
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  }
}

export async function createStudioService() {
  const moduleRef = await Test.createTestingModule({
    providers: [
      StudioService,
      {
        provide: PrismaService,
        useValue: createPrismaMock(),
      },
    ],
  }).compile()

  return moduleRef.get(StudioService)
}

export const defaultMergeRefsResult = {
  mergedText: '',
  skippedMerge: true,
}

export function mockMergeRefsToPrompt(mergedText: string) {
  return vi.fn(async () => ({ mergedText, skippedMerge: true }))
}
