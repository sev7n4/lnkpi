import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { PointsService } from '../points/points.service'
import { StudioService } from './studio.service'
import { PrismaService } from '../prisma/prisma.service'
import { createPrismaMock } from './studio.test-utils'

describe('studio nest harness', () => {
  it('boots StudioService with mocked Prisma', async () => {
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

    expect(moduleRef.get(StudioService)).toBeDefined()
  })
})
