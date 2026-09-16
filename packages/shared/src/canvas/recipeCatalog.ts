import ecommerceProductVisual from './recipes/ecommerce-product-visual.json'
import imageToVideo from './recipes/image-to-video.json'
import modelTurnaround from './recipes/model-turnaround.json'
import storyboardToVideo from './recipes/storyboard-to-video.json'
import { validateRecipe, type RecipeDocument } from './workflowRecipe'

export type PlatformRecipeSummary = {
  id: string
  version: string
  title: string
}

export const PLATFORM_RECIPES: RecipeDocument[] = [
  validateRecipe(ecommerceProductVisual),
  validateRecipe(modelTurnaround),
  validateRecipe(storyboardToVideo),
  validateRecipe(imageToVideo),
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

export type MatchRecipeItem = PlatformRecipeSummary & { score: number }

export type MatchPlatformRecipesResult = {
  items: MatchRecipeItem[]
  graftHint?: { recipeId: string; version: string }
  needsClarify?: boolean
}

export function matchPlatformRecipes(_utterance: string): MatchPlatformRecipesResult {
  return { items: [] }
}
