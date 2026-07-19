import { Test } from '@nestjs/testing'
import { vi } from 'vitest'
import { PointsService } from '../points/points.service'
import { StudioService } from './studio.service'
import { PrismaService } from '../prisma/prisma.service'

export function createPrismaMock() {
  return {
    user: {
      findUnique: async () => ({ id: 'u1', points: 9999 }),
      update: async () => ({ id: 'u1', points: 9994 }),
      updateMany: async () => ({ count: 1 }),
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
    $transaction: async (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => Promise<unknown>)({
          user: {
            updateMany: async () => ({ count: 1 }),
          },
          pointTransaction: {
            create: async (a: { data: Record<string, unknown> }) => ({ id: 'pt1', ...a.data }),
          },
        })
      }
      return Promise.all(arg as Promise<unknown>[])
    },
  }
}

export async function createStudioService() {
  const moduleRef = await Test.createTestingModule({
    providers: [
      StudioService,
      PointsService,
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
