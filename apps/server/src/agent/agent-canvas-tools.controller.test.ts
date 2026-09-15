import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { InstantiateRecipeDto } from './agent-canvas-tools.controller'

describe('InstantiateRecipeDto', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true })

  it('keeps parentId, delta, and slots under ValidationPipe whitelist', async () => {
    const delta = { remove: ['banner'] }

    const result = await pipe.transform(
      {
        sessionId: 's1',
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta,
        slots: { white_bg: 'a white mug' },
      },
      { type: 'body', metatype: InstantiateRecipeDto },
    )

    expect(result.parentId).toBe('ecommerce-product-visual')
    expect(result.delta).toEqual(delta)
    expect(result.slots).toEqual({ white_bg: 'a white mug' })
  })
})
