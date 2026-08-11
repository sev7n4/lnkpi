/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCT_VISUAL_GUIDANCE } from './productVisualCopy'

function loadGuidanceFromYaml(): {
  macro_style_in_cards?: string
  attachment_hint?: string
  example_utterances?: Array<{ id: string; label: string; text: string }>
} {
  const path = resolve(
    import.meta.dirname,
    '../../../../services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml',
  )
  const text = readFileSync(path, 'utf8')
  const guidance: Record<string, unknown> = {}
  let inGuidance = false
  let inExamples = false
  let currentExample: { id?: string; label?: string; text?: string } | null = null
  const examples: Array<{ id: string; label: string; text: string }> = []

  for (const line of text.split('\n')) {
    if (line.startsWith('guidance:')) {
      inGuidance = true
      continue
    }
    if (!inGuidance) continue
    if (line.match(/^[a-z_]+:/) && !line.startsWith('  ')) break

    const macro = line.match(/^  macro_style_in_cards: "(.+)"$/)
    if (macro) {
      guidance.macro_style_in_cards = macro[1]
      continue
    }
    const attach = line.match(/^  attachment_hint: "(.+)"$/)
    if (attach) {
      guidance.attachment_hint = attach[1]
      continue
    }
    if (line.trim() === 'example_utterances:') {
      inExamples = true
      continue
    }
    if (!inExamples) continue

    const idMatch = line.match(/^\s+- id: (\S+)$/)
    if (idMatch) {
      if (currentExample?.id && currentExample.label && currentExample.text) {
        examples.push(currentExample as { id: string; label: string; text: string })
      }
      currentExample = { id: idMatch[1] }
      continue
    }
    const labelMatch = line.match(/^\s+label: (.+)$/)
    if (labelMatch && currentExample) {
      currentExample.label = labelMatch[1]
      continue
    }
    const textMatch = line.match(/^\s+text: "(.+)"$/)
    if (textMatch && currentExample) {
      currentExample.text = textMatch[1]
    }
  }
  if (currentExample?.id && currentExample.label && currentExample.text) {
    examples.push(currentExample as { id: string; label: string; text: string })
  }
  guidance.example_utterances = examples
  return guidance
}

describe('PRODUCT_VISUAL_GUIDANCE', () => {
  it('matches runtime copy YAML guidance.* keys', () => {
    const guidance = loadGuidanceFromYaml()
    expect(PRODUCT_VISUAL_GUIDANCE.macroStyleInCards).toBe(guidance.macro_style_in_cards)
    expect(PRODUCT_VISUAL_GUIDANCE.attachmentHint).toBe(guidance.attachment_hint)
    expect(PRODUCT_VISUAL_GUIDANCE.exampleUtterances).toEqual(guidance.example_utterances)
  })

  it('exposes three clickable example utterances', () => {
    expect(PRODUCT_VISUAL_GUIDANCE.exampleUtterances).toHaveLength(3)
    expect(PRODUCT_VISUAL_GUIDANCE.exampleUtterances.map((e) => e.label)).toEqual([
      '礼盒',
      'Listing',
      '空间',
    ])
  })
})
