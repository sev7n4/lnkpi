import type { CompositionIR } from './compositionIr'

export const MAX_GARMENTS = 4

const STRUCTURE_PLAN = /设计|规划|编排|做一段|做一套|做一个|搭一套/
const STRUCTURE_PIPELINE = /工作流|流水线/
const STRUCTURE_WIRE = /连线|连好线/
const STRUCTURE_LAND = /写入画布|落到画布|写到画布/

export function isCompositionStructureUtterance(text: string): boolean {
  if (STRUCTURE_PLAN.test(text) && STRUCTURE_PIPELINE.test(text)) return true
  if (STRUCTURE_WIRE.test(text) && STRUCTURE_LAND.test(text)) return true
  return false
}

type ExtractOk = { ok: true; primitives: CompositionIR['primitives'] }
type ExtractFail = { ok: false; code: 'extract_incomplete' }

export function extractCompositionPrimitives(
  utterance: string,
): ExtractOk | ExtractFail {
  const allRefs = collectIRefs(utterance)
  const identityRef = findIdentityRef(utterance)
  const otherRefs = findOtherRefs(utterance, identityRef)
  const otherRefIds = new Set(otherRefs.map((r) => r.ref))
  const garmentRefs = findGarmentRefs(utterance, identityRef, otherRefIds, allRefs)
  const wantVideo = detectWantVideo(utterance)
  const skipI0 =
    utterance.includes('白底三视图') ||
    utterance.includes('白底四视图') ||
    utterance.includes('已经是清晰白底')
  const sequence: CompositionIR['primitives']['sequence'] = /先出一张白底.*再出一张场景/.test(
    utterance,
  )
    ? ['white_bg', 'scene']
    : []

  const tryOnContext = /作为模特|换装|服装图/.test(utterance)
  if (garmentRefs.length > MAX_GARMENTS) {
    return { ok: false, code: 'extract_incomplete' }
  }
  if (tryOnContext && (!identityRef || garmentRefs.length === 0)) {
    return { ok: false, code: 'extract_incomplete' }
  }

  const primitives: CompositionIR['primitives'] = {
    skipI0,
    garmentRefs,
    otherRefs,
    wantVideo,
    sequence,
  }
  if (identityRef) primitives.identityRef = identityRef
  return { ok: true, primitives }
}

function collectIRefs(text: string): string[] {
  const fromAt = [...text.matchAll(/@I([0-9]+)/g)].map((m) => `I${m[1]}`)
  const fromBare = [...text.matchAll(/(?<![\w@])I([0-9]+)\b/g)].map((m) => `I${m[1]}`)
  return unique([...fromAt, ...fromBare])
}

function findIdentityRef(text: string): string | undefined {
  const asModel = text.match(/@?I([0-9]+)\s*(?:作为模特|是模特|模特)/)
  if (asModel) return `I${asModel[1]}`
  const asProduct = text.match(/@?I([0-9]+)\s*是产品/)
  if (asProduct) return `I${asProduct[1]}`
  const afterAssign = text.match(/(?:模特|产品)[^@]{0,24}@I([0-9]+)/)
  if (afterAssign) return `I${afterAssign[1]}`
  return undefined
}

function findOtherRefs(
  text: string,
  identityRef: string | undefined,
): CompositionIR['primitives']['otherRefs'] {
  const refs: CompositionIR['primitives']['otherRefs'] = []
  const seen = new Set<string>()
  if (identityRef) seen.add(identityRef)

  for (const m of text.matchAll(/@?I([0-9]+)\s*是使用场景/g)) {
    const ref = `I${m[1]}`
    if (seen.has(ref)) continue
    seen.add(ref)
    refs.push({ ref, role: 'scene' })
  }
  for (const m of text.matchAll(/@?I([0-9]+)\s*是产品/g)) {
    const ref = `I${m[1]}`
    if (seen.has(ref)) continue
    seen.add(ref)
    refs.push({ ref, role: 'product' })
  }
  return refs
}

function findGarmentRefs(
  text: string,
  identityRef: string | undefined,
  otherRefIds: Set<string>,
  allRefs: string[],
): string[] {
  const exclude = new Set<string>(otherRefIds)
  if (identityRef) exclude.add(identityRef)

  const fromCluster: string[] = []
  for (const m of text.matchAll(/((?:@?I[0-9]+\s*)+)(?:这两个|这些)?是?服装/g)) {
    fromCluster.push(...collectIRefs(m[1]))
  }
  const clustered = unique(fromCluster.filter((ref) => !exclude.has(ref)))
  if (clustered.length > 0) return clustered

  if (/换装|试衣|作为模特/.test(text)) {
    return unique(allRefs.filter((ref) => !exclude.has(ref)))
  }

  const afterIdx = text.search(/服装图|服装/)
  if (afterIdx >= 0) {
    return unique(collectIRefs(text.slice(afterIdx)).filter((ref) => !exclude.has(ref)))
  }
  return []
}

function detectWantVideo(text: string): boolean {
  if (text.includes('生图生视频') || text.includes('成片')) return true
  if (text.includes('视频') && text.includes('工作流')) return true
  return false
}

function unique(refs: string[]): string[] {
  return [...new Set(refs)]
}
