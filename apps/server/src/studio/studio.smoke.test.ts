import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { createStudioService } from './studio.test-utils'

describe('studio nest harness', () => {
  it('boots StudioService with mocked Prisma', async () => {
    const svc = await createStudioService()
    expect(svc).toBeDefined()
  })
})
