import type { PromptModeDefinition, PromptModeId } from './types'
import { imagePromptMultiStyleMode } from './modes/image-prompt-multi-style'
import { characterTurnaroundMode } from './modes/character-turnaround'
import { storyboardMode } from './modes/storyboard'
import { scriptMode } from './modes/script'
import { copywritingMode } from './modes/copywriting'
import { genericMode } from './modes/generic'

export const PROMPT_MODES: Record<PromptModeId, PromptModeDefinition> = {
  image_prompt_multi_style: imagePromptMultiStyleMode,
  character_turnaround: characterTurnaroundMode,
  storyboard: storyboardMode,
  script: scriptMode,
  copywriting: copywritingMode,
  generic: genericMode,
}

export function getPromptMode(id: PromptModeId): PromptModeDefinition {
  return PROMPT_MODES[id]
}

export const PROMPT_MODE_IDS = Object.keys(PROMPT_MODES) as PromptModeId[]
