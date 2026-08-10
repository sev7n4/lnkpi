/** @vitest-environment node */

import type { AgentChipSet } from './agentChipSet'

export interface AgentInterruptPayload {
  node?: string | null
  phase?: string | null
  interrupted?: boolean
}

const GATE_TO_CHIP: Record<string, AgentChipSet> = {
  await_confirm: 'plan',
  await_copy_confirm: 'copy',
  await_topo: 'topo',
  await_atomic_confirm: 'atomic',
  await_image_qa: 'image_qa',
}

export const IMAGE_QA_OPTIONS = [
  { id: 'retake', label: '重新拍摄', message: '我重新拍摄上传' },
  { id: 'ai_white_bg', label: '生成白底图', message: '生成标准白底图' },
] as const

export type ImageQaOptionId = (typeof IMAGE_QA_OPTIONS)[number]['id']

/** Map Runtime SSE ``interrupt`` / thread-state to confirm chip row. */
export function chipSetFromInterrupt(
  payload: AgentInterruptPayload | null | undefined,
): AgentChipSet {
  if (!payload) return null
  const phase = payload.phase?.trim()
  if (phase && GATE_TO_CHIP[phase]) return GATE_TO_CHIP[phase]
  const node = payload.node?.trim()
  if (node && GATE_TO_CHIP[node]) return GATE_TO_CHIP[node]
  if (payload.interrupted) {
    // Fallback when phase/node missing but graph is paused
    return null
  }
  return null
}

export function interruptPayloadFromThreadState(
  data:
    | {
        phase?: string | null
        interrupted?: boolean
        nextNodes?: string[]
      }
    | null
    | undefined,
): AgentInterruptPayload | null {
  if (!data?.interrupted) return null
  return {
    interrupted: true,
    phase: data.phase ?? null,
    node: data.nextNodes?.[0] ?? null,
  }
}
