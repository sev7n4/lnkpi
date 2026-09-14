import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  applyDelta,
  diffRecipeLines,
  getPlatformRecipe,
  inferRecipeDraftFromWorkflow,
  lintRecipe,
  listPlatformRecipeSummaries,
  RecipeInferError,
  slugRecipeKey,
  validateRecipe,
  type LintIssue,
  type RecipeDelta,
  type RecipeDocument,
  type RecipeNode,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'

const ECOMMERCE_HINTS = ['套图', '详情', '主图', '电商'] as const
const MODEL_HINTS = ['三视图', '定妆', '模特', '角色'] as const
const ECOMMERCE_ID = 'ecommerce-product-visual'
const MODEL_ID = 'model-turnaround'
const FORBIDDEN_USER_TEXT = /parentId|delta|种子链|嫁接|\blint\b/i
const UNCONFIRMED_SEED = '还没确认核心步骤，没法存成一套新模板。'
const UNRECOGNIZED_WORKFLOW = '这份工作流文件无法识别。'
const TOO_MANY_NODES = '节点太多，没法存成模板。'

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

export type PromoteRecipeInput = {
  sessionId: string
  userId: string
  workflow?: unknown
  mode: 'variant' | 'new_template'
  confirmedSeedKeys?: string[]
  title?: string
  parentId?: string
  parentVersion?: string
}

export type PromoteRecipeResult = {
  recipeId: string
  version: string
  title: string
  parentId: string | null
  parentVersion: string | null
  body: string
}

@Injectable()
export class WorkflowRecipeService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async matchRecipes(input: { userId: string; utterance: string }): Promise<MatchRecipesResult> {
    const utterance = input.utterance ?? ''
    const userRows = await this.prisma.userWorkflowRecipe.findMany({
      where: { userId: input.userId },
    })
    const summaries = [
      ...listPlatformRecipeSummaries(),
      ...userRows.map((row) => ({ id: row.recipeId, version: row.version, title: row.title })),
    ]
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
      const scoredEmpty = summaries
        .map((item) => ({ ...item, score: this.scoreSummary(utterance, item) }))
        .sort((a, b) => b.score - a.score)
      const anyUserHit = scoredEmpty.some((item) => item.score > 0 && !this.isPlatformId(item.id))
      if (anyUserHit) {
        return { items: scoredEmpty.slice(0, 3) }
      }
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

  async previewRecipeDelta(input: {
    userId: string
    parentId: string
    parentVersion: string
    delta: unknown
  }): Promise<PreviewRecipeDeltaResult> {
    const parent = await this.loadParent(input.userId, input.parentId, input.parentVersion)
    if (!parent) {
      throw new BadRequestException('找不到这套模板')
    }
    validateRecipe(parent)
    const delta = this.parseDelta(input.delta)
    const graftSource = this.loadGraftSource(delta)
    const { recipe, stripped } = applyDelta(parent, delta, {
      graftSource,
      alreadyGrafted: parent.graftedRecipeIds.length,
    })
    const extra = lintRecipe(recipe).filter(
      (issue) => !stripped.some((item) => item.code === issue.code && item.key === issue.key),
    )
    const allStripped = [...stripped, ...extra]
    const diffLines = diffRecipeLines(parent, recipe).filter((line) => !FORBIDDEN_USER_TEXT.test(line))
    const userMessages = this.userMessagesFor(allStripped)
    return { recipe, stripped: allStripped, diffLines, userMessages }
  }

  async getUserRecipe(
    userId: string,
    recipeId: string,
    version?: string,
  ): Promise<RecipeDocument | undefined> {
    const row = version
      ? await this.prisma.userWorkflowRecipe.findFirst({ where: { userId, recipeId, version } })
      : await this.prisma.userWorkflowRecipe.findUnique({
          where: { userId_recipeId: { userId, recipeId } },
        })
    if (!row) return undefined
    try {
      return validateRecipe(JSON.parse(row.body))
    } catch {
      return undefined
    }
  }

  async promoteRecipe(input: PromoteRecipeInput): Promise<PromoteRecipeResult> {
    const draft = this.inferDraft(input.workflow)
    if (input.mode === 'new_template') {
      return this.promoteNewTemplate(input, draft)
    }
    return this.promoteVariant(input, draft)
  }

  private inferDraft(workflow: unknown): RecipeDocument {
    try {
      return inferRecipeDraftFromWorkflow(workflow)
    } catch (err) {
      if (err instanceof RecipeInferError && err.code === 'too_many_nodes') {
        throw new BadRequestException({ message: TOO_MANY_NODES, userMessage: TOO_MANY_NODES })
      }
      throw new BadRequestException({
        message: UNRECOGNIZED_WORKFLOW,
        userMessage: UNRECOGNIZED_WORKFLOW,
      })
    }
  }

  private async promoteNewTemplate(
    input: PromoteRecipeInput,
    draft: RecipeDocument,
  ): Promise<PromoteRecipeResult> {
    const confirmed = input.confirmedSeedKeys ?? []
    const draftKeys = new Set(draft.nodes.map((node) => node.key))
    const seedHits = confirmed.filter((key) => draftKeys.has(key))
    const existingSeeds = draft.nodes.filter((node) => node.role === 'seed')
    const existingSeedConfirmed =
      existingSeeds.length === 0 || existingSeeds.some((node) => confirmed.includes(node.key))
    if (seedHits.length === 0 || !existingSeedConfirmed) {
      throw new BadRequestException({ message: UNCONFIRMED_SEED, userMessage: UNCONFIRMED_SEED })
    }

    const ordered = this.orderKeys(seedHits, draft.nodes)
    const chainId = draft.nodes.find((node) => node.key === ordered[0])?.chain ?? 'main'
    for (let i = 0; i < ordered.length; i++) {
      const node = draft.nodes.find((item) => item.key === ordered[i])
      if (!node) continue
      if (i === 0) node.role = 'seed'
      else if (i === ordered.length - 1) node.role = 'turnaround'
      else node.role = node.role ?? 'seed'
      if (!node.chain) node.chain = chainId
    }
    draft.invariants.seedChains = [{ id: chainId, keys: ordered }]

    const title = input.title?.trim() || draft.title || '未命名模板'
    const recipeId = `${slugRecipeKey(title)}-${randomBytes(3).toString('hex')}`
    const recipe: RecipeDocument = {
      ...draft,
      id: recipeId,
      version: '1.0.0',
      title,
      graftedRecipeIds: [],
    }
    delete recipe.parentId
    delete recipe.parentVersion
    validateRecipe(recipe)
    return this.persistUserRecipe({
      userId: input.userId,
      recipeId,
      version: '1.0.0',
      title,
      parentId: null,
      parentVersion: null,
      recipe,
      sourceSessionId: input.sessionId,
      sourceHash: this.hashWorkflow(input.workflow),
    })
  }

  private async promoteVariant(
    input: PromoteRecipeInput,
    draft: RecipeDocument,
  ): Promise<PromoteRecipeResult> {
    const parentId = input.parentId || draft.id
    const parentVersion = input.parentVersion || draft.version
    const parent = await this.loadParent(input.userId, parentId, parentVersion)
    if (!parent) {
      throw new BadRequestException('找不到这套模板')
    }
    const delta = this.deltaFromDraft(parent, draft)
    const graftSource = this.loadGraftSource(delta)
    const { recipe } = applyDelta(parent, delta, {
      graftSource,
      alreadyGrafted: parent.graftedRecipeIds.length,
    })
    const title = input.title?.trim() || recipe.title
    const recipeId = `${slugRecipeKey(title)}-${randomBytes(3).toString('hex')}`
    recipe.id = recipeId
    recipe.title = title
    validateRecipe(recipe)
    return this.persistUserRecipe({
      userId: input.userId,
      recipeId,
      version: recipe.version,
      title,
      parentId: parent.id,
      parentVersion: parent.version,
      recipe,
      sourceSessionId: input.sessionId,
      sourceHash: this.hashWorkflow(input.workflow),
    })
  }

  private async persistUserRecipe(input: {
    userId: string
    recipeId: string
    version: string
    title: string
    parentId: string | null
    parentVersion: string | null
    recipe: RecipeDocument
    sourceSessionId: string
    sourceHash: string
  }): Promise<PromoteRecipeResult> {
    const body = JSON.stringify(input.recipe)
    await this.prisma.userWorkflowRecipe.create({
      data: {
        userId: input.userId,
        recipeId: input.recipeId,
        version: input.version,
        title: input.title,
        parentId: input.parentId,
        parentVersion: input.parentVersion,
        body,
        sourceSessionId: input.sourceSessionId,
        sourceHash: input.sourceHash,
      },
    })
    return {
      recipeId: input.recipeId,
      version: input.version,
      title: input.title,
      parentId: input.parentId,
      parentVersion: input.parentVersion,
      body,
    }
  }

  private deltaFromDraft(parent: RecipeDocument, draft: RecipeDocument): RecipeDelta {
    const parentKeys = new Set(parent.nodes.map((node) => node.key))
    const draftByKey = new Map(draft.nodes.map((node) => [node.key, node]))
    const parentByKey = new Map(parent.nodes.map((node) => [node.key, node]))
    const remove = parent.nodes.filter((node) => !draftByKey.has(node.key)).map((node) => node.key)
    const add = draft.nodes
      .filter((node) => !parentKeys.has(node.key) && node.role !== 'seed' && node.role !== 'turnaround')
      .map((node) => ({ ...node, role: (node.role ?? 'downstream') as RecipeNode['role'], autoGenerate: false }))
    const rewire = draft.nodes.flatMap((node) => {
      const prev = parentByKey.get(node.key)
      if (!prev) return []
      if (prev.dependsOn.join('\0') === node.dependsOn.join('\0')) return []
      return [{ key: node.key, dependsOn: [...node.dependsOn] }]
    })
    const model = getPlatformRecipe(MODEL_ID, '1.0.0')
    let graft: RecipeDelta['graft']
    if (model) {
      const modelKeys = model.invariants.seedChains.flatMap((chain) => chain.keys)
      const parentSeed = new Set(parent.invariants.seedChains.flatMap((chain) => chain.keys))
      const draftHasModelChain =
        modelKeys.every((key) => draftByKey.has(key)) && modelKeys.some((key) => !parentSeed.has(key))
      if (draftHasModelChain) {
        graft = { recipeId: model.id, version: model.version }
      }
    }
    return {
      ...(remove.length ? { remove } : {}),
      ...(add.length ? { add } : {}),
      ...(rewire.length ? { rewire } : {}),
      ...(graft ? { graft } : {}),
    }
  }

  private orderKeys(keys: string[], nodes: RecipeNode[]): string[] {
    const wanted = new Set(keys)
    const subset = nodes.filter((node) => wanted.has(node.key))
    const remaining = new Set(subset.map((node) => node.key))
    const ordered: string[] = []
    while (remaining.size > 0) {
      const next = subset.find(
        (node) =>
          remaining.has(node.key) && node.dependsOn.filter((dep) => remaining.has(dep)).length === 0,
      )
      const key = next?.key ?? remaining.values().next().value!
      remaining.delete(key)
      ordered.push(key)
    }
    return ordered
  }

  private async loadParent(
    userId: string,
    id: string,
    version: string,
  ): Promise<RecipeDocument | undefined> {
    return getPlatformRecipe(id, version) ?? (await this.getUserRecipe(userId, id, version))
  }

  private isPlatformId(id: string): boolean {
    return id === ECOMMERCE_ID || id === MODEL_ID
  }

  private hashWorkflow(workflow: unknown): string {
    return createHash('sha256').update(JSON.stringify(workflow ?? {})).digest('hex')
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
