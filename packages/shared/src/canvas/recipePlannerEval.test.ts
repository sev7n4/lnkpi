import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getPlatformRecipe, matchPlatformRecipes } from './recipeCatalog'
import {
  applyDelta,
  inferRecipeDraftFromWorkflow,
  lintRecipe,
  type RecipeDelta,
  type RecipeDocument,
} from './workflowRecipe'

const FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/workflow/examples/recipe-planner-eval.json',
)

const REQUIRED_IDS = [
  'recognize-ecommerce',
  'recognize-graft-hint',
  'illegal-remove-seed',
  'legal-remove-banner',
  'graft-without-lifestyle',
  'graft-twice',
  'infer-missing-seed',
  'second-derive-frozen-graft-seed',
] as const

type EvalExpect = {
  parentId?: string
  graftHintRecipeId?: string
  strippedCodes?: string[]
  graftKeysPresent?: string[]
  graftLifestyleAbsent?: boolean
  seedUnchanged?: boolean
  missingKeys?: string[]
  seedChainsEmpty?: boolean
}

type EvalCase = {
  id: string
  utterance?: string
  parentId: string
  delta?: RecipeDelta
  setupDelta?: RecipeDelta
  alreadyGrafted?: number
  workflow?: unknown
  expect: EvalExpect
}

function lifestyleGraftSource(source: RecipeDocument): RecipeDocument {
  if (source.nodes.some((node) => node.key === 'model_lifestyle')) return source
  return {
    ...source,
    nodes: [
      ...source.nodes,
      {
        key: 'model_lifestyle',
        title: '人景',
        type: 'image',
        chain: 'model',
        role: 'downstream',
        dependsOn: ['model_turnaround'],
        genMode: 'i2i',
        autoGenerate: true,
      },
    ],
  }
}

function graftSourceFor(delta: RecipeDelta, includeLifestyle: boolean): RecipeDocument | undefined {
  if (!delta.graft) return undefined
  const source = getPlatformRecipe(delta.graft.recipeId, delta.graft.version)
  if (!source) return undefined
  return includeLifestyle ? lifestyleGraftSource(source) : source
}

function runCase(fixture: EvalCase) {
  if (fixture.utterance) {
    const matched = matchPlatformRecipes(fixture.utterance)
    if (fixture.expect.parentId) {
      expect(matched.items[0]?.id, fixture.id).toBe(fixture.expect.parentId)
    }
    if (fixture.expect.graftHintRecipeId) {
      expect(matched.graftHint?.recipeId, fixture.id).toBe(fixture.expect.graftHintRecipeId)
    }
    return
  }

  if (fixture.workflow !== undefined || fixture.expect.seedChainsEmpty) {
    const draft = inferRecipeDraftFromWorkflow(fixture.workflow)
    expect(draft.invariants.seedChains, fixture.id).toEqual([])
    expect(lintRecipe(draft).some((issue) => issue.code === 'seed_incomplete')).toBe(false)
    return
  }

  const parent = getPlatformRecipe(fixture.parentId, '1.0.0')
  expect(parent, `${fixture.id} parent`).toBeDefined()
  let current = parent!
  let alreadyGrafted = fixture.alreadyGrafted ?? current.graftedRecipeIds.length

  if (fixture.setupDelta) {
    const setupSource = graftSourceFor(fixture.setupDelta, false)
    const setup = applyDelta(current, fixture.setupDelta, {
      graftSource: setupSource,
      alreadyGrafted,
    })
    current = setup.recipe
    alreadyGrafted = current.graftedRecipeIds.length
  }

  const { recipe, stripped } = applyDelta(current, fixture.delta ?? {}, {
    graftSource: fixture.delta ? graftSourceFor(fixture.delta, Boolean(fixture.expect.graftLifestyleAbsent)) : undefined,
    alreadyGrafted: fixture.alreadyGrafted ?? alreadyGrafted,
  })

  if (fixture.expect.strippedCodes) {
    for (const code of fixture.expect.strippedCodes) {
      expect(
        stripped.some((issue) => issue.code === code),
        `${fixture.id} missing stripped code ${code}`,
      ).toBe(true)
    }
    if (fixture.expect.strippedCodes.length === 0) {
      expect(stripped.some((issue) => issue.code === 'seed_frozen'), fixture.id).toBe(false)
    }
  }

  if (fixture.expect.graftKeysPresent) {
    for (const key of fixture.expect.graftKeysPresent) {
      expect(recipe.nodes.some((node) => node.key === key), `${fixture.id} missing ${key}`).toBe(true)
    }
  }

  if (fixture.expect.graftLifestyleAbsent) {
    expect(recipe.nodes.some((node) => node.key === 'model_lifestyle'), fixture.id).toBe(false)
  }

  if (fixture.expect.seedUnchanged) {
    const frozen = current.invariants.seedChains.flatMap((chain) => chain.keys)
    for (const key of frozen) {
      expect(recipe.nodes.some((node) => node.key === key), `${fixture.id} lost seed ${key}`).toBe(true)
    }
  }

  if (fixture.expect.missingKeys) {
    for (const key of fixture.expect.missingKeys) {
      expect(recipe.nodes.some((node) => node.key === key), `${fixture.id} still has ${key}`).toBe(false)
    }
  }
}

describe('recipe planner gold eval', () => {
  it('has gold eval fixtures', () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true)
  })

  it('covers the eight spec §10.6 cases', () => {
    const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as EvalCase[]
    expect(fixtures.map((item) => item.id)).toEqual([...REQUIRED_IDS])
  })

  it('each fixture matches expected planner behavior', () => {
    const fixtures = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as EvalCase[]
    expect(fixtures.length).toBeGreaterThanOrEqual(8)
    for (const fixture of fixtures) {
      runCase(fixture)
    }
  })
})
