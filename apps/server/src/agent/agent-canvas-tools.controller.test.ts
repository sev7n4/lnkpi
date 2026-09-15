import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { InstantiateRecipeDto } from './agent-canvas-tools.controller'

describe('InstantiateRecipeDto', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true })

  it('keeps recipe under ValidationPipe whitelist', async () => {
    const recipe = {
      id: 'ecommerce-product-visual',
      version: '1.0.0',
      title: '电商套图',
      invariants: { seedChains: [{ id: 'product', keys: ['white_bg', 'product_turnaround'] }] },
      nodes: [
        { key: 'white_bg', title: '白底', type: 'image', dependsOn: [], autoGenerate: true },
      ],
    }

    const result = await pipe.transform(
      {
        sessionId: 's1',
        userId: 'u1',
        recipe,
        slots: { white_bg: 'a white mug' },
      },
      { type: 'body', metatype: InstantiateRecipeDto },
    )

    expect(result.recipe).toEqual(recipe)
    expect(result.slots).toEqual({ white_bg: 'a white mug' })
  })
})
