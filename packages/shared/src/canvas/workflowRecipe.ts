import { z } from 'zod'
import type { LocalRefBinding } from '../nodeRefs'
import type { SidebarAttachment } from '../sidebarAttachments'
import { buildWorkflowDocument, validateWorkflow, type WorkflowDocument } from './workflowExchange'

export const RECIPE_DATA_KEYS = [
  'recipeId',
  'recipeVersion',
  'recipeKey',
  'chain',
  'role',
  'genMode',
  'parentRecipeId',
] as const

export type RecipeRole = 'seed' | 'turnaround' | 'downstream'
export type RecipeGenMode = 't2i' | 'i2i' | 'v_ref'
export type PlannerNodeType = 'prompt' | 'image' | 'video' | 'text'

const PLANNER_NODE_TYPES = new Set<PlannerNodeType>(['prompt', 'image', 'video', 'text'])

const recipeRoleSchema = z.enum(['seed', 'turnaround', 'downstream'])
const recipeGenModeSchema = z.enum(['t2i', 'i2i', 'v_ref'])
const recipeNodeTypeSchema = z.enum([
  'prompt',
  'image',
  'video',
  'text',
  'group',
  'shot',
  'sceneComposer',
])

const recipeNodeSchema = z.object({
  key: z.string(),
  title: z.string(),
  type: recipeNodeTypeSchema,
  chain: z.string().optional(),
  role: recipeRoleSchema.optional(),
  dependsOn: z.array(z.string()),
  genMode: recipeGenModeSchema.optional(),
  promptHintTemplate: z.string().optional(),
  autoGenerate: z.boolean(),
})

const seedChainSchema = z.object({
  id: z.string(),
  keys: z.array(z.string()),
})

export const recipeDocumentSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  parentId: z.string().optional(),
  parentVersion: z.string().optional(),
  graftedRecipeIds: z.array(z.string()).default([]),
  /** id → 用户可见标题，applyDelta 嫁接成功时写入，供 diffRecipeLines 使用 */
  graftedRecipeTitles: z.record(z.string()).optional(),
  invariants: z.object({
    seedChains: z.array(seedChainSchema),
  }),
  topologyViews: z
    .object({
      trimmedKeys: z.array(z.string()).optional(),
    })
    .optional(),
  nodes: z.array(recipeNodeSchema),
})

export type RecipeNode = z.infer<typeof recipeNodeSchema>
export type RecipeDocument = z.infer<typeof recipeDocumentSchema>

export type RecipeDelta = {
  graft?: { recipeId: string; version: string }
  add?: RecipeNode[]
  remove?: string[]
  rewire?: Array<{ key: string; dependsOn: string[] }>
}

export type LintIssue = { code: string; message: string; key?: string }

export function validateRecipe(input: unknown): RecipeDocument {
  return recipeDocumentSchema.parse(input)
}

export function slugRecipeKey(title: string): string {
  if (!/[a-zA-Z]/.test(title)) return 'node'
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return slug || 'node'
}

export class RecipeInferError extends Error {
  readonly code: string
  constructor(code: string, message = code) {
    super(message)
    this.name = 'RecipeInferError'
    this.code = code
  }
}

const MAX_PROMOTE_NODES = 24

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function uniqueDraftKey(preferred: string, used: Set<string>): string {
  if (!used.has(preferred)) {
    used.add(preferred)
    return preferred
  }
  let i = 2
  while (used.has(`${preferred}_${i}`)) i += 1
  const next = `${preferred}_${i}`
  used.add(next)
  return next
}

function inferGenMode(value: unknown): RecipeGenMode | undefined {
  const parsed = recipeGenModeSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function inferRole(value: unknown): RecipeRole | undefined {
  const parsed = recipeRoleSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function inferNodeType(value: unknown): RecipeNode['type'] {
  const parsed = recipeNodeTypeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'image'
}

function seedChainsFromNodes(nodes: RecipeNode[]): RecipeDocument['invariants']['seedChains'] {
  const grouped = new Map<string, RecipeNode[]>()
  for (const node of nodes) {
    if (node.role !== 'seed' && node.role !== 'turnaround') continue
    const chainId = node.chain ?? 'seed'
    const list = grouped.get(chainId) ?? []
    list.push(node)
    grouped.set(chainId, list)
  }
  const chains: RecipeDocument['invariants']['seedChains'] = []
  for (const [id, chainNodes] of grouped) {
    const seeds = chainNodes.filter((node) => node.role === 'seed')
    const turns = chainNodes.filter((node) => node.role === 'turnaround')
    const keys = [...seeds, ...turns].map((node) => node.key)
    if (keys.length === 0) continue
    chains.push({ id, keys })
  }
  return chains
}

export function inferRecipeDraftFromWorkflow(input: unknown): RecipeDocument {
  const doc = validateWorkflow(input)
  if (doc.graph.nodes.length > MAX_PROMOTE_NODES) {
    throw new RecipeInferError('too_many_nodes', 'too_many_nodes')
  }

  const usedKeys = new Set<string>()
  const keyByNodeId = new Map<string, string>()
  const nodes: RecipeNode[] = doc.graph.nodes.map((node) => {
    const data = asRecord(node.data)
    const title = typeof data.title === 'string' && data.title.trim() ? data.title : '未命名'
    const preferred =
      typeof data.recipeKey === 'string' && data.recipeKey.trim()
        ? data.recipeKey
        : slugRecipeKey(title)
    const key = uniqueDraftKey(preferred, usedKeys)
    keyByNodeId.set(node.id, key)
    const prompt = typeof data.prompt === 'string' ? data.prompt : undefined
    const written: RecipeNode = {
      key,
      title,
      type: inferNodeType(node.type),
      dependsOn: [],
      autoGenerate: false,
    }
    const chain = typeof data.chain === 'string' && data.chain.trim() ? data.chain : undefined
    const role = inferRole(data.role)
    const genMode = inferGenMode(data.genMode)
    if (chain) written.chain = chain
    if (role) written.role = role
    if (genMode) written.genMode = genMode
    if (prompt) written.promptHintTemplate = prompt
    return written
  })

  const typeByNodeId = new Map(doc.graph.nodes.map((node) => [node.id, node.type]))
  const textualTypes = new Set(['prompt', 'text'])
  const visualTypes = new Set(['image', 'video'])
  for (const edge of doc.graph.edges) {
    const targetKey = keyByNodeId.get(edge.target)
    const sourceKey = keyByNodeId.get(edge.source)
    if (!targetKey || !sourceKey) continue
    const sourceType = typeByNodeId.get(edge.source)
    const targetType = typeByNodeId.get(edge.target)
    if (
      sourceType &&
      targetType &&
      textualTypes.has(sourceType) &&
      visualTypes.has(targetType)
    ) {
      continue
    }
    const target = nodes.find((node) => node.key === targetKey)
    if (!target || target.dependsOn.includes(sourceKey)) continue
    target.dependsOn.push(sourceKey)
  }

  const identityNode = doc.graph.nodes.find((node) => typeof asRecord(node.data).recipeId === 'string')
  const identity = identityNode ? asRecord(identityNode.data) : {}
  const titleNode = nodes[0]
  return {
    id: typeof identity.recipeId === 'string' ? identity.recipeId : 'draft',
    version: typeof identity.recipeVersion === 'string' ? identity.recipeVersion : '1.0.0',
    title: titleNode?.title ?? '未命名模板',
    graftedRecipeIds: [],
    invariants: { seedChains: seedChainsFromNodes(nodes) },
    nodes,
  }
}

function seedKeySet(recipe: RecipeDocument): Set<string> {
  const keys = new Set<string>()
  for (const chain of recipe.invariants.seedChains) {
    for (const key of chain.keys) keys.add(key)
  }
  return keys
}

function removeNode(recipe: RecipeDocument, key: string): void {
  recipe.nodes = recipe.nodes.filter((n) => n.key !== key)
  for (const node of recipe.nodes) {
    node.dependsOn = node.dependsOn.filter((dep) => dep !== key)
  }
}

function hasCycle(nodes: RecipeNode[]): boolean {
  const incoming = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const node of nodes) {
    if (!incoming.has(node.key)) {
      incoming.set(node.key, 0)
      outgoing.set(node.key, [])
    }
  }
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!incoming.has(dep)) continue
      outgoing.get(dep)!.push(node.key)
      incoming.set(node.key, (incoming.get(node.key) ?? 0) + 1)
    }
  }
  const queue = [...incoming.entries()].filter(([, count]) => count === 0).map(([key]) => key)
  let seen = 0
  while (queue.length > 0) {
    const key = queue.pop()!
    seen += 1
    for (const next of outgoing.get(key) ?? []) {
      const count = (incoming.get(next) ?? 1) - 1
      incoming.set(next, count)
      if (count === 0) queue.push(next)
    }
  }
  return seen < incoming.size
}

function hookForChain(
  chainId: string,
  turnaroundByChain: Map<string, string>,
  seedByChain: Map<string, string>,
): string | undefined {
  return turnaroundByChain.get(chainId) ?? seedByChain.get(chainId)
}

export function lintRecipe(
  recipe: RecipeDocument,
  opts?: { slots?: Record<string, string> },
): LintIssue[] {
  const issues: LintIssue[] = []
  const byKey = new Map<string, RecipeNode>()
  for (const node of recipe.nodes) {
    if (byKey.has(node.key)) {
      issues.push({ code: 'duplicate_key', message: `重复节点 ${node.key}`, key: node.key })
    }
    byKey.set(node.key, node)
  }

  for (const node of recipe.nodes) {
    for (const dep of node.dependsOn) {
      if (!byKey.has(dep)) {
        issues.push({ code: 'missing_dep', message: `依赖不存在：${dep}`, key: node.key })
      }
    }
  }

  if (hasCycle(recipe.nodes)) {
    issues.push({ code: 'dag_cycle', message: '依赖成环' })
  }

  for (const chain of recipe.invariants.seedChains) {
    for (let i = 0; i < chain.keys.length; i++) {
      const key = chain.keys[i]!
      const node = byKey.get(key)
      if (!node) {
        issues.push({ code: 'seed_incomplete', message: `核心步骤不完整：${key}`, key })
        continue
      }
      if (i === 0) {
        if (node.dependsOn.length > 0) {
          issues.push({ code: 'seed_order', message: `核心步骤起点不应有依赖`, key })
        }
      } else if (!node.dependsOn.includes(chain.keys[i - 1]!)) {
        issues.push({ code: 'seed_order', message: `核心步骤顺序不一致`, key })
      }
    }
  }

  const turnaroundByChain = new Map<string, string>()
  const seedByChain = new Map<string, string>()
  for (const chain of recipe.invariants.seedChains) {
    for (const key of chain.keys) {
      const node = byKey.get(key)
      if (!node) continue
      if (node.role === 'turnaround') turnaroundByChain.set(chain.id, key)
      if (node.role === 'seed') seedByChain.set(chain.id, key)
    }
    if (!seedByChain.has(chain.id) && chain.keys[0]) {
      seedByChain.set(chain.id, chain.keys[0])
    }
    if (!turnaroundByChain.has(chain.id) && chain.keys.length > 1) {
      turnaroundByChain.set(chain.id, chain.keys[chain.keys.length - 1]!)
    }
  }

  const chainIdByTurnaroundKey = new Map<string, string>()
  for (const [chainId, key] of turnaroundByChain) {
    chainIdByTurnaroundKey.set(key, chainId)
  }

  for (const node of recipe.nodes) {
    if (node.role === 'seed' || node.role === 'turnaround') continue

    if (node.chain) {
      const hook = hookForChain(node.chain, turnaroundByChain, seedByChain)
      if (hook && !node.dependsOn.includes(hook)) {
        issues.push({ code: 'downstream_unhooked', message: '下游未挂回核心步骤', key: node.key })
      }
    } else {
      const hitChains = new Set<string>()
      for (const dep of node.dependsOn) {
        const turnaroundChain = chainIdByTurnaroundKey.get(dep)
        if (turnaroundChain) hitChains.add(turnaroundChain)
        const depNode = byKey.get(dep)
        if (depNode?.chain) hitChains.add(depNode.chain)
      }
      if (hitChains.size >= 2) {
        for (const chainId of hitChains) {
          const hook = hookForChain(chainId, turnaroundByChain, seedByChain)
          if (hook && !node.dependsOn.includes(hook)) {
            issues.push({ code: 'downstream_unhooked', message: '跨链未挂回核心步骤', key: node.key })
          }
        }
      }
    }

    if (node.type === 'image' || node.type === 'video') {
      for (const dep of node.dependsOn) {
        const depNode = byKey.get(dep)
        if (!depNode) continue
        if (depNode.type === 'text' || depNode.type === 'prompt') {
          issues.push({ code: 'text_in_visual', message: '文案不能作为视觉依赖', key: node.key })
        }
        if (node.type === 'image' && depNode.type !== 'image') {
          issues.push({ code: 'invalid_edge', message: 'image 只依赖 image', key: node.key })
        }
        if (node.type === 'video' && depNode.type !== 'image') {
          issues.push({ code: 'invalid_edge', message: 'video 只依赖 image', key: node.key })
        }
      }
    }
  }

  for (const node of recipe.nodes) {
    if (!opts) continue
    if (!node.autoGenerate) continue
    const prompt = opts.slots?.[node.key] ?? node.promptHintTemplate ?? ''
    if (!prompt.trim()) {
      issues.push({ code: 'empty_prompt', message: '生成步骤缺少提示词', key: node.key })
    }
  }

  return issues
}

function graftConflicts(parent: RecipeDocument, source: RecipeDocument): boolean {
  const parentKeys = new Set(parent.nodes.map((n) => n.key))
  const parentChainIds = new Set(parent.invariants.seedChains.map((c) => c.id))
  const parentNodeChains = new Set(
    parent.nodes.map((n) => n.chain).filter((chain): chain is string => Boolean(chain)),
  )
  const copyNodes = source.nodes.filter((n) => n.role === 'seed' || n.role === 'turnaround')
  for (const node of copyNodes) {
    if (parentKeys.has(node.key)) return true
    if (node.chain && (parentChainIds.has(node.chain) || parentNodeChains.has(node.chain))) return true
  }
  for (const chain of source.invariants.seedChains) {
    if (parentChainIds.has(chain.id)) return true
  }
  return false
}

function parseRecipeLoose(input: unknown): RecipeDocument {
  return recipeDocumentSchema.parse(input)
}

export function applyDelta(
  parent: unknown,
  delta: RecipeDelta,
  opts?: { graftSource?: unknown; alreadyGrafted?: number },
): { recipe: RecipeDocument; stripped: LintIssue[] } {
  const recipe = structuredClone(parseRecipeLoose(parent))
  const parentId = recipe.id
  const parentVersion = recipe.version
  const stripped: LintIssue[] = []
  const addedKeys = new Set<string>()

  if (delta.graft) {
    if ((opts?.alreadyGrafted ?? 0) >= 1) {
      stripped.push({ code: 'graft_once', message: '一次改版只能接上另一套模板一次' })
    } else {
      const sourceParse = opts?.graftSource
        ? recipeDocumentSchema.safeParse(opts.graftSource)
        : undefined
      const source = sourceParse?.success ? sourceParse.data : undefined
      const mismatch =
        !source ||
        source.id !== delta.graft.recipeId ||
        source.version !== delta.graft.version ||
        graftConflicts(recipe, source)
      if (!source || mismatch) {
        stripped.push({ code: 'graft_conflict', message: '没法把另一套模板整段接上来' })
      } else {
        const copyNodes = source.nodes.filter((n) => n.role === 'seed' || n.role === 'turnaround')
        recipe.nodes.push(...copyNodes.map((n) => structuredClone(n)))
        const existingChainIds = new Set(recipe.invariants.seedChains.map((c) => c.id))
        for (const chain of source.invariants.seedChains) {
          if (!existingChainIds.has(chain.id)) {
            recipe.invariants.seedChains.push(structuredClone(chain))
            existingChainIds.add(chain.id)
          }
        }
        recipe.graftedRecipeIds = [...recipe.graftedRecipeIds, source.id]
        recipe.graftedRecipeTitles = {
          ...(recipe.graftedRecipeTitles ?? {}),
          [source.id]: source.title,
        }
      }
    }
  }

  const frozen = seedKeySet(recipe)
  for (const key of delta.remove ?? []) {
    if (frozen.has(key)) {
      stripped.push({ code: 'seed_frozen', message: '核心步骤不能拆掉', key })
      continue
    }
    if (!recipe.nodes.some((n) => n.key === key)) continue
    removeNode(recipe, key)
  }

  let addedCount = 0
  for (const node of delta.add ?? []) {
    if (node.role === 'seed' || node.role === 'turnaround') {
      stripped.push({ code: 'add_role', message: '不能自造核心步骤', key: node.key })
      continue
    }
    if (!PLANNER_NODE_TYPES.has(node.type as PlannerNodeType)) {
      stripped.push({ code: 'add_type', message: '不能增加该类型节点', key: node.key })
      continue
    }
    if (recipe.nodes.some((n) => n.key === node.key)) {
      stripped.push({ code: 'duplicate_key', message: `节点已存在：${node.key}`, key: node.key })
      continue
    }
    if (addedCount >= 8) {
      stripped.push({ code: 'add_cap', message: '一次最多增加 8 个节点', key: node.key })
      continue
    }
    const written = structuredClone(node)
    written.autoGenerate = false
    recipe.nodes.push(written)
    addedCount += 1
    addedKeys.add(written.key)
  }

  const appliedRewires: Array<{ key: string; previous: string[] }> = []
  for (const rw of delta.rewire ?? []) {
    const node = recipe.nodes.find((n) => n.key === rw.key)
    if (!node) {
      stripped.push({ code: 'missing_dep', message: `改线目标不存在：${rw.key}`, key: rw.key })
      continue
    }
    if (frozen.has(rw.key)) {
      stripped.push({ code: 'seed_frozen', message: '核心步骤连线不能改', key: rw.key })
      continue
    }
    const previous = [...node.dependsOn]
    node.dependsOn = [...rw.dependsOn]
    const issues = lintRecipe(recipe)
    if (
      issues.some(
        (issue) => issue.code === 'downstream_unhooked' && issue.key === rw.key,
      )
    ) {
      node.dependsOn = previous
      stripped.push({ code: 'downstream_unhooked', message: '下游必须挂回核心步骤', key: rw.key })
    } else {
      appliedRewires.push({ key: rw.key, previous })
    }
  }

  recipe.parentId = parentId
  recipe.parentVersion = parentVersion

  const finalIssues = lintRecipe(recipe)
  const failingAdds = new Set(
    finalIssues.filter((issue) => issue.key && addedKeys.has(issue.key)).map((issue) => issue.key!),
  )
  for (const key of failingAdds) {
    const issue = finalIssues.find((item) => item.key === key)
    if (issue) stripped.push(issue)
    removeNode(recipe, key)
  }

  const revertRewire = (entry: { key: string; previous: string[] }, issue: LintIssue) => {
    const node = recipe.nodes.find((n) => n.key === entry.key)
    if (!node) return
    node.dependsOn = entry.previous
    stripped.push(issue)
  }

  const remainingRewires = [...appliedRewires]
  const keyedIssues = lintRecipe(recipe).filter((issue) =>
    remainingRewires.some((rw) => rw.key === issue.key),
  )
  const revertedKeys = new Set<string>()
  for (const issue of keyedIssues) {
    if (!issue.key || revertedKeys.has(issue.key)) continue
    const entry = remainingRewires.find((rw) => rw.key === issue.key)
    if (!entry) continue
    revertRewire(entry, issue)
    revertedKeys.add(issue.key)
  }

  if (lintRecipe(recipe).some((issue) => issue.code === 'dag_cycle')) {
    for (const entry of remainingRewires) {
      if (revertedKeys.has(entry.key)) continue
      const node = recipe.nodes.find((n) => n.key === entry.key)
      if (node) node.dependsOn = entry.previous
    }
    stripped.push({ code: 'dag_cycle', message: '依赖成环' })
  }

  return { recipe, stripped }
}

export function diffRecipeLines(parent: unknown, recipe: unknown): string[] {
  const before = parseRecipeLoose(parent)
  const after = parseRecipeLoose(recipe)
  const lines: string[] = []

  const parentGrafted = new Set(before.graftedRecipeIds)
  const titles = { ...(before.graftedRecipeTitles ?? {}), ...(after.graftedRecipeTitles ?? {}) }
  for (const id of after.graftedRecipeIds) {
    if (parentGrafted.has(id)) continue
    const title = titles[id]
    if (title) lines.push(`接上「${title}」的核心步骤`)
  }

  const parentKeys = new Set(before.nodes.map((n) => n.key))
  const afterKeys = new Set(after.nodes.map((n) => n.key))
  const parentSeedKeys = new Set(before.invariants.seedChains.flatMap((c) => c.keys))
  const graftedKeys = new Set<string>()
  for (const chain of after.invariants.seedChains) {
    for (const key of chain.keys) {
      if (!parentSeedKeys.has(key)) graftedKeys.add(key)
    }
  }

  for (const node of after.nodes) {
    if (!parentKeys.has(node.key) && !graftedKeys.has(node.key)) {
      lines.push(`增加「${node.title}」`)
    }
  }
  for (const node of before.nodes) {
    if (!afterKeys.has(node.key)) {
      lines.push(`去掉 ${node.title}`)
    }
  }

  const beforeByKey = new Map(before.nodes.map((n) => [n.key, n]))
  for (const node of after.nodes) {
    const prev = beforeByKey.get(node.key)
    if (!prev) continue
    if (prev.dependsOn.join('\0') === node.dependsOn.join('\0')) continue
    lines.push(`调整「${node.title}」的连接`)
  }

  return lines
}

function recipeNodeId(node: RecipeNode): string {
  return `${node.type}-${node.key}`
}

const SLOT_STRIP_PHRASES = [
  '规划工作流',
  '确认落到画布',
  '存成一套',
  '新模板',
  '接到',
  '改版',
  '规划',
  '工作流',
  '先不改',
  '模板',
] as const

export type FillRecipeSlotsInput = {
  utterance?: string
  attachments?: SidebarAttachment[]
  slots?: Record<string, string>
}

export type FillRecipeSlotsResult = {
  slots: Record<string, string>
  localRefsByKey: Record<string, LocalRefBinding[]>
}

function stripPlannerPhrases(utterance: string): string {
  let text = utterance
  for (const phrase of SLOT_STRIP_PHRASES) {
    text = text.split(phrase).join(' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

function attachmentToLocalRef(attachment: SidebarAttachment): LocalRefBinding {
  return {
    id: attachment.id,
    mediaType: attachment.mediaType,
    sourceKind: attachment.sourceKind === 'upload' ? 'upload' : 'asset',
    label: attachment.label,
    ...(attachment.url ? { url: attachment.url } : {}),
    ...(attachment.text ? { text: attachment.text } : {}),
  }
}

export function fillRecipeSlots(
  recipe: RecipeDocument,
  input: FillRecipeSlotsInput = {},
): FillRecipeSlotsResult {
  const slots: Record<string, string> = { ...(input.slots ?? {}) }
  const brief = stripPlannerPhrases(input.utterance ?? '')
  if (brief.length >= 8) {
    for (const node of recipe.nodes) {
      if (!node.autoGenerate) continue
      if (slots[node.key] !== undefined) continue
      slots[node.key] = brief
    }
  }

  const localRefsByKey: Record<string, LocalRefBinding[]> = {}
  const imageSeeds = recipe.nodes.filter((node) => node.type === 'image' && node.role === 'seed')
  const used = new Set<string>()
  const images = (input.attachments ?? []).filter((item) => item.mediaType === 'image')

  const assignToSeed = (seed: RecipeNode | undefined, attachment: SidebarAttachment) => {
    if (!seed || used.has(attachment.id)) return
    localRefsByKey[seed.key] = [attachmentToLocalRef(attachment)]
    used.add(attachment.id)
  }

  for (const attachment of images) {
    if (attachment.role === 'product') {
      assignToSeed(
        imageSeeds.find((node) => node.chain === 'product'),
        attachment,
      )
    } else if (attachment.role === 'model') {
      assignToSeed(
        imageSeeds.find((node) => node.chain === 'model'),
        attachment,
      )
    }
  }
  for (const attachment of images) {
    if (used.has(attachment.id)) continue
    const seed = imageSeeds.find((node) => !localRefsByKey[node.key])
    assignToSeed(seed, attachment)
  }

  return { slots, localRefsByKey }
}

function topologicalLayers(nodes: RecipeNode[]): Map<string, number> {
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const memo = new Map<string, number>()

  const layerOf = (key: string, visiting: Set<string>): number => {
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    if (visiting.has(key)) return 0
    visiting.add(key)
    const node = byKey.get(key)
    let layer = 0
    if (node) {
      for (const dep of node.dependsOn) {
        if (!byKey.has(dep)) continue
        layer = Math.max(layer, layerOf(dep, visiting) + 1)
      }
    }
    visiting.delete(key)
    memo.set(key, layer)
    return layer
  }

  for (const node of nodes) layerOf(node.key, new Set())
  return memo
}

export function compileRecipeToWorkflow(
  recipeInput: unknown,
  slots?: Record<string, string>,
  localRefsByKey?: Record<string, LocalRefBinding[]>,
): WorkflowDocument {
  const recipe = parseRecipeLoose(recipeInput)
  const layers = topologicalLayers(recipe.nodes)
  const indexInLayer = new Map<string, number>()
  const layerCounts = new Map<number, number>()
  for (const node of recipe.nodes) {
    const layer = layers.get(node.key) ?? 0
    const index = layerCounts.get(layer) ?? 0
    indexInLayer.set(node.key, index)
    layerCounts.set(layer, index + 1)
  }
  const idByKey = new Map(recipe.nodes.map((node) => [node.key, recipeNodeId(node)]))

  const nodes = recipe.nodes.map((node) => {
    const layer = layers.get(node.key) ?? 0
    const index = indexInLayer.get(node.key) ?? 0
    const prompt = slots?.[node.key] ?? node.promptHintTemplate ?? ''
    const data: Record<string, unknown> = {
      title: node.title,
      prompt,
      recipeId: recipe.id,
      recipeVersion: recipe.version,
      recipeKey: node.key,
    }
    if (node.chain !== undefined) data.chain = node.chain
    if (node.role !== undefined) data.role = node.role
    if (node.genMode !== undefined) data.genMode = node.genMode
    if (recipe.parentId !== undefined) data.parentRecipeId = recipe.parentId
    if (node.dependsOn.length > 0) {
      data.mentionedKeys = node.dependsOn
        .map((dep) => idByKey.get(dep))
        .filter((id): id is string => Boolean(id))
    }
    const localRefs = localRefsByKey?.[node.key]
    if (localRefs && localRefs.length > 0) data.localRefs = localRefs
    if (!node.autoGenerate) data.status = 'draft'
    return {
      id: recipeNodeId(node),
      type: node.type,
      position: {
        x: 80 + layer * 360,
        y: 120 + index * 220,
      },
      data,
    }
  })

  const edges: Array<{ id: string; source: string; target: string }> = []
  for (const node of recipe.nodes) {
    const target = idByKey.get(node.key)!
    for (const dep of node.dependsOn) {
      const source = idByKey.get(dep)
      if (!source) continue
      edges.push({
        id: `e-${source}-${target}`,
        source,
        target,
      })
    }
  }

  return buildWorkflowDocument({
    nodes,
    edges,
    mode: 'subgraph',
    exportMode: 'lightweight',
    mediaIndex: [],
  })
}
