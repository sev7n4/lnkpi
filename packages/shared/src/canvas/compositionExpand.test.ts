import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1, GOLD_COMPOSE_2 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import { expandComposition, renderCompositionCopy } from './compositionExpand'
import { compositionIrSchema } from './compositionIr'

it('gold 1 expands I1,I0,I2,I3,A,B,P,V with draft status and no recipe parentId', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const ir = compositionIrSchema.parse({
    version: '1',
    primitives: extracted.primitives,
    copy: {},
  })
  const dump = expandComposition(renderCompositionCopy(ir))
  const ids = dump.graph.nodes.map((n) => n.id)
  expect(ids).toEqual([
    'image-src-I1',
    'image-i0',
    'image-src-I2',
    'image-src-I3',
    'image-look-0',
    'image-look-1',
    'text-p',
    'video-v',
  ])
  for (const n of dump.graph.nodes) {
    expect(n.data.status).toBe('draft')
    expect(n.data.parentRecipeId).toBeUndefined()
  }
  const i0 = dump.graph.nodes.find((n) => n.id === 'image-i0')!
  expect(i0.data.mentionedKeys).toEqual(['image-src-I1'])
  expect(String(i0.data.prompt)).toContain('白底')
  expect(String(i0.data.prompt)).not.toMatch(/时尚大片/)
  const look0 = dump.graph.nodes.find((n) => n.id === 'image-look-0')!
  expect(look0.data.mentionedKeys).toEqual(['image-i0', 'image-src-I2'])
  const v = dump.graph.nodes.find((n) => n.id === 'video-v')!
  expect(v.data.mentionedKeys).toEqual(['image-i0', 'image-look-0', 'image-look-1'])
  expect(dump.graph.nodes.find((n) => n.id === 'text-p')!.data.prompt).toMatch(/lookbook|造型|同一/)
  const src = dump.graph.nodes.find((n) => n.id === 'image-src-I1')!
  expect(src.data.genMode).toBeUndefined()
})

it('skipI0 omits image-i0 and hangs looks on I1', () => {
  const extracted = extractCompositionPrimitives(
    GOLD_COMPOSE_1.replace('作为模特', '作为模特，已经是清晰白底三视图'),
  )
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  expect(dump.graph.nodes.map((n) => n.id)).not.toContain('image-i0')
  const look0 = dump.graph.nodes.find((n) => n.id === 'image-look-0')!
  expect(look0.data.mentionedKeys).toEqual(['image-src-I1', 'image-src-I2'])
})

it('gold 2 expands product white then scene, no P/V/i0 turnaround', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_2)
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) return
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  const types = dump.graph.nodes.map((n) => n.type)
  expect(types.filter((t) => t === 'image')).toHaveLength(4)
  const ids = dump.graph.nodes.map((n) => n.id)
  expect(ids).toEqual(
    expect.arrayContaining(['image-src-I1', 'image-src-I2', 'image-white', 'image-scene']),
  )
  expect(dump.graph.nodes.some((n) => n.type === 'video')).toBe(false)
  expect(dump.graph.nodes.some((n) => n.id === 'text-p')).toBe(false)
  expect(dump.graph.nodes.some((n) => n.id === 'image-i0')).toBe(false)

  const srcI1 = dump.graph.nodes.find((n) => n.id === 'image-src-I1')!
  expect(srcI1.data.title).toBe('产品源图')
  expect(srcI1.data.genMode).toBeUndefined()
  const srcI2 = dump.graph.nodes.find((n) => n.id === 'image-src-I2')!
  expect(srcI2.data.title).toBe('场景图')
  expect(srcI2.data.genMode).toBeUndefined()

  const white = dump.graph.nodes.find((n) => n.id === 'image-white')!
  expect(white.data.mentionedKeys).toEqual(['image-src-I1'])
  expect(white.data.genMode).toBe('i2i')
  expect(white.data.status).toBe('draft')
  expect(white.data.parentRecipeId).toBeUndefined()
  expect(String(white.data.prompt)).toMatch(/产品/)
  expect(String(white.data.prompt)).toMatch(/白底/)
  expect(String(white.data.prompt)).not.toMatch(/锁脸|禁止换装|三视图/)
  expect(white.data.title).toBe('产品白底')

  const scene = dump.graph.nodes.find((n) => n.id === 'image-scene')!
  expect(scene.data.mentionedKeys).toEqual(['image-white', 'image-src-I2'])
  expect(scene.data.genMode).toBe('i2i')
  expect(scene.data.status).toBe('draft')
  expect(scene.data.parentRecipeId).toBeUndefined()
  expect(String(scene.data.prompt).trim().length).toBeGreaterThan(0)
  expect(String(scene.data.prompt)).toMatch(/场景/)
  expect(scene.data.title).toBe('场景图')

  expect(dump.graph.edges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ source: 'image-src-I1', target: 'image-white' }),
      expect.objectContaining({ source: 'image-white', target: 'image-scene' }),
      expect.objectContaining({ source: 'image-src-I2', target: 'image-scene' }),
    ]),
  )
})

// 2026-09-24 land-production-gaps P1：P 骨架不得写死「两套」，须随 garmentRefs.length 渲染
function irWithLooks(n: number, copy: Record<string, unknown> = {}) {
  return compositionIrSchema.parse({
    version: '1',
    primitives: {
      identityRef: 'I1',
      garmentRefs: Array.from({ length: n }, (_, i) => `I${i + 2}`),
      otherRefs: [],
      wantVideo: true,
      sequence: [],
    },
    copy,
  })
}

it('P skeleton counts garment sets dynamically: 4 looks → 四套, never 两套', () => {
  const dump = expandComposition(renderCompositionCopy(irWithLooks(4)))
  const p = dump.graph.nodes.find((n) => n.id === 'text-p')!
  expect(String(p.data.prompt)).toContain('四套造型')
  expect(String(p.data.prompt)).not.toContain('两套')
  expect(String(p.data.prompt)).toMatch(/lookbook/)
  expect(dump.graph.nodes.filter((n) => n.id.startsWith('image-look-'))).toHaveLength(4)
})

it('P skeleton keeps 两套 wording for the canonical 2-look template', () => {
  const dump = expandComposition(renderCompositionCopy(irWithLooks(2)))
  const p = dump.graph.nodes.find((n) => n.id === 'text-p')!
  expect(String(p.data.prompt)).toContain('两套造型')
})

it('user-provided P naming a non-two count passes clause validation', () => {
  const provided = '同一人按四套造型顺序切换的 lookbook，非剧情片。'
  const dump = expandComposition(renderCompositionCopy(irWithLooks(4, { pSlots: { p: provided } })))
  const p = dump.graph.nodes.find((n) => n.id === 'text-p')!
  expect(String(p.data.prompt)).toBe(provided)
})
