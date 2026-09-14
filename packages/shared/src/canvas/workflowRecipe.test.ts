import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateWorkflow } from './workflowExchange'
import {
  applyDelta,
  lintRecipe,
  validateRecipe,
  slugRecipeKey,
  diffRecipeLines,
  compileRecipeToWorkflow,
  inferRecipeDraftFromWorkflow,
  RECIPE_DATA_KEYS,
} from './workflowRecipe'

const goldenWorkflow = validateWorkflow(
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/workflow/examples/minimal-workflow.json'),
      'utf8',
    ),
  ),
)

const productParent = {
  id: 'ecommerce-product-visual',
  version: '1.0.0',
  title: '电商套图',
  invariants: { seedChains: [{ id: 'product', keys: ['white_bg', 'product_turnaround'] }] },
  nodes: [
    { key: 'white_bg', title: '白底', type: 'image', chain: 'product', role: 'seed', dependsOn: [], genMode: 't2i', autoGenerate: true },
    { key: 'product_turnaround', title: '四视图', type: 'image', chain: 'product', role: 'turnaround', dependsOn: ['white_bg'], genMode: 'i2i', autoGenerate: true },
    { key: 'banner', title: 'Banner', type: 'image', chain: 'product', role: 'downstream', dependsOn: ['product_turnaround'], genMode: 'i2i', autoGenerate: true },
  ],
}

const modelRecipe = {
  id: 'model-turnaround',
  version: '1.0.0',
  title: '角色三视图',
  invariants: { seedChains: [{ id: 'model', keys: ['model_portrait', 'model_turnaround'] }] },
  nodes: [
    { key: 'model_portrait', title: '定妆', type: 'image', chain: 'model', role: 'seed', dependsOn: [], genMode: 't2i', autoGenerate: true },
    { key: 'model_turnaround', title: '模特四视图', type: 'image', chain: 'model', role: 'turnaround', dependsOn: ['model_portrait'], genMode: 'i2i', autoGenerate: true },
    { key: 'model_lifestyle', title: '人景', type: 'image', chain: 'model', role: 'downstream', dependsOn: ['model_turnaround'], genMode: 'i2i', autoGenerate: true },
  ],
}

describe('workflowRecipe', () => {
  it('rejects removing seed chain keys', () => {
    const { recipe, stripped } = applyDelta(productParent, { remove: ['white_bg'] })
    expect(stripped.some((s) => s.code === 'seed_frozen')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'white_bg')).toBe(true)
  })

  it('strips rewire that unhooks downstream from turnaround', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      rewire: [{ key: 'banner', dependsOn: [] }],
    })
    expect(stripped.some((s) => s.code === 'downstream_unhooked')).toBe(true)
    expect(recipe.nodes.find((n) => n.key === 'banner')?.dependsOn).toContain('product_turnaround')
  })

  it('strips cyclic rewire even when turnaround hooks remain', () => {
    const parent = validateRecipe({
      ...productParent,
      nodes: [
        ...productParent.nodes,
        {
          key: 'pack',
          title: '包装',
          type: 'image',
          chain: 'product',
          role: 'downstream',
          dependsOn: ['product_turnaround'],
          genMode: 'i2i',
          autoGenerate: false,
        },
      ],
    })
    const { recipe, stripped } = applyDelta(parent, {
      rewire: [
        { key: 'banner', dependsOn: ['product_turnaround', 'pack'] },
        { key: 'pack', dependsOn: ['product_turnaround', 'banner'] },
      ],
    })
    expect(stripped.some((s) => s.code === 'dag_cycle')).toBe(true)
    expect(recipe.nodes.find((n) => n.key === 'banner')?.dependsOn).toEqual(['product_turnaround'])
    expect(recipe.nodes.find((n) => n.key === 'pack')?.dependsOn).toEqual(['product_turnaround'])
  })

  it('strips rewire that puts text into visual dependsOn', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      add: [{
        key: 'copy',
        title: '文案',
        type: 'text',
        role: 'downstream',
        dependsOn: [],
        autoGenerate: false,
      }],
      rewire: [{ key: 'banner', dependsOn: ['product_turnaround', 'copy'] }],
    })
    expect(stripped.some((s) => s.code === 'text_in_visual' && s.key === 'banner')).toBe(true)
    expect(recipe.nodes.find((n) => n.key === 'banner')?.dependsOn).toEqual(['product_turnaround'])
    expect(recipe.nodes.find((n) => n.key === 'copy')?.dependsOn).toEqual([])
  })

  it('grafts only seed chain and merges invariants', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
    }, { graftSource: modelRecipe })
    expect(stripped).toEqual([])
    expect(recipe.nodes.map((n) => n.key)).toEqual(
      expect.arrayContaining(['white_bg', 'product_turnaround', 'model_portrait', 'model_turnaround']),
    )
    expect(recipe.nodes.some((n) => n.key === 'model_lifestyle')).toBe(false)
    expect(recipe.invariants.seedChains.map((c) => c.id).sort()).toEqual(['model', 'product'])
  })

  it('does not count graft nodes toward add cap of 8', () => {
    const adds = Array.from({ length: 8 }, (_, i) => ({
      key: `extra_${i}`,
      title: `Extra ${i}`,
      type: 'image' as const,
      chain: 'product' as const,
      role: 'downstream' as const,
      dependsOn: ['product_turnaround'],
      genMode: 'i2i' as const,
      autoGenerate: false,
    }))
    const { stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
      add: adds,
    }, { graftSource: modelRecipe })
    expect(stripped.some((s) => s.code === 'add_cap')).toBe(false)
  })

  it('rejects second graft in one delta', () => {
    const { stripped } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
    }, { graftSource: modelRecipe, alreadyGrafted: 1 })
    expect(stripped.some((s) => s.code === 'graft_once')).toBe(true)
  })

  it('slugRecipeKey is stable ascii', () => {
    expect(slugRecipeKey('Pack Detail!')).toBe('pack_detail')
    expect(slugRecipeKey('白底主图')).toBe('node')
  })
})

describe('validateRecipe', () => {
  it('parses a complete recipe and defaults graftedRecipeIds', () => {
    const recipe = validateRecipe(productParent)
    expect(recipe.id).toBe('ecommerce-product-visual')
    expect(recipe.graftedRecipeIds).toEqual([])
    expect(recipe.nodes).toHaveLength(3)
  })

  it('throws on invalid input', () => {
    expect(() => validateRecipe(null)).toThrow()
    expect(() => validateRecipe({ id: 'x' })).toThrow()
  })
})

describe('lintRecipe', () => {
  it('accepts the product parent recipe', () => {
    expect(lintRecipe(validateRecipe(productParent))).toEqual([])
  })

  it('flags missing seed chain keys', () => {
    const recipe = validateRecipe({
      ...productParent,
      invariants: { seedChains: [{ id: 'product', keys: ['white_bg', 'missing_turnaround'] }] },
    })
    expect(lintRecipe(recipe).some((i) => i.code === 'seed_incomplete')).toBe(true)
  })

  it('flags seed chain order mismatch', () => {
    const recipe = validateRecipe({
      ...productParent,
      nodes: productParent.nodes.map((n) =>
        n.key === 'product_turnaround' ? { ...n, dependsOn: [] } : n,
      ),
    })
    expect(lintRecipe(recipe).some((i) => i.code === 'seed_order')).toBe(true)
  })

  it('flags missing dependencies', () => {
    const recipe = validateRecipe({
      ...productParent,
      nodes: productParent.nodes.map((n) =>
        n.key === 'banner' ? { ...n, dependsOn: ['no_such_node'] } : n,
      ),
    })
    expect(lintRecipe(recipe).some((i) => i.code === 'missing_dep' && i.key === 'banner')).toBe(true)
  })

  it('flags a dependency cycle', () => {
    const recipe = validateRecipe({
      id: 'cycle',
      version: '1.0.0',
      title: '环',
      invariants: { seedChains: [] },
      nodes: [
        { key: 'a', title: 'A', type: 'image', dependsOn: ['b'], autoGenerate: false },
        { key: 'b', title: 'B', type: 'image', dependsOn: ['a'], autoGenerate: false },
      ],
    })
    expect(lintRecipe(recipe).some((i) => i.code === 'dag_cycle')).toBe(true)
  })

  it('flags downstream that omits its chain turnaround', () => {
    const recipe = validateRecipe({
      ...productParent,
      nodes: productParent.nodes.map((n) =>
        n.key === 'banner' ? { ...n, dependsOn: ['white_bg'] } : n,
      ),
    })
    expect(lintRecipe(recipe).some((i) => i.code === 'downstream_unhooked' && i.key === 'banner')).toBe(true)
  })

  it('flags cross-chain node missing a hit turnaround', () => {
    const grafted = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
      add: [{
        key: 'combo',
        title: '组合',
        type: 'image',
        role: 'downstream',
        dependsOn: ['product_turnaround'],
        genMode: 'i2i',
        autoGenerate: false,
      }],
    }, { graftSource: modelRecipe }).recipe
    const broken = {
      ...grafted,
      nodes: grafted.nodes.map((n) =>
        n.key === 'combo' ? { ...n, dependsOn: ['product_turnaround', 'model_portrait'] } : n,
      ),
    }
    expect(lintRecipe(broken).some((i) => i.code === 'downstream_unhooked' && i.key === 'combo')).toBe(true)
  })

  it('flags text in visual dependsOn and image depending on non-image', () => {
    const recipe = validateRecipe({
      id: 'bad-edges',
      version: '1.0.0',
      title: '边',
      invariants: { seedChains: [] },
      nodes: [
        { key: 'copy', title: '文案', type: 'text', dependsOn: [], autoGenerate: false },
        { key: 'hero', title: '主图', type: 'image', dependsOn: ['copy'], autoGenerate: false },
        { key: 'clip', title: '视频', type: 'video', dependsOn: ['copy'], autoGenerate: false },
      ],
    })
    const issues = lintRecipe(recipe)
    expect(issues.some((i) => i.code === 'text_in_visual' && i.key === 'hero')).toBe(true)
    expect(issues.some((i) => i.code === 'invalid_edge' && i.key === 'hero')).toBe(true)
    expect(issues.some((i) => i.code === 'text_in_visual' && i.key === 'clip')).toBe(true)
    expect(issues.some((i) => i.code === 'invalid_edge' && i.key === 'clip')).toBe(true)
  })
})

describe('applyDelta extras', () => {
  it('removes non-seed nodes and dangling dependsOn', () => {
    const parent = validateRecipe({
      ...productParent,
      nodes: [
        ...productParent.nodes,
        {
          key: 'pack',
          title: '包装',
          type: 'image',
          chain: 'product',
          role: 'downstream',
          dependsOn: ['banner'],
          genMode: 'i2i',
          autoGenerate: false,
        },
      ],
    })
    const { recipe, stripped } = applyDelta(parent, { remove: ['banner'] })
    expect(stripped).toEqual([])
    expect(recipe.nodes.some((n) => n.key === 'banner')).toBe(false)
    expect(recipe.nodes.find((n) => n.key === 'pack')?.dependsOn).toEqual([])
  })

  it('forces autoGenerate false on added nodes', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      add: [{
        key: 'pack_detail',
        title: '包装细节',
        type: 'image',
        chain: 'product',
        role: 'downstream',
        dependsOn: ['product_turnaround'],
        genMode: 'i2i',
        autoGenerate: true,
      }],
    })
    expect(stripped).toEqual([])
    expect(recipe.nodes.find((n) => n.key === 'pack_detail')?.autoGenerate).toBe(false)
  })

  it('strips adding seed or non-planner types', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      add: [
        {
          key: 'new_seed',
          title: '伪种子',
          type: 'image',
          chain: 'product',
          role: 'seed',
          dependsOn: [],
          genMode: 't2i',
          autoGenerate: false,
        },
        {
          key: 'scene',
          title: '场景',
          type: 'sceneComposer',
          role: 'downstream',
          dependsOn: ['product_turnaround'],
          autoGenerate: false,
        },
      ],
    })
    expect(stripped.some((s) => s.code === 'add_role')).toBe(true)
    expect(stripped.some((s) => s.code === 'add_type')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'new_seed' || n.key === 'scene')).toBe(false)
  })

  it('strips adds beyond cap of 8', () => {
    const adds = Array.from({ length: 9 }, (_, i) => ({
      key: `extra_${i}`,
      title: `Extra ${i}`,
      type: 'image' as const,
      chain: 'product' as const,
      role: 'downstream' as const,
      dependsOn: ['product_turnaround'],
      genMode: 'i2i' as const,
      autoGenerate: false,
    }))
    const { recipe, stripped } = applyDelta(productParent, { add: adds })
    expect(stripped.some((s) => s.code === 'add_cap' && s.key === 'extra_8')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'extra_7')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'extra_8')).toBe(false)
  })

  it('rejects graft when source is missing or mismatched', () => {
    expect(applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
    }).stripped.some((s) => s.code === 'graft_conflict')).toBe(true)

    expect(applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '9.9.9' },
    }, { graftSource: modelRecipe }).stripped.some((s) => s.code === 'graft_conflict')).toBe(true)
  })

  it('rejects graft on key or chain collision without half copy', () => {
    const colliding = {
      ...modelRecipe,
      id: 'other-product',
      invariants: { seedChains: [{ id: 'product', keys: ['other_seed', 'other_turn'] }] },
      nodes: [
        { key: 'other_seed', title: 'X', type: 'image', chain: 'product', role: 'seed', dependsOn: [], genMode: 't2i', autoGenerate: true },
        { key: 'other_turn', title: 'Y', type: 'image', chain: 'product', role: 'turnaround', dependsOn: ['other_seed'], genMode: 'i2i', autoGenerate: true },
      ],
    }
    const { recipe, stripped } = applyDelta(productParent, {
      graft: { recipeId: 'other-product', version: '1.0.0' },
    }, { graftSource: colliding })
    expect(stripped.some((s) => s.code === 'graft_conflict')).toBe(true)
    expect(recipe.nodes.some((n) => n.key === 'other_seed')).toBe(false)
    expect(recipe.invariants.seedChains).toHaveLength(1)
  })

  it('strips rewire of seed chain nodes', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      rewire: [{ key: 'product_turnaround', dependsOn: [] }],
    })
    expect(stripped.some((s) => s.code === 'seed_frozen')).toBe(true)
    expect(recipe.nodes.find((n) => n.key === 'product_turnaround')?.dependsOn).toEqual(['white_bg'])
  })

  it('keeps a legal rewire when remove unhooks a different node', () => {
    const parent = validateRecipe({
      ...productParent,
      nodes: [
        ...productParent.nodes,
        {
          key: 'pack',
          title: '包装',
          type: 'image',
          chain: 'product',
          role: 'downstream',
          dependsOn: ['banner'],
          genMode: 'i2i',
          autoGenerate: false,
        },
        {
          key: 'detail',
          title: '细节',
          type: 'image',
          chain: 'product',
          role: 'downstream',
          dependsOn: ['product_turnaround'],
          genMode: 'i2i',
          autoGenerate: false,
        },
      ],
    })
    const { recipe, stripped } = applyDelta(parent, {
      remove: ['banner'],
      rewire: [{ key: 'detail', dependsOn: ['product_turnaround', 'white_bg'] }],
    })
    expect(recipe.nodes.find((n) => n.key === 'detail')?.dependsOn).toEqual([
      'product_turnaround',
      'white_bg',
    ])
    expect(stripped.some((s) => s.code === 'downstream_unhooked' && s.key === 'detail')).toBe(false)
  })

  it('strips added nodes that still fail lint', () => {
    const { recipe, stripped } = applyDelta(productParent, {
      add: [{
        key: 'orphan',
        title: '孤儿',
        type: 'image',
        chain: 'product',
        role: 'downstream',
        dependsOn: [],
        genMode: 'i2i',
        autoGenerate: false,
      }],
    })
    expect(recipe.nodes.some((n) => n.key === 'orphan')).toBe(false)
    expect(stripped.some((s) => s.key === 'orphan')).toBe(true)
  })

  it('sets parentId and parentVersion', () => {
    const { recipe } = applyDelta(productParent, { remove: ['banner'] })
    expect(recipe.parentId).toBe('ecommerce-product-visual')
    expect(recipe.parentVersion).toBe('1.0.0')
  })
})

describe('diffRecipeLines', () => {
  it('describes graft, add, and remove without internal words', () => {
    const { recipe } = applyDelta(productParent, {
      graft: { recipeId: 'model-turnaround', version: '1.0.0' },
      add: [{
        key: 'pack_detail',
        title: '包装细节',
        type: 'image',
        chain: 'product',
        role: 'downstream',
        dependsOn: ['product_turnaround'],
        genMode: 'i2i',
        autoGenerate: false,
      }],
      remove: ['banner'],
    }, { graftSource: modelRecipe })
    const lines = diffRecipeLines(productParent, recipe)
    expect(lines).toContain('接上「角色三视图」的核心步骤')
    expect(lines).toContain('增加「包装细节」')
    expect(lines).toContain('去掉 Banner')
    expect(lines.join('\n')).not.toMatch(/graft|delta|seedChains|parentId|种子链|嫁接|\blint\b/i)
  })

  it('describes rewire in user language', () => {
    const { recipe } = applyDelta(productParent, {
      rewire: [{ key: 'banner', dependsOn: ['product_turnaround', 'white_bg'] }],
    })
    const lines = diffRecipeLines(productParent, recipe)
    expect(lines.some((line) => line.includes('Banner') && line.includes('连接'))).toBe(true)
    expect(lines.join('\n')).not.toMatch(/graft|delta|parentId|种子链|嫁接|\blint\b/i)
  })
})

describe('RECIPE_DATA_KEYS', () => {
  it('lists identity keys written onto canvas node data', () => {
    expect([...RECIPE_DATA_KEYS]).toEqual([
      'recipeId',
      'recipeVersion',
      'recipeKey',
      'chain',
      'role',
      'genMode',
      'parentRecipeId',
    ])
  })
})

describe('compileRecipeToWorkflow', () => {
  it('compileRecipeToWorkflow writes identity data and layered positions', () => {
    const doc = compileRecipeToWorkflow(productParent, { white_bg: 'a white mug' })
    expect(doc.format).toBe('lnkpi.workflow')
    const bg = doc.graph.nodes.find((n) => n.data.recipeKey === 'white_bg')
    expect(bg?.data.recipeId).toBe('ecommerce-product-visual')
    expect(bg?.data.role).toBe('seed')
    expect(bg?.data.prompt).toBe('a white mug')
    const ta = doc.graph.nodes.find((n) => n.data.recipeKey === 'product_turnaround')
    expect(ta!.position.x).toBeGreaterThan(bg!.position.x)
    expect(doc.graph.edges.some((e) => e.source === bg!.id && e.target === ta!.id)).toBe(true)
  })

  it('uses type-key ids, hint prompts, mentionedKeys, and layered grid', () => {
    const withHint = {
      ...productParent,
      nodes: productParent.nodes.map((n) =>
        n.key === 'banner' ? { ...n, promptHintTemplate: 'banner hint' } : n,
      ),
    }
    const doc = compileRecipeToWorkflow(withHint, { white_bg: 'a white mug' })
    expect(doc.mode).toBe('subgraph')
    expect(doc.exportMode).toBe('lightweight')
    expect(doc.mediaIndex).toEqual([])
    const bg = doc.graph.nodes.find((n) => n.data.recipeKey === 'white_bg')
    const ta = doc.graph.nodes.find((n) => n.data.recipeKey === 'product_turnaround')
    const banner = doc.graph.nodes.find((n) => n.data.recipeKey === 'banner')
    expect(bg?.id).toBe('image-white_bg')
    expect(ta?.id).toBe('image-product_turnaround')
    expect(bg?.position).toEqual({ x: 80, y: 120 })
    expect(ta?.position).toEqual({ x: 440, y: 120 })
    expect(banner?.position).toEqual({ x: 800, y: 120 })
    expect(bg?.mediaRole).toBe('none')
    expect(bg?.data.recipeVersion).toBe('1.0.0')
    expect(bg?.data.chain).toBe('product')
    expect(bg?.data.genMode).toBe('t2i')
    expect(banner?.data.prompt).toBe('banner hint')
    expect(ta?.data.mentionedKeys).toEqual(['white_bg'])
    expect(banner?.data.mentionedKeys).toEqual(['product_turnaround'])
  })

  it('does not queue autoGenerate false nodes and still writes identity', () => {
    const { recipe } = applyDelta(productParent, {
      add: [{
        key: 'pack_detail',
        title: '包装细节',
        type: 'image',
        chain: 'product',
        role: 'downstream',
        dependsOn: ['product_turnaround'],
        genMode: 'i2i',
        autoGenerate: true,
      }],
    })
    const doc = compileRecipeToWorkflow(recipe)
    const added = doc.graph.nodes.find((n) => n.data.recipeKey === 'pack_detail')
    expect(added?.data.status).not.toBe('queued')
    expect(added?.data.recipeId).toBe('ecommerce-product-visual')
    expect(added?.data.recipeKey).toBe('pack_detail')
    expect(added?.data.parentRecipeId).toBe('ecommerce-product-visual')
  })
})

describe('inferRecipeDraftFromWorkflow', () => {
  it('infers two nodes from the golden minimal workflow', () => {
    const draft = inferRecipeDraftFromWorkflow(goldenWorkflow)
    expect(draft.nodes).toHaveLength(2)
    expect(draft.nodes.map((node) => node.key).sort()).toEqual(['hero_frame', 'scene_prompt'])
    const prompt = draft.nodes.find((node) => node.key === 'scene_prompt')
    const image = draft.nodes.find((node) => node.key === 'hero_frame')
    expect(prompt?.type).toBe('prompt')
    expect(image?.type).toBe('image')
    expect(image?.dependsOn).not.toContain('scene_prompt')
    expect(image?.dependsOn).toEqual([])
    expect(prompt?.dependsOn).toEqual([])
    expect(image?.promptHintTemplate).toContain('mountain lake')
    expect(prompt?.promptHintTemplate).toContain('mountain lake')
    expect(JSON.stringify(draft)).not.toContain('cdn.example.com')
  })

  it('prefers data.recipeKey and keeps role/chain annotations', () => {
    const doc = compileRecipeToWorkflow(productParent)
    const draft = inferRecipeDraftFromWorkflow(doc)
    expect(draft.nodes.map((node) => node.key)).toEqual(
      expect.arrayContaining(['white_bg', 'product_turnaround', 'banner']),
    )
    expect(draft.nodes.find((node) => node.key === 'white_bg')?.role).toBe('seed')
    expect(draft.nodes.find((node) => node.key === 'white_bg')?.chain).toBe('product')
  })

  it('throws too_many_nodes when the graph has more than 24 nodes', () => {
    const extra = Array.from({ length: 23 }, (_, i) => ({
      id: `image-extra-${i}`,
      type: 'image',
      position: { x: 0, y: i * 10 },
      data: { title: `Extra ${i}` },
      mediaRole: 'none' as const,
    }))
    const oversized = {
      ...goldenWorkflow,
      graph: {
        ...goldenWorkflow.graph,
        nodes: [...goldenWorkflow.graph.nodes, ...extra],
      },
    }
    expect(() => inferRecipeDraftFromWorkflow(oversized)).toThrow(
      expect.objectContaining({ code: 'too_many_nodes' }),
    )
  })
})
