import { BadRequestException, Injectable } from '@nestjs/common'
import {
  applyDelta,
  diffRecipeLines,
  getPlatformRecipe,
  lintRecipe,
  listPlatformRecipeSummaries,
  validateRecipe,
  type LintIssue,
  type RecipeDelta,
  type RecipeDocument,
} from '@lnkpi/shared'

const ECOMMERCE_HINTS = ['套图', '详情', '主图', '电商'] as const
const MODEL_HINTS = ['三视图', '定妆', '模特', '角色'] as const
const ECOMMERCE_ID = 'ecommerce-product-visual'
const MODEL_ID = 'model-turnaround'
const FORBIDDEN_USER_TEXT = /parentId|delta|种子链|嫁接|\blint\b/i

const USER_MESSAGE_BY_CODE: Record<string, string> = {
  seed_frozen: '主图仍需跟着四视图，那一步没改。',
  graft_conflict: '没法把「角色三视图」整段接上来，和当前模板的步骤冲突。',
}

export type MatchRecipeItem = {
  id: string
  version: string
  title: string
  score: number
}

export type MatchRecipesResult = {
  items: MatchRecipeItem[]
  graftHint?: { recipeId: string; version: string }
  needsClarify?: boolean
}

export type PreviewRecipeDeltaResult = {
  recipe: RecipeDocument
  stripped: LintIssue[]
  diffLines: string[]
  userMessages: string[]
}

@Injectable()
export class WorkflowRecipeService {
  matchRecipes(input: { userId: string; utterance: string }): MatchRecipesResult {
    void input.userId
    const utterance = input.utterance ?? ''
    const summaries = listPlatformRecipeSummaries()
    const ecommerce = summaries.find((item) => item.id === ECOMMERCE_ID)
    const model = summaries.find((item) => item.id === MODEL_ID)
    const ecommerceHit = this.hitsEcommerce(utterance, ecommerce)
    const modelHit = this.hitsModel(utterance, model)

    if (ecommerceHit && modelHit && ecommerce && model) {
      return {
        items: [
          { ...ecommerce, score: 2 },
          { ...model, score: 1 },
        ].slice(0, 3),
        graftHint: { recipeId: MODEL_ID, version: model.version },
      }
    }

    if (!ecommerceHit && !modelHit) {
      return {
        items: summaries.slice(0, 2).map((item) => ({ ...item, score: 0 })),
        needsClarify: true,
      }
    }

    const scored = summaries
      .map((item) => ({
        ...item,
        score: this.scoreSummary(utterance, item),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    return { items: scored }
  }

  previewRecipeDelta(input: {
    userId: string
    parentId: string
    parentVersion: string
    delta: unknown
  }): PreviewRecipeDeltaResult {
    void input.userId
    const parent = getPlatformRecipe(input.parentId, input.parentVersion)
    if (!parent) {
      throw new BadRequestException('找不到这套模板')
    }
    validateRecipe(parent)
    const delta = this.parseDelta(input.delta)
    const graftSource = this.loadGraftSource(delta)
    const { recipe, stripped } = applyDelta(parent, delta, graftSource ? { graftSource } : undefined)
    const extra = lintRecipe(recipe).filter(
      (issue) => !stripped.some((item) => item.code === issue.code && item.key === issue.key),
    )
    const allStripped = [...stripped, ...extra]
    const diffLines = diffRecipeLines(parent, recipe).filter((line) => !FORBIDDEN_USER_TEXT.test(line))
    const userMessages = this.userMessagesFor(allStripped)
    return { recipe, stripped: allStripped, diffLines, userMessages }
  }

  private hitsEcommerce(
    utterance: string,
    summary?: { id: string; title: string },
  ): boolean {
    if (ECOMMERCE_HINTS.some((hint) => utterance.includes(hint))) return true
    return Boolean(summary && this.titleOrIdHit(utterance, summary))
  }

  private hitsModel(
    utterance: string,
    summary?: { id: string; title: string },
  ): boolean {
    if (MODEL_HINTS.some((hint) => utterance.includes(hint))) return true
    return Boolean(summary && this.titleOrIdHit(utterance, summary))
  }

  private titleOrIdHit(utterance: string, summary: { id: string; title: string }): boolean {
    const low = utterance.toLowerCase()
    return utterance.includes(summary.title) || low.includes(summary.id.toLowerCase())
  }

  private scoreSummary(utterance: string, summary: { id: string; title: string }): number {
    let score = 0
    if (this.titleOrIdHit(utterance, summary)) score += 3
    if (summary.id === ECOMMERCE_ID && ECOMMERCE_HINTS.some((hint) => utterance.includes(hint))) {
      score += 2
    }
    if (summary.id === MODEL_ID && MODEL_HINTS.some((hint) => utterance.includes(hint))) {
      score += 2
    }
    return score
  }

  private parseDelta(input: unknown): RecipeDelta {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('改动格式无效')
    }
    return input as RecipeDelta
  }

  private loadGraftSource(delta: RecipeDelta): RecipeDocument | undefined {
    if (!delta.graft) return undefined
    return getPlatformRecipe(delta.graft.recipeId, delta.graft.version)
  }

  private userMessagesFor(stripped: LintIssue[]): string[] {
    const seen = new Set<string>()
    const messages: string[] = []
    for (const issue of stripped) {
      const mapped = USER_MESSAGE_BY_CODE[issue.code] ?? issue.message
      if (!mapped || FORBIDDEN_USER_TEXT.test(mapped) || seen.has(mapped)) continue
      seen.add(mapped)
      messages.push(mapped)
    }
    return messages
  }
}
