import type { CompositionIR } from './compositionIr'

/** Compiler-constant I0 clauses: 白底 + 三视图 + 锁脸 + 禁止换装. Must not mention 时尚大片. */
export const I0_SKELETON_PROMPT =
  '清晰白底三视图（正面、侧面、背面），锁脸锁体，保持同一模特身份，禁止换装。'

export const LOOK_SKELETON_PROMPT =
  '在身份锚点上换上对应服装，锁脸锁体，保持体型与发型，输出商业造型图。'

/** P clauses: 同一人 + N 套造型顺序 + lookbook（非剧情片）. */
export const P_SKELETON_PROMPT =
  '同一人按两套造型顺序切换的 lookbook，非剧情片。'

const CN_COUNTS = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']

function cnCount(n: number): string {
  return n >= 0 && n <= 10 ? CN_COUNTS[n]! : String(n)
}

/**
 * P 骨架按造型套数渲染（land-production-gaps P1：禁止 4 套时仍写「两套」）。
 * lookCount 缺省时回退到金标双套常量（非换装链路沿用旧文案）。
 */
export function pSkeletonPrompt(lookCount?: number): string {
  return lookCount == null
    ? P_SKELETON_PROMPT
    : `同一人按${cnCount(lookCount)}套造型顺序切换的 lookbook，非剧情片。`
}

/** Product white-bg: 产品白底, not 模特三视图 / 锁脸 / 禁止换装. */
export const WHITE_SKELETON_PROMPT =
  '将产品置于干净白底，保持产品外观、比例与材质，输出产品白底图。'

export const SCENE_SKELETON_PROMPT =
  '将产品放入使用场景中合理摆放，保持产品外观，输出场景图。'

const I0_CLAUSES = [/白底/, /三视图|多视图/, /锁脸/, /禁止换装/]
const P_CLAUSES = [/同一人/, /套造型|造型顺序/, /lookbook/]
const WHITE_CLAUSES = [/产品/, /白底/]
const SCENE_CLAUSES = [/场景/]

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function pickPrompt(provided: string | undefined, skeleton: string, clauses: RegExp[]): string {
  if (filled(provided) && clauses.every((re) => re.test(provided))) return provided
  return skeleton
}

function pickTitle(provided: string | undefined, fallback: string): string {
  return filled(provided) ? provided : fallback
}

/**
 * Fill skeleton titles/prompts. Empty or clause-missing copy is ignored
 * (骨架渲染), matching “ignore empty copy”.
 */
export function renderCompositionCopy(ir: CompositionIR): CompositionIR {
  const titles: Record<string, string> = { ...(ir.copy?.titles ?? {}) }
  const promptSlots: Record<string, string> = { ...(ir.copy?.promptSlots ?? {}) }
  const pSlots: Record<string, string> = { ...(ir.copy?.pSlots ?? {}) }

  const { identityRef, skipI0, garmentRefs, wantVideo, sequence, otherRefs } = ir.primitives
  const tryOn = Boolean(identityRef) && garmentRefs.length > 0
  const productSequence = sequence.includes('white_bg')

  if (identityRef) {
    const key = `src-${identityRef}`
    titles[key] = pickTitle(titles[key], productSequence ? '产品源图' : '模特源图')
  }
  for (const ref of garmentRefs) {
    const key = `src-${ref}`
    titles[key] = pickTitle(titles[key], '服装图')
  }
  for (const other of otherRefs) {
    const key = `src-${other.ref}`
    const fallback =
      other.role === 'scene' ? '场景图' : other.role === 'product' ? '产品源图' : '参考图'
    titles[key] = pickTitle(titles[key], fallback)
  }

  if (productSequence) {
    promptSlots.white = pickPrompt(promptSlots.white, WHITE_SKELETON_PROMPT, WHITE_CLAUSES)
    titles.white = pickTitle(titles.white, '产品白底')
  }
  if (sequence.includes('scene')) {
    promptSlots.scene = pickPrompt(promptSlots.scene, SCENE_SKELETON_PROMPT, SCENE_CLAUSES)
    titles.scene = pickTitle(titles.scene, '场景图')
  }

  if (tryOn && !skipI0) {
    promptSlots.i0 = pickPrompt(promptSlots.i0, I0_SKELETON_PROMPT, I0_CLAUSES)
    titles.i0 = pickTitle(titles.i0, '清晰白底三视图')
  }

  if (tryOn) {
    for (let i = 0; i < garmentRefs.length; i++) {
      const key = `look-${i}`
      promptSlots[key] = pickPrompt(promptSlots[key], LOOK_SKELETON_PROMPT, [])
      titles[key] = pickTitle(titles[key], `换装造型 ${i + 1}`)
    }
  }

  if (wantVideo) {
    const providedP = filled(pSlots.p) ? pSlots.p : promptSlots.p
    pSlots.p = pickPrompt(
      providedP,
      tryOn ? pSkeletonPrompt(garmentRefs.length) : P_SKELETON_PROMPT,
      P_CLAUSES,
    )
    titles.p = pickTitle(titles.p, '换装分镜')
    titles.v = pickTitle(titles.v, '成片')
  }

  return {
    version: '1',
    primitives: ir.primitives,
    copy: { titles, promptSlots, pSlots },
  }
}
