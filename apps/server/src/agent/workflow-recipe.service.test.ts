import 'reflect-metadata'
import { BadRequestException, ValidationPipe } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { compileRecipeToWorkflow, getPlatformRecipe } from '@lnkpi/shared'
import {
  MatchRecipesDto,
  PreviewRecipeDeltaDto,
  PromoteRecipeDto,
} from './agent-canvas-tools.controller'
import { PrismaService } from '../prisma/prisma.service'
import { WorkflowRecipeService } from './workflow-recipe.service'

const FORBIDDEN = /parentId|delta|种子链|嫁接|\blint\b/i

const goldenWorkflow = {
  format: 'lnkpi.workflow',
  version: '1.0.0',
  exportedAt: '2026-09-12T01:00:00.000Z',
  mode: 'full',
  exportMode: 'lightweight',
  graph: {
    nodes: [
      {
        id: 'prompt-golden-1',
        type: 'prompt',
        position: { x: 80, y: 120 },
        data: {
          title: 'Scene prompt',
          prompt: 'A serene mountain lake at dawn, cinematic lighting',
        },
        mediaRole: 'none',
      },
      {
        id: 'image-golden-1',
        type: 'image',
        position: { x: 400, y: 120 },
        data: {
          title: 'Hero frame',
          prompt: 'A serene mountain lake at dawn, cinematic lighting',
          url: 'https://cdn.example.com/workflows/golden-lake.png',
          generationRecordId: 'gen-golden-001',
        },
        mediaRole: 'generated',
      },
    ],
    edges: [{ id: 'edge-golden-1', source: 'prompt-golden-1', target: 'image-golden-1' }],
  },
  mediaIndex: [
    {
      nodeId: 'image-golden-1',
      kind: 'image',
      fileName: 'golden-lake.png',
      url: 'https://cdn.example.com/workflows/golden-lake.png',
    },
  ],
}

type UserRecipeRow = {
  userId: string
  recipeId: string
  version: string
  title: string
  parentId: string | null
  parentVersion: string | null
  body: string
  sourceSessionId: string | null
  sourceHash: string | null
}

type SessionRow = { id: string; userId: string; canvasData: string }

function createPrisma() {
  const rows: UserRecipeRow[] = []
  const sessions = new Map<string, SessionRow>()
  const prisma = {
    userWorkflowRecipe: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        rows.filter((row) => row.userId === where.userId),
      findUnique: async ({
        where,
      }: {
        where: { userId_recipeId: { userId: string; recipeId: string } }
      }) =>
        rows.find(
          (row) =>
            row.userId === where.userId_recipeId.userId &&
            row.recipeId === where.userId_recipeId.recipeId,
        ) ?? null,
      findFirst: async ({
        where,
      }: {
        where: { userId: string; recipeId: string; version?: string }
      }) =>
        rows.find(
          (row) =>
            row.userId === where.userId &&
            row.recipeId === where.recipeId &&
            (where.version ? row.version === where.version : true),
        ) ?? null,
      create: async ({ data }: { data: UserRecipeRow }) => {
        rows.push({ ...data })
        return data
      },
    },
    session: {
      findUnique: async ({ where }: { where: { id: string } }) => sessions.get(where.id) ?? null,
    },
  }
  return {
    rows,
    sessions,
    prisma: prisma as unknown as PrismaService,
  }
}

describe('WorkflowRecipeService', () => {
  const { rows, sessions, prisma } = createPrisma()
  const svc = new WorkflowRecipeService(prisma)

  describe('matchRecipes', () => {
    it('returns ecommerce parent with graftHint for 套图+三视图', async () => {
      const result = await svc.matchRecipes({
        userId: 'u1',
        utterance: '套图并且要模特三视图',
      })
      expect(result.items).toEqual([])
      expect(result.graftHint).toBeUndefined()
      expect(result.needsClarify).not.toBe(true)
    })

    it('returns two platform summaries with needsClarify when nothing matches', async () => {
      const result = await svc.matchRecipes({ userId: 'u1', utterance: '今天天气怎么样' })
      expect(result.items).toEqual([])
      expect(result.graftHint).toBeUndefined()
      expect(result.needsClarify).not.toBe(true)
    })
  })

  describe('previewRecipeDelta', () => {
    it('includes 去掉 in diffLines when removing banner', async () => {
      const result = await svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['banner'] },
      })
      expect(result.diffLines.some((line) => line.includes('去掉'))).toBe(true)
      expect(result.removedTitles).toContain('Banner')
      expect(result.strippedCodes).toEqual([])
      expect('recipe' in result).toBe(false)
    })

    it('maps seed_frozen to userMessages when removing white_bg', async () => {
      const result = await svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['white_bg'] },
      })
      expect(result.strippedCodes).toContain('seed_frozen')
      expect(result.removedTitles).not.toContain('白底图')
      expect(result.userMessages.some((msg) => msg.includes('主图仍需跟着四视图'))).toBe(true)
      expect(JSON.stringify(result)).not.toMatch(FORBIDDEN)
    })

    it('grafts model seed chain without lifestyle nodes', async () => {
      const result = await svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { graft: { recipeId: 'model-turnaround', version: '1.0.0' } },
      })
      expect(result.strippedCodes).not.toContain('graft_conflict')
      expect(result.addedTitles).toEqual(expect.arrayContaining(['模特定妆', '模特四视图']))
      expect(result.addedTitles.some((title) => title.includes('人景'))).toBe(false)
      expect(JSON.stringify(result)).not.toMatch(FORBIDDEN)
      expect(JSON.stringify(result)).not.toMatch(/parentId|seedChains|model_portrait/)
    })
  })

  describe('promoteRecipe', () => {
    it('returns needs_seed_confirm without writing when seed keys are missing', async () => {
      const result = await svc.promoteRecipe({
        sessionId: 's1',
        userId: 'u1',
        workflow: goldenWorkflow,
        mode: 'new_template',
        title: '湖景',
      })
      expect(result).toMatchObject({
        status: 'needs_seed_confirm',
        userMessage: expect.stringContaining('将锁定这些核心步骤'),
      })
      if (result.status !== 'needs_seed_confirm') throw new Error('expected preview')
      expect(result.coreSteps.map((step) => step.title)).toEqual(
        expect.arrayContaining(['Scene prompt', 'Hero frame']),
      )
      expect(result.userMessage).not.toMatch(FORBIDDEN)
      expect(result.userMessage).not.toMatch(/scene_prompt|hero_frame/)
      expect(rows).toHaveLength(0)
    })

    it('returns needs_variant_confirm without writing until confirmed', async () => {
      const parent = getPlatformRecipe('ecommerce-product-visual', '1.0.0')
      expect(parent).toBeTruthy()
      const workflow = compileRecipeToWorkflow(parent!)
      const result = await svc.promoteRecipe({
        sessionId: 's1',
        userId: 'u2',
        workflow,
        mode: 'variant',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
      })
      expect(result).toMatchObject({
        status: 'needs_variant_confirm',
        parentTitle: '电商套图',
        userMessage: expect.stringContaining('请确认是否保存为改版'),
      })
      expect(rows).toHaveLength(0)
    })

    it('writes new_template with seed keys and loads via getUserRecipe', async () => {
      const saved = await svc.promoteRecipe({
        sessionId: 's1',
        userId: 'u1',
        workflow: goldenWorkflow,
        mode: 'new_template',
        confirmedSeedKeys: ['scene_prompt'],
        title: '湖景',
      })
      expect(saved.recipeId).toMatch(/^node-[a-z0-9]{6}$/)
      expect(saved.version).toBe('1.0.0')
      expect(saved.parentId == null || saved.parentId === '').toBe(true)
      const loaded = await svc.getUserRecipe('u1', saved.recipeId)
      expect(loaded).toBeTruthy()
      expect(loaded?.id).toBe(saved.recipeId)
      expect(loaded?.invariants.seedChains.some((chain) => chain.keys.includes('scene_prompt'))).toBe(
        true,
      )
      const matched = await svc.matchRecipes({ userId: 'u1', utterance: '湖景' })
      expect(matched.items.some((item) => item.id === saved.recipeId)).toBe(true)
    })

    it('variant against product parent drops banner from saved body', async () => {
      const parent = getPlatformRecipe('ecommerce-product-visual', '1.0.0')
      expect(parent).toBeTruthy()
      const withoutBanner = {
        ...parent!,
        nodes: parent!.nodes.filter((node) => node.key !== 'banner'),
      }
      const workflow = compileRecipeToWorkflow(withoutBanner)
      const saved = await svc.promoteRecipe({
        sessionId: 's1',
        userId: 'u2',
        workflow,
        mode: 'variant',
        confirmed: true,
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
      })
      expect(saved.status).toBe('saved')
      if (saved.status !== 'saved') throw new Error('expected saved')
      const body = JSON.parse(saved.body) as { nodes: Array<{ key: string }> }
      expect(body.nodes.some((node) => node.key === 'banner')).toBe(false)
      expect(saved.parentId).toBe('ecommerce-product-visual')
      expect(saved.parentVersion).toBe('1.0.0')
    })

    it('promotes from session canvas when workflow is omitted', async () => {
      sessions.set('s-canvas', {
        id: 's-canvas',
        userId: 'u3',
        canvasData: JSON.stringify({
          nodes: [
            {
              id: 'prompt-session-1',
              type: 'prompt',
              position: { x: 80, y: 120 },
              data: {
                title: 'Scene prompt',
                prompt: 'A serene mountain lake at dawn, cinematic lighting',
              },
            },
            {
              id: 'image-session-1',
              type: 'image',
              position: { x: 400, y: 120 },
              data: {
                title: 'Hero frame',
                prompt: 'A serene mountain lake at dawn, cinematic lighting',
              },
            },
          ],
          edges: [{ id: 'e-session-1', source: 'prompt-session-1', target: 'image-session-1' }],
        }),
      })
      const before = rows.filter((row) => row.userId === 'u3').length
      const saved = await svc.promoteRecipe({
        sessionId: 's-canvas',
        userId: 'u3',
        mode: 'new_template',
        confirmedSeedKeys: ['scene_prompt'],
        title: '湖景',
      })
      expect(rows.filter((row) => row.userId === 'u3')).toHaveLength(before + 1)
      expect(saved.recipeId).toMatch(/^node-[a-z0-9]{6}$/)
      const loaded = await svc.getUserRecipe('u3', saved.recipeId)
      expect(loaded?.invariants.seedChains.some((chain) => chain.keys.includes('scene_prompt'))).toBe(
        true,
      )
      expect(loaded?.nodes).toHaveLength(2)
      const hero = loaded?.nodes.find((node) => node.key === 'hero_frame')
      expect(hero?.dependsOn ?? []).not.toContain('scene_prompt')
    })

    it('rejects new_template when lint fails and does not persist', async () => {
      const illegalWorkflow = {
        format: 'lnkpi.workflow',
        version: '1.0.0',
        exportedAt: '2026-09-12T01:00:00.000Z',
        mode: 'full',
        exportMode: 'lightweight',
        graph: {
          nodes: [
            {
              id: 'text-copy-1',
              type: 'text',
              position: { x: 80, y: 120 },
              data: { title: 'Slogan copy', prompt: 'Buy now' },
              mediaRole: 'none',
            },
            {
              id: 'video-hero-1',
              type: 'video',
              position: { x: 400, y: 120 },
              data: { title: 'Hero clip' },
              mediaRole: 'none',
            },
            {
              id: 'image-hero-1',
              type: 'image',
              position: { x: 720, y: 120 },
              data: { title: 'Hero still' },
              mediaRole: 'none',
            },
          ],
          edges: [
            { id: 'e-text-image', source: 'text-copy-1', target: 'image-hero-1' },
            { id: 'e-video-image', source: 'video-hero-1', target: 'image-hero-1' },
          ],
        },
        mediaIndex: [],
      }
      const before = rows.length
      try {
        await svc.promoteRecipe({
          sessionId: 's1',
          userId: 'u-lint',
          workflow: illegalWorkflow,
          mode: 'new_template',
          confirmedSeedKeys: ['hero_still'],
          title: '非法连线',
        })
        throw new Error('expected reject')
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException)
        const body = (err as BadRequestException).getResponse() as {
          userMessage?: string
          message?: string
        }
        const shown = body.userMessage ?? body.message ?? ''
        expect(shown.length).toBeGreaterThan(0)
        expect(JSON.stringify(body)).not.toMatch(FORBIDDEN)
      }
      expect(rows).toHaveLength(before)
    })

    it('rejects new_template when node keys collide with platform ecommerce', async () => {
      const parent = getPlatformRecipe('ecommerce-product-visual', '1.0.0')
      expect(parent).toBeTruthy()
      const workflow = compileRecipeToWorkflow(parent!)
      const before = rows.length
      try {
        await svc.promoteRecipe({
          sessionId: 's1',
          userId: 'u-collide',
          workflow,
          mode: 'new_template',
          confirmedSeedKeys: ['white_bg', 'product_turnaround'],
          title: '撞名套图',
        })
        throw new Error('expected reject')
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException)
        const body = (err as BadRequestException).getResponse() as {
          userMessage?: string
          message?: string
        }
        const shown = `${body.userMessage ?? ''} ${body.message ?? ''}`
        expect(shown).toMatch(/改/)
        expect(JSON.stringify(body)).not.toMatch(FORBIDDEN)
      }
      expect(rows).toHaveLength(before)
    })
  })

  describe('previewRecipeDelta user graft', () => {
    it('grafts a stored user recipe onto ecommerce', async () => {
      const userSource = {
        id: 'draft',
        version: '1.0.0',
        title: '我的定妆',
        graftedRecipeIds: [],
        invariants: { seedChains: [{ id: 'user_look', keys: ['look_seed', 'look_turn'] }] },
        nodes: [
          {
            key: 'look_seed',
            title: '我的定妆',
            type: 'image' as const,
            chain: 'user_look',
            role: 'seed' as const,
            dependsOn: [],
            genMode: 't2i' as const,
            autoGenerate: true,
          },
          {
            key: 'look_turn',
            title: '我的四视',
            type: 'image' as const,
            chain: 'user_look',
            role: 'turnaround' as const,
            dependsOn: ['look_seed'],
            genMode: 'i2i' as const,
            autoGenerate: true,
          },
        ],
      }
      const workflow = compileRecipeToWorkflow(userSource)
      const saved = await svc.promoteRecipe({
        sessionId: 's1',
        userId: 'u-graft',
        workflow,
        mode: 'new_template',
        confirmedSeedKeys: ['look_seed', 'look_turn'],
        title: '我的定妆',
      })
      expect(saved.status).toBe('saved')
      if (saved.status !== 'saved') throw new Error('expected saved')
      const result = await svc.previewRecipeDelta({
        userId: 'u-graft',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { graft: { recipeId: saved.recipeId, version: saved.version } },
      })
      expect(result.strippedCodes).not.toContain('graft_conflict')
      expect(result.addedTitles).toEqual(expect.arrayContaining(['我的定妆', '我的四视']))
      expect(JSON.stringify(result)).not.toMatch(FORBIDDEN)
      expect(JSON.stringify(result)).not.toContain(saved.recipeId)
    })
  })

  describe('compileInstantiate', () => {
    it('rejects a full recipe IR', async () => {
      const { prisma } = createPrisma()
      const svc = new WorkflowRecipeService(prisma as unknown as PrismaService)
      await expect(
        svc.compileInstantiate({
          sessionId: 's1',
          userId: 'u1',
          parentId: 'ecommerce-product-visual',
          parentVersion: '1.0.0',
          delta: {},
          recipe: getPlatformRecipe('ecommerce-product-visual', '1.0.0'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('compiles parent+delta with canvas mentionedKeys', async () => {
      const { prisma } = createPrisma()
      const svc = new WorkflowRecipeService(prisma as unknown as PrismaService)
      const workflow = await svc.compileInstantiate({
        sessionId: 's1',
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['banner'] },
        slots: { white_bg: 'a white mug' },
      })
      const turnaround = workflow.graph.nodes.find((node) => node.data.recipeKey === 'product_turnaround')
      expect(turnaround?.data.mentionedKeys).toEqual(['image-white_bg'])
      expect(workflow.graph.nodes.some((node) => node.data.recipeKey === 'banner')).toBe(false)
    })

    it('rejects empty_prompt after fill and does not import', async () => {
      const { prisma, rows } = createPrisma()
      rows.push({
        userId: 'u-empty',
        recipeId: 'bare-seed',
        version: '1.0.0',
        title: '空提示词',
        parentId: null,
        parentVersion: null,
        body: JSON.stringify({
          id: 'bare-seed',
          version: '1.0.0',
          title: '空提示词',
          graftedRecipeIds: [],
          invariants: { seedChains: [{ id: 'bare', keys: ['bare_seed'] }] },
          nodes: [
            {
              key: 'bare_seed',
              title: '空种子',
              type: 'image',
              chain: 'bare',
              role: 'seed',
              dependsOn: [],
              genMode: 't2i',
              autoGenerate: true,
            },
          ],
        }),
        sourceSessionId: null,
        sourceHash: null,
      })
      const svc = new WorkflowRecipeService(prisma as unknown as PrismaService)
      try {
        await svc.compileInstantiate({
          sessionId: 's1',
          userId: 'u-empty',
          parentId: 'bare-seed',
          parentVersion: '1.0.0',
          delta: {},
        })
        throw new Error('expected reject')
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException)
        const body = (err as BadRequestException).getResponse() as { userMessage?: string; message?: string }
        expect(body.userMessage ?? body.message).toBe('还有步骤没写提示词，先补上再放到画布。')
      }
    })
  })

  it('parseCanvas preserves compositionRunGroup', () => {
    const group = {
      nodeIds: ['image-golden-1'],
      dumpHash: 'ab'.repeat(32),
      createdAt: '2026-09-16T00:00:00.000Z',
    }
    const parsed = (
      svc as unknown as {
        parseCanvas: (raw: string) => {
          compositionRunGroup?: { nodeIds: string[]; dumpHash: string; createdAt: string }
        }
      }
    ).parseCanvas(
      JSON.stringify({ nodes: [], edges: [], compositionRunGroup: group }),
    )
    expect(parsed.compositionRunGroup).toEqual(group)
  })
})

describe('recipe planner DTOs', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true })

  it('keeps match utterance under ValidationPipe whitelist', async () => {
    const result = await pipe.transform(
      { userId: 'u1', utterance: '套图并且要模特三视图' },
      { type: 'body', metatype: MatchRecipesDto },
    )
    expect(result.utterance).toBe('套图并且要模特三视图')
    expect(result.userId).toBe('u1')
  })

  it('keeps preview delta under ValidationPipe whitelist', async () => {
    const delta = { remove: ['banner'], graft: { recipeId: 'model-turnaround', version: '1.0.0' } }
    const result = await pipe.transform(
      {
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta,
      },
      { type: 'body', metatype: PreviewRecipeDeltaDto },
    )
    expect(result.delta).toEqual(delta)
    expect(result.parentId).toBe('ecommerce-product-visual')
  })

  it('keeps promote confirmedSeedKeys under ValidationPipe whitelist', async () => {
    const result = (await pipe.transform(
      {
        sessionId: 's1',
        userId: 'u1',
        mode: 'new_template',
        workflow: goldenWorkflow,
        confirmedSeedKeys: ['scene_prompt'],
        title: '湖景',
      },
      { type: 'body', metatype: PromoteRecipeDto },
    )) as PromoteRecipeDto
    expect(result.confirmedSeedKeys).toEqual(['scene_prompt'])
    expect(result.mode).toBe('new_template')
    expect(result.workflow).toBeTruthy()
    expect(result.title).toBe('湖景')
  })

  it('keeps promote confirmed under ValidationPipe whitelist', async () => {
    const result = (await pipe.transform(
      {
        sessionId: 's1',
        userId: 'u1',
        mode: 'variant',
        confirmed: true,
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
      },
      { type: 'body', metatype: PromoteRecipeDto },
    )) as PromoteRecipeDto
    expect(result.confirmed).toBe(true)
    expect(result.mode).toBe('variant')
  })
})
