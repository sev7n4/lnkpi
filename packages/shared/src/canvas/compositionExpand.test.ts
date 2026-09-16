import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1 } from './compositionGold'
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
