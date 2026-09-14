import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateRecipe, type RecipeDocument } from './workflowRecipe'

export type PlatformRecipeSummary = {
  id: string
  version: string
  title: string
}

function loadRecipe(filename: string): RecipeDocument {
  const path = join(dirname(fileURLToPath(import.meta.url)), 'recipes', filename)
  return validateRecipe(JSON.parse(readFileSync(path, 'utf-8')))
}

export const PLATFORM_RECIPES: RecipeDocument[] = [
  loadRecipe('ecommerce-product-visual.json'),
  loadRecipe('model-turnaround.json'),
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
