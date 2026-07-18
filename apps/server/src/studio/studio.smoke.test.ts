import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { StudioService } from './studio.service'
import { PrismaService } from '../prisma/prisma.service'

describe('studio nest harness', () => {
  it('boots StudioService with mocked Prisma', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        StudioService,
        {
          provide: PrismaService,
          useValue: {
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
                ...args.data,
              }),
              update: async () => ({}),
              findFirst: async () => null,
              findMany: async () => [],
            },
            $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
          },
        },
      ],
    }).compile()

    expect(moduleRef.get(StudioService)).toBeDefined()
  })
})
