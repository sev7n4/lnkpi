import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateRecipe } from './workflowRecipe'
import {
  PLATFORM_RECIPES,
  getPlatformRecipe,
  listPlatformRecipeSummaries,
  matchPlatformRecipes,
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
    expect(keys).not.toContain('copy_main')
    expect(keys).not.toContain('model_portrait')
    expect(keys).not.toContain('video_product')
    expect(validateRecipe(recipe)).toEqual(recipe)
  })

  it('both platform recipes validate and appear in summaries', () => {
    expect(PLATFORM_RECIPES).toHaveLength(4)
    for (const recipe of PLATFORM_RECIPES) {
      expect(validateRecipe(recipe)).toEqual(recipe)
    }
    const summaries = listPlatformRecipeSummaries()
    expect(summaries.map((s) => s.id).sort()).toEqual([
      'ecommerce-product-visual',
      'image-to-video',
      'model-turnaround',
      'storyboard-to-video',
    ])
    expect(summaries.map((s) => s.title).sort()).toEqual([
      '分镜成片',
      '图生视频',
      '电商套图',
      '角色三视图',
    ])
    expect(summaries.every((s) => s.version === '1.0.0' && s.title.length > 0)).toBe(true)
  })

  it('does not import node filesystem APIs in production catalog', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'recipeCatalog.ts'),
      'utf-8',
    )
    expect(src).not.toMatch(/node:fs/)
    expect(src).not.toMatch(/readFileSync/)
  })

  it('matches 套图/详情/主图/电商 to ecommerce-product-visual', () => {
    const result = matchPlatformRecipes('蓝牙耳机详情页套图')
    expect(result.items[0]?.id).toBe('ecommerce-product-visual')
    expect(result.graftHint).toBeUndefined()
    expect(result.needsClarify).not.toBe(true)
  })

  it('matches 套图+三视图 to ecommerce parent with model graftHint', () => {
    const result = matchPlatformRecipes('套图并且要模特三视图')
    expect(result.items[0]?.id).toBe('ecommerce-product-visual')
    expect(result.items.some((item) => item.id === 'model-turnaround')).toBe(true)
    expect(result.graftHint).toEqual({ recipeId: 'model-turnaround', version: '1.0.0' })
    expect(result.needsClarify).not.toBe(true)
  })

  it('matches 三视图/定妆/模特/角色 to model-turnaround', () => {
    const result = matchPlatformRecipes('角色定妆照')
    expect(result.items[0]?.id).toBe('model-turnaround')
    expect(result.graftHint).toBeUndefined()
    expect(result.needsClarify).not.toBe(true)
  })

  it('lists both platform summaries with needsClarify when nothing matches', () => {
    const result = matchPlatformRecipes('今天天气怎么样')
    expect(result.needsClarify).toBe(true)
    expect(result.items.map((item) => item.id).sort()).toEqual([
      'ecommerce-product-visual',
      'image-to-video',
      'model-turnaround',
      'storyboard-to-video',
    ])
    expect(result.graftHint).toBeUndefined()
  })

  it('matches 分镜/故事板 to storyboard-to-video', () => {
    const result = matchPlatformRecipes('帮我规划一个分镜成片')
    expect(result.items[0]?.id).toBe('storyboard-to-video')
    expect(result.needsClarify).not.toBe(true)
  })

  it('matches 图生视频/i2v to image-to-video', () => {
    const result = matchPlatformRecipes('做一个图生视频工作流')
    expect(result.items[0]?.id).toBe('image-to-video')
    expect(result.needsClarify).not.toBe(true)
  })

  it('generic 规划一个视频工作流 clarifies between the two video recipes', () => {
    const result = matchPlatformRecipes('规划一个视频工作流')
    expect(result.needsClarify).toBe(true)
    expect(result.items.map((item) => item.id).sort()).toEqual([
      'image-to-video',
      'storyboard-to-video',
    ])
  })

  it('does not let 视频 steal ecommerce 套图', () => {
    const result = matchPlatformRecipes('蓝牙耳机详情页套图再出一段视频')
    expect(result.items[0]?.id).toBe('ecommerce-product-visual')
  })
})
