import ecommerceProductVisual from './recipes/ecommerce-product-visual.json'
import modelTurnaround from './recipes/model-turnaround.json'
import { validateRecipe, type RecipeDocument } from './workflowRecipe'

export type PlatformRecipeSummary = {
  id: string
  version: string
  title: string
}

export const PLATFORM_RECIPES: RecipeDocument[] = [
  validateRecipe(ecommerceProductVisual),
  validateRecipe(modelTurnaround),
]

export function getPlatformRecipe(id: string, version: string): RecipeDocument | undefined {
  return PLATFORM_RECIPES.find((recipe) => recipe.id === id && recipe.version === version)
}

export function listPlatformRecipeSummaries(): PlatformRecipeSummary[] {
  return PLATFORM_RECIPES.map((recipe) => ({
    id: recipe.id,
    version: recipe.version,
    title: recipe.title,
  }))
}

const ECOMMERCE_HINTS = ['套图', '详情', '主图', '电商'] as const
const MODEL_HINTS = ['三视图', '定妆', '模特', '角色'] as const
const ECOMMERCE_ID = 'ecommerce-product-visual'
const MODEL_ID = 'model-turnaround'

export type MatchRecipeItem = PlatformRecipeSummary & { score: number }

export type MatchPlatformRecipesResult = {
  items: MatchRecipeItem[]
  graftHint?: { recipeId: string; version: string }
  needsClarify?: boolean
}

function titleOrIdHit(utterance: string, summary: { id: string; title: string }): boolean {
  const low = utterance.toLowerCase()
  return utterance.includes(summary.title) || low.includes(summary.id.toLowerCase())
}

function hitsEcommerce(utterance: string, summary?: PlatformRecipeSummary): boolean {
  if (ECOMMERCE_HINTS.some((hint) => utterance.includes(hint))) return true
  return Boolean(summary && titleOrIdHit(utterance, summary))
}

function hitsModel(utterance: string, summary?: PlatformRecipeSummary): boolean {
  if (MODEL_HINTS.some((hint) => utterance.includes(hint))) return true
  return Boolean(summary && titleOrIdHit(utterance, summary))
}

function scoreSummary(utterance: string, summary: PlatformRecipeSummary): number {
  let score = 0
  if (titleOrIdHit(utterance, summary)) score += 3
  if (summary.id === ECOMMERCE_ID && ECOMMERCE_HINTS.some((hint) => utterance.includes(hint))) {
    score += 2
  }
  if (summary.id === MODEL_ID && MODEL_HINTS.some((hint) => utterance.includes(hint))) {
    score += 2
  }
  return score
}

export function matchPlatformRecipes(utterance: string): MatchPlatformRecipesResult {
  const summaries = listPlatformRecipeSummaries()
  const ecommerce = summaries.find((item) => item.id === ECOMMERCE_ID)
  const model = summaries.find((item) => item.id === MODEL_ID)
  const ecommerceHit = hitsEcommerce(utterance, ecommerce)
  const modelHit = hitsModel(utterance, model)

  if (ecommerceHit && modelHit && ecommerce && model) {
    return {
      items: [
        { ...ecommerce, score: 2 },
        { ...model, score: 1 },
      ],
      graftHint: { recipeId: MODEL_ID, version: model.version },
    }
  }

  if (!ecommerceHit && !modelHit) {
    return {
      items: summaries.map((item) => ({ ...item, score: 0 })),
      needsClarify: true,
    }
  }

  return {
    items: summaries
      .map((item) => ({ ...item, score: scoreSummary(utterance, item) }))
      .sort((a, b) => b.score - a.score),
  }
}
