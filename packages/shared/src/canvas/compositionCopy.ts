import type { CompositionIR } from './compositionIr'

/** Compiler-constant I0 clauses: 白底 + 三视图 + 锁脸 + 禁止换装. Must not mention 时尚大片. */
export const I0_SKELETON_PROMPT =
  '清晰白底三视图（正面、侧面、背面），锁脸锁体，保持同一模特身份，禁止换装。'

export const LOOK_SKELETON_PROMPT =
  '在身份锚点上换上对应服装，锁脸锁体，保持体型与发型，输出商业造型图。'

/** P clauses: 同一人 + 两套造型顺序 + lookbook（非剧情片）. */
export const P_SKELETON_PROMPT =
  '同一人按两套造型顺序切换的 lookbook，非剧情片。'

const I0_CLAUSES = [/白底/, /三视图|多视图/, /锁脸/, /禁止换装/]
const P_CLAUSES = [/同一人/, /两套造型|造型顺序/, /lookbook/]

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

  const { identityRef, skipI0, garmentRefs, wantVideo } = ir.primitives
  const tryOn = Boolean(identityRef) && garmentRefs.length > 0

  if (identityRef) {
    const key = `src-${identityRef}`
    titles[key] = pickTitle(titles[key], '模特源图')
  }
  for (const ref of garmentRefs) {
    const key = `src-${ref}`
    titles[key] = pickTitle(titles[key], '服装图')
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
    pSlots.p = pickPrompt(providedP, P_SKELETON_PROMPT, P_CLAUSES)
    titles.p = pickTitle(titles.p, '换装分镜')
    titles.v = pickTitle(titles.v, '成片')
  }

  return {
    version: '1',
    primitives: ir.primitives,
    copy: { titles, promptSlots, pSlots },
  }
}
