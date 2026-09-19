import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import {
  COMPOSITION_BIND_MISSING,
  compositionSlotKey,
  compositionSourcesBound,
  localRefsByRefFromSidebarAttachments,
  requiredCompositionRefKeys,
} from './compositionBind'

const GOLD_ATTS = [
  { id: 'a1', mediaType: 'image', sourceKind: 'upload', label: 'I1', url: 'https://cdn.example/i1.png' },
  { id: 'a2', mediaType: 'image', sourceKind: 'upload', label: '@I2', url: 'https://cdn.example/i2.png' },
  { id: 'a3', mediaType: 'image', sourceKind: 'upload', label: '图', url: 'https://cdn.example/i3.png' },
]

it('slotKey ignores wantVideo and copy', () => {
  const a = extractCompositionPrimitives(GOLD_COMPOSE_1)
  const b = extractCompositionPrimitives(
    '@I1 作为模特，@I2 @I3 这两个是服装图，设计一套工作流并写入画布',
  )
  if (!a.ok || !b.ok) throw new Error('extract')
  expect(compositionSlotKey(a.primitives)).toBe('I1::I2,I3::0')
  expect(compositionSlotKey(b.primitives)).toBe(compositionSlotKey(a.primitives))
  expect(a.primitives.wantVideo).not.toBe(b.primitives.wantVideo)
})

it('maps by chip label not upload order', () => {
  const shuffled = [GOLD_ATTS[1], GOLD_ATTS[0], GOLD_ATTS[2]]
  const map = localRefsByRefFromSidebarAttachments(GOLD_COMPOSE_1, shuffled)
  expect(map.I1[0].url).toContain('i1.png')
  expect(map.I2[0].url).toContain('i2.png')
  expect(map.I3[0].url).toContain('i3.png') // leftover unlabeled → remaining mentioned key
})

it('bound false without urls', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const keys = requiredCompositionRefKeys(extracted.primitives)
  expect(keys).toEqual(['I1', 'I2', 'I3'])
  expect(compositionSourcesBound(keys, {})).toBe(false)
  expect(COMPOSITION_BIND_MISSING).toContain('参考图还没挂到构图上')
})
