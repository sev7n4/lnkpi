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
const UNCONFIRMED_SEED = '还没确认核心步骤，没法存成一套新模板。'

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

function createPrisma() {
  const rows: UserRecipeRow[] = []
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
  }
  return { rows, prisma: prisma as unknown as PrismaService }
}

describe('WorkflowRecipeService', () => {
  const { rows, prisma } = createPrisma()
  const svc = new WorkflowRecipeService(prisma)

  describe('matchRecipes', () => {
    it('returns ecommerce parent with graftHint for 套图+三视图', async () => {
      const result = await svc.matchRecipes({
        userId: 'u1',
        utterance: '套图并且要模特三视图',
      })
      expect(result.items[0]?.id).toBe('ecommerce-product-visual')
      expect(result.items.some((item) => item.id === 'model-turnaround')).toBe(true)
      expect(result.items.length).toBeLessThanOrEqual(3)
      expect(result.graftHint).toEqual({ recipeId: 'model-turnaround', version: '1.0.0' })
      expect(result.needsClarify).not.toBe(true)
    })

    it('returns two platform summaries with needsClarify when nothing matches', async () => {
      const result = await svc.matchRecipes({ userId: 'u1', utterance: '今天天气怎么样' })
      expect(result.needsClarify).toBe(true)
      expect(result.items).toHaveLength(2)
      expect(result.items.map((item) => item.id).sort()).toEqual([
        'ecommerce-product-visual',
        'model-turnaround',
      ])
      expect(result.graftHint).toBeUndefined()
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
      expect(result.recipe.nodes.some((node) => node.key === 'banner')).toBe(false)
      expect(result.stripped).toEqual([])
    })

    it('maps seed_frozen to userMessages when removing white_bg', async () => {
      const result = await svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { remove: ['white_bg'] },
      })
      expect(result.stripped.some((item) => item.code === 'seed_frozen')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'white_bg')).toBe(true)
      expect(result.userMessages.some((msg) => msg.includes('主图仍需跟着四视图'))).toBe(true)
      expect([...result.userMessages, ...result.diffLines].join('\n')).not.toMatch(FORBIDDEN)
    })

    it('grafts model seed chain without lifestyle nodes', async () => {
      const result = await svc.previewRecipeDelta({
        userId: 'u1',
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
        delta: { graft: { recipeId: 'model-turnaround', version: '1.0.0' } },
      })
      expect(result.stripped.some((item) => item.code === 'graft_conflict')).toBe(false)
      expect(result.recipe.nodes.some((node) => node.key === 'model_portrait')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'model_turnaround')).toBe(true)
      expect(result.recipe.nodes.some((node) => node.key === 'model_lifestyle')).toBe(false)
      expect([...result.userMessages, ...result.diffLines].join('\n')).not.toMatch(FORBIDDEN)
    })
  })

  describe('promoteRecipe', () => {
    it('rejects new_template without confirmed seed keys', async () => {
      try {
        await svc.promoteRecipe({
          sessionId: 's1',
          userId: 'u1',
          workflow: goldenWorkflow,
          mode: 'new_template',
          title: '湖景',
        })
        throw new Error('expected reject')
      } catch (err) {
        expect(err).toBeInstanceOf(BadRequestException)
        const body = (err as BadRequestException).getResponse() as { userMessage?: string; message?: string }
        expect(body.userMessage ?? body.message).toBe(UNCONFIRMED_SEED)
        expect(JSON.stringify(body)).not.toMatch(FORBIDDEN)
      }
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
        parentId: 'ecommerce-product-visual',
        parentVersion: '1.0.0',
      })
      const body = JSON.parse(saved.body) as { nodes: Array<{ key: string }> }
      expect(body.nodes.some((node) => node.key === 'banner')).toBe(false)
      expect(saved.parentId).toBe('ecommerce-product-visual')
      expect(saved.parentVersion).toBe('1.0.0')
    })
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
})
