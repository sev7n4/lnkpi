import { describe, expect, it } from 'vitest'
import { validateRecipe } from './workflowRecipe'
import {
  PLATFORM_RECIPES,
  getPlatformRecipe,
  listPlatformRecipeSummaries,
} from './recipeCatalog'

describe('recipeCatalog', () => {
  it("getPlatformRecipe('model-turnaround', '1.0.0') has only portrait and turnaround keys", () => {
    const recipe = getPlatformRecipe('model-turnaround', '1.0.0')
    expect(recipe).toBeDefined()
    expect(recipe!.nodes.map((n) => n.key)).toEqual(['model_portrait', 'model_turnaround'])
    expect(recipe!.nodes.some((n) => n.key === 'model_lifestyle')).toBe(false)
    expect(validateRecipe(recipe)).toEqual(recipe)
  })

  it('product recipe includes seed chain and a removable downstream', () => {
    const recipe = getPlatformRecipe('ecommerce-product-visual', '1.0.0')
    expect(recipe).toBeDefined()
    const keys = recipe!.nodes.map((n) => n.key)
    expect(keys).toEqual(expect.arrayContaining(['white_bg', 'product_turnaround']))
    expect(keys.some((key) => key === 'banner' || key === 'hero_main')).toBe(true)
    expect(validateRecipe(recipe)).toEqual(recipe)
  })

  it('both platform recipes validate and appear in summaries', () => {
    expect(PLATFORM_RECIPES).toHaveLength(2)
    for (const recipe of PLATFORM_RECIPES) {
      expect(validateRecipe(recipe)).toEqual(recipe)
    }
    const summaries = listPlatformRecipeSummaries()
    expect(summaries.map((s) => s.id).sort()).toEqual([
      'ecommerce-product-visual',
      'model-turnaround',
    ])
    expect(summaries.every((s) => s.version === '1.0.0' && s.title.length > 0)).toBe(true)
  })
})
