import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  applyDelta,
  buildWorkflowDocument,
  compileRecipeToWorkflow,
  diffRecipeLines,
  fillRecipeSlots,
  getPlatformRecipe,
  inferRecipeDraftFromWorkflow,
  lintRecipe,
  matchPlatformRecipes,
  RecipeInferError,
  slugRecipeKey,
  validateRecipe,
  PLATFORM_RECIPES,
  type CanvasData,
  type LintIssue,
  type RecipeDelta,
  type RecipeDocument,
  type RecipeNode,
  type SidebarAttachment,
  type WorkflowDocument,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'

const ECOMMERCE_ID = 'ecommerce-product-visual'
const MODEL_ID = 'model-turnaround'
const FORBIDDEN_USER_TEXT = /parentId|delta|种子链|嫁接|\blint\b/i
const UNCONFIRMED_SEED = '还没确认核心步骤，没法存成一套新模板。'
const UNRECOGNIZED_WORKFLOW = '这份工作流文件无法识别。'
const TOO_MANY_NODES = '节点太多，没法存成模板。'
const RECIPE_NOT_READY = '这份工作流还不能存成模板，请先调整步骤和连线。'
const KEY_CHAIN_CONFLICT = '步骤名称和已有模板重复，请改个名字再保存。'
const INSTANTIATE_NEEDS_CONFIRM = '请先确认改动再落到画布。'
const EMPTY_PROMPT = '还有步骤没写提示词，先补上再放到画布。'

const USER_MESSAGE_BY_CODE: Record<string, string> = {
  seed_frozen: '主图仍需跟着四视图，那一步没改。',
  graft_conflict: '没法把「角色三视图」整段接上来，和当前模板的步骤冲突。',
  text_in_visual: '文案不能作为图片或视频的上游。',
  invalid_edge: '图片只能接在图片后面。',
  dag_cycle: '步骤连线成环了，请先改连线。',
  seed_order: '核心步骤的顺序对不上，请先调整。',
  empty_prompt: EMPTY_PROMPT,
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
    const platform = matchPlatformRecipes(utterance)
    const userRows = await this.prisma.userWorkflowRecipe.findMany({
      where: { userId: input.userId },
    })
    const userItems = userRows.map((row) => ({
      id: row.recipeId,
      version: row.version,
      title: row.title,
      score: this.scoreUserSummary(utterance, { id: row.recipeId, title: row.title }),
    }))

    if (platform.graftHint) {
      return {
        items: platform.items.slice(0, 3),
        graftHint: platform.graftHint,
      }
    }

    if (platform.needsClarify) {
      const scoredEmpty = [...userItems, ...platform.items].sort((a, b) => b.score - a.score)
      const anyUserHit = scoredEmpty.some((item) => item.score > 0 && !this.isPlatformId(item.id))
      if (anyUserHit) {
        return { items: scoredEmpty.slice(0, 3) }
      }
      return {
        items: platform.items.slice(0, 2),
        needsClarify: true,
      }
    }

    const scored = [...platform.items, ...userItems]
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
    const graftSource = await this.loadGraftSource(input.userId, delta)
    const { recipe, stripped } = applyDelta(parent, delta, {
      graftSource,
      alreadyGrafted: parent.graftedRecipeIds.length,
    })
    const diffLines = diffRecipeLines(parent, recipe).filter((line) => !FORBIDDEN_USER_TEXT.test(line))
    const userMessages = this.userMessagesFor(stripped)
    return { recipe, stripped, diffLines, userMessages }
  }

  async compileInstantiate(input: {
    sessionId: string
    userId: string
    parentId: string
    parentVersion: string
    delta: unknown
    slots?: Record<string, string>
    utterance?: string
    sidebarAttachments?: unknown[]
    recipe?: unknown
  }): Promise<WorkflowDocument> {
    if (input.recipe !== undefined && input.recipe !== null) {
      throw new BadRequestException({
        message: INSTANTIATE_NEEDS_CONFIRM,
        userMessage: INSTANTIATE_NEEDS_CONFIRM,
      })
    }
    const parent = await this.loadParent(input.userId, input.parentId, input.parentVersion)
    if (!parent) {
      throw new BadRequestException('找不到这套模板')
    }
    validateRecipe(parent)
    const delta = this.parseDelta(input.delta ?? {})
    const graftSource = await this.loadGraftSource(input.userId, delta)
    const { recipe } = applyDelta(parent, delta, {
      graftSource,
      alreadyGrafted: parent.graftedRecipeIds.length,
    })
    const attachments = Array.isArray(input.sidebarAttachments)
      ? (input.sidebarAttachments as SidebarAttachment[])
      : []
    const filled = fillRecipeSlots(recipe, {
      utterance: input.utterance,
      attachments,
      slots: input.slots,
    })
    const issues = lintRecipe(recipe, { slots: filled.slots })
    if (issues.length > 0) {
      const empty = issues.some((issue) => issue.code === 'empty_prompt')
      throw new BadRequestException({
        message: empty ? EMPTY_PROMPT : '这套模板有不合法的步骤或连线，没法放到画布上。',
        userMessage: empty ? EMPTY_PROMPT : '这套模板有不合法的步骤或连线，没法放到画布上。',
      })
    }
    return compileRecipeToWorkflow(recipe, filled.slots, filled.localRefsByKey)
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
    const workflow = await this.resolveWorkflow(input)
    const draft = this.inferDraft(workflow)
    if (input.mode === 'new_template') {
      return this.promoteNewTemplate({ ...input, workflow }, draft)
    }
    return this.promoteVariant({ ...input, workflow }, draft)
  }

  private async resolveWorkflow(input: PromoteRecipeInput): Promise<unknown> {
    if (input.workflow !== undefined && input.workflow !== null) {
      return input.workflow
    }
    const session = await this.loadOwnedSession(input.sessionId, input.userId)
    return buildWorkflowDocument({
      nodes: session.canvas.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: node.data ?? {},
      })),
      edges: session.canvas.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
      mode: 'full',
      exportMode: 'lightweight',
      sourceSessionId: session.id,
      mediaIndex: [],
    })
  }

  private parseCanvas(raw: string | null | undefined): CanvasData {
    if (!raw) return { nodes: [], edges: [] }
    try {
      const parsed = JSON.parse(raw) as CanvasData
      return {
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
        viewport: parsed.viewport,
      }
    } catch {
      return { nodes: [], edges: [] }
    }
  }

  private async loadSession(sessionId: string): Promise<{
    id: string
    userId: string
    canvas: CanvasData
  }> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session) throw new NotFoundException('会话不存在')
    return {
      id: session.id,
      userId: session.userId,
      canvas: this.parseCanvas(session.canvasData),
    }
  }

  private async loadOwnedSession(
    sessionId: string,
    userId: string,
  ): Promise<{ id: string; userId: string; canvas: CanvasData }> {
    const session = await this.loadSession(sessionId)
    if (session.userId !== userId) throw new ForbiddenException()
    return session
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
    const graftSource = await this.loadGraftSource(input.userId, delta)
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
    const issues = lintRecipe(input.recipe)
    if (issues.length > 0) {
      const userMessage = this.userMessagesFor(issues)[0] ?? RECIPE_NOT_READY
      throw new BadRequestException({ message: userMessage, userMessage })
    }
    await this.assertNoCatalogCollision(input.userId, input.recipe, input.parentId)
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
    return PLATFORM_RECIPES.some((recipe) => recipe.id === id)
  }

  private hashWorkflow(workflow: unknown): string {
    return createHash('sha256').update(JSON.stringify(workflow ?? {})).digest('hex')
  }

  private titleOrIdHit(utterance: string, summary: { id: string; title: string }): boolean {
    const low = utterance.toLowerCase()
    return utterance.includes(summary.title) || low.includes(summary.id.toLowerCase())
  }

  private scoreUserSummary(utterance: string, summary: { id: string; title: string }): number {
    return this.titleOrIdHit(utterance, summary) ? 3 : 0
  }

  private parseDelta(input: unknown): RecipeDelta {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('改动格式无效')
    }
    return input as RecipeDelta
  }

  private catalogIdentity(recipe: RecipeDocument): { keys: Set<string>; chains: Set<string> } {
    return {
      keys: new Set(recipe.nodes.map((node) => node.key)),
      chains: new Set([
        ...recipe.invariants.seedChains.map((chain) => chain.id),
        ...recipe.nodes.map((node) => node.chain).filter((chain): chain is string => Boolean(chain)),
      ]),
    }
  }

  private overlapsCatalog(left: RecipeDocument, right: RecipeDocument): boolean {
    const a = this.catalogIdentity(left)
    const b = this.catalogIdentity(right)
    for (const key of a.keys) {
      if (b.keys.has(key)) return true
    }
    for (const chain of a.chains) {
      if (b.chains.has(chain)) return true
    }
    return false
  }

  private async assertNoCatalogCollision(
    userId: string,
    recipe: RecipeDocument,
    parentId: string | null,
  ): Promise<void> {
    const skipIds = new Set<string>(recipe.graftedRecipeIds)
    if (parentId) skipIds.add(parentId)
    const userRows = await this.prisma.userWorkflowRecipe.findMany({ where: { userId } })
    const others: RecipeDocument[] = [...PLATFORM_RECIPES]
    for (const row of userRows) {
      try {
        others.push(validateRecipe(JSON.parse(row.body)))
      } catch {
        continue
      }
    }
    const conflict = others.some((item) => !skipIds.has(item.id) && this.overlapsCatalog(recipe, item))
    if (conflict) {
      throw new BadRequestException({
        message: KEY_CHAIN_CONFLICT,
        userMessage: KEY_CHAIN_CONFLICT,
      })
    }
  }

  private async loadGraftSource(
    userId: string,
    delta: RecipeDelta,
  ): Promise<RecipeDocument | undefined> {
    if (!delta.graft) return undefined
    return (
      getPlatformRecipe(delta.graft.recipeId, delta.graft.version) ??
      (await this.getUserRecipe(userId, delta.graft.recipeId, delta.graft.version))
    )
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
