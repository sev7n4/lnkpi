import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { GOLD_COMPOSE_1, GOLD_COMPOSE_2 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import { expandComposition, renderCompositionCopy } from './compositionExpand'
import {
  hashCompositionDump,
  lintCompositionDump,
  summarizeCompositionDump,
} from './compositionLint'
import type { WorkflowDocument } from './workflowExchange'

const COMPILE_FAILED = {
  ok: false,
  code: 'compile_failed',
  message: '这版构图还不能放到画布，请稍后再试或简化步骤。',
} as const

function goldDump(utterance: string) {
  const extracted = extractCompositionPrimitives(utterance)
  if (!extracted.ok) throw new Error('extract')
  return expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
}

it('lints gold dump and hashes stably', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  expect(lintCompositionDump(dump)).toEqual({ ok: true })
  const h = hashCompositionDump(dump)
  expect(h).toBe(createHash('sha256').update(JSON.stringify(dump)).digest('hex'))
  expect(h).toBe(hashCompositionDump(dump))
  const summary = summarizeCompositionDump(dump, { existingNodeCount: 2 })
  expect(summary).toContain('请确认是否把构图落到画布')
  expect(summary).toContain('新建白底三视图')
  expect(summary).toContain('服装扇出')
  expect(summary).toContain('P+V')
  expect(summary).toContain('选中构图里要生成的节点，用 Dock 生成，会按运行组排队')
  expect(summary).not.toContain('Dock 生成工作流')
  expect(summary).toContain('保留 2')
  expect(summary).toContain('新增')
})

it('rejects dataURL in dump', () => {
  const extracted = extractCompositionPrimitives(GOLD_COMPOSE_1)
  if (!extracted.ok) throw new Error('extract')
  const dump = expandComposition(
    renderCompositionCopy({ version: '1', primitives: extracted.primitives, copy: {} }),
  )
  dump.graph.nodes[0].data.prompt = 'data:image/png;base64,aaaa'
  expect(lintCompositionDump(dump)).toEqual(COMPILE_FAILED)
})

it('summarizes skipI0 looks as 沿用 I1 作为 I0', () => {
  const dump = goldDump(GOLD_COMPOSE_1.replace('作为模特', '作为模特，已经是清晰白底三视图'))
  const summary = summarizeCompositionDump(dump, { existingNodeCount: 0 })
  expect(summary).toContain('请确认是否把构图落到画布')
  expect(summary).toContain('沿用 I1 作为 I0')
  expect(summary).not.toContain('新建白底三视图')
  expect(summary).toContain('服装扇出')
  expect(summary).toContain('P+V')
  expect(summary).toContain('选中构图里要生成的节点，用 Dock 生成，会按运行组排队')
  expect(summary).not.toContain('Dock 生成工作流')
  expect(summary).toContain('保留 0')
  expect(summary).toContain('新增')
})

it('summarizes gold 2 without garment fan-out or P+V, still points to Dock', () => {
  const dump = goldDump(GOLD_COMPOSE_2)
  const summary = summarizeCompositionDump(dump, { existingNodeCount: 3 })
  expect(summary).toContain('请确认是否把构图落到画布')
  expect(summary).not.toContain('服装扇出')
  expect(summary).not.toContain('P+V')
  expect(summary).toContain('选中构图里要生成的节点，用 Dock 生成，会按运行组排队')
  expect(summary).not.toContain('Dock 生成工作流')
  expect(summary).toContain('保留 3')
  expect(summary).toContain('新增')
})

it('wraps validateWorkflow throw as compile_failed', () => {
  expect(lintCompositionDump({ format: 'wrong' } as unknown as WorkflowDocument)).toEqual(
    COMPILE_FAILED,
  )
})
