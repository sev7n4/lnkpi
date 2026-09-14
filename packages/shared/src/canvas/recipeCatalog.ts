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
