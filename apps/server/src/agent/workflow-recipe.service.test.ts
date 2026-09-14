import 'reflect-metadata'
import { ValidationPipe } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { MatchRecipesDto, PreviewRecipeDeltaDto } from './agent-canvas-tools.controller'
import { WorkflowRecipeService } from './workflow-recipe.service'

const FORBIDDEN = /parentId|delta|种子链|嫁接|\blint\b/i

describe('WorkflowRecipeService', () => {
  const svc = new WorkflowRecipeService()

  describe('matchRecipes', () => {
    it('returns ecommerce parent with graftHint for 套图+三视图', () => {
      const result = svc.matchRecipes({
        userId: 'u1',
        utterance: '套图并且要模特三视图',
      })
      expect(result.items[0]?.id).toBe('ecommerce-product-visual')
      expect(result.items.some((item) => item.id === 'model-turnaround')).toBe(true)
      expect(result.items.length).toBeLessThanOrEqual(3)
      expect(result.graftHint).toEqual({ recipeId: 'model-turnaround', version: '1.0.0' })
      expect(result.needsClarify).not.toBe(true)
    })

    it('returns two platform summaries with needsClarify when nothing matches', () => {
      const result = svc.matchRecipes({ userId: 'u1', utterance: '今天天气怎么样' })
      expect(result.needsClarify).toBe(true)
      expect(result.items).toHaveLength(2)
      expect(result.items.map((item) => item.id).sort()).toEqual([
        'ecommerce-product-visual',
        'model-turnaround',
      ])
      expect(result.graftHint).toBeUndefined()
    })
  })

  describe('previewRecipeDelta', () => {
    it('includes 去掉 in diffLines when removing banner', () => {
      const result = svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['banner'] },
      })
      expect(result.diffLines.some((line) => line.includes('去掉'))).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'banner')).toBe(false)
      expect(result.stripped).toEqual([])
    })

    it('maps seed_frozen to userMessages when removing white_bg', () => {
      const result = svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['white_bg'] },
      })
      expect(result.stripped.some((item) => item.code === 'seed_frozen')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'white_bg')).toBe(true)
      expect(result.userMessages.some((msg) => msg.includes('主图仍需跟着四视图'))).toBe(true)
      expect([...result.userMessages, ...result.diffLines].join('\n')).not.toMatch(FORBIDDEN)
    })

    it('grafts model seed chain without lifestyle nodes', () => {
      const result = svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { graft: { recipeId: 'model-turnaround', version: '1.0.0' } },
      })
      expect(result.stripped.some((item) => item.code === 'graft_conflict')).toBe(false)
      expect(result.recipe.nodes.some((node) => node.key === 'model_portrait')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'model_turnaround')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'model_lifestyle')).toBe(false)
      expect([...result.userMessages, ...result.diffLines].join('\n')).not.toMatch(FORBIDDEN)
    })
  })
})

describe('recipe planner DTOs', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true })

  it('keeps match utterance under ValidationPipe whitelist', async () => {
    const result = await pipe.transform(
      { userId: 'u1', utterance: '套图并且要模特三视图' },
      { type: 'body', metatype: MatchRecipesDto },
    )
    expect(result.utterance).toBe('套图并且要模特三视图')
    expect(result.userId).toBe('u1')
  })

  it('keeps preview delta under ValidationPipe whitelist', async () => {
    const delta = { remove: ['banner'], graft: { recipeId: 'model-turnaround', version: '1.0.0' } }
    const result = await pipe.transform(
      {
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta,
      },
      { type: 'body', metatype: PreviewRecipeDeltaDto },
    )
    expect(result.delta).toEqual(delta)
    expect(result.parentId).toBe('ecommerce-product-visual')
  })
})
