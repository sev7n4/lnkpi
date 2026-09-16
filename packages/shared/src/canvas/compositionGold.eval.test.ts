import { describe, expect, it } from 'vitest'
import { GOLD_COMPOSE_1, GOLD_COMPOSE_2 } from './compositionGold'
import { extractCompositionPrimitives } from './compositionExtract'
import { expandComposition, renderCompositionCopy } from './compositionExpand'
import { lintCompositionDump } from './compositionLint'
import type { CompositionIR } from './compositionIr'
import type { WorkflowDocument } from './workflowExchange'

const SKIP_I0_GOLD_1 = GOLD_COMPOSE_1.replace(
  '作为模特',
  '作为模特，已经是清晰白底三视图',
)
const I2V_UTTERANCE = '做一个图生视频工作流'
const I2V_RECIPE = 'image-to-video'

function extractOrThrow(utterance: string): CompositionIR['primitives'] {
  const extracted = extractCompositionPrimitives(utterance)
  expect(extracted.ok).toBe(true)
  if (!extracted.ok) throw new Error(`extract failed for: ${utterance}`)
  return extracted.primitives
}

function compileDump(utterance: string): WorkflowDocument {
  return expandComposition(
    renderCompositionCopy({
      version: '1',
      primitives: extractOrThrow(utterance),
      copy: {},
    }),
  )
}

function assertNoLiveModels(dump: WorkflowDocument): void {
  for (const node of dump.graph.nodes) {
    expect(node.data.modelId, `${node.id}.modelId`).toBeUndefined()
    expect(node.data.model, `${node.id}.model`).toBeUndefined()
    expect(node.data.gatewayModelHint, `${node.id}.gatewayModelHint`).toBeUndefined()
    expect(node.data.autoGenerate, `${node.id}.autoGenerate`).not.toBe(true)
  }
}

describe('composition gold eval', () => {
  it('gold 1 extract → renderCopy → expand → lint, no live models', () => {
    const dump = compileDump(GOLD_COMPOSE_1)
    expect(lintCompositionDump(dump)).toEqual({ ok: true })
    assertNoLiveModels(dump)
  })

  it('gold 2 extract → renderCopy → expand → lint, no live models', () => {
    const dump = compileDump(GOLD_COMPOSE_2)
    expect(lintCompositionDump(dump)).toEqual({ ok: true })
    assertNoLiveModels(dump)
  })

  it('skipI0 variant of gold 1 has no image-i0', () => {
    const dump = compileDump(SKIP_I0_GOLD_1)
    expect(dump.graph.nodes.map((node) => node.id)).not.toContain('image-i0')
  })

  it('做一个图生视频工作流 expands with a video node and no image-to-video recipe id', () => {
    const primitives = extractOrThrow(I2V_UTTERANCE)
    let dump: WorkflowDocument | undefined
    expect(() => {
      dump = expandComposition(
        renderCompositionCopy({ version: '1', primitives, copy: {} }),
      )
    }).not.toThrow()
    expect(dump).toBeDefined()
    expect(dump!.graph.nodes.some((node) => node.type === 'video')).toBe(true)
    for (const node of dump!.graph.nodes) {
      expect(node.data.recipeId).not.toBe(I2V_RECIPE)
      expect(node.data.parentRecipeId).not.toBe(I2V_RECIPE)
    }
  })
})
