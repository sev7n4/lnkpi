export type PromptModeId =
  | 'image_prompt_multi_style'
  | 'character_turnaround'
  | 'storyboard'
  | 'commercial_storyboard'
  | 'script'
  | 'copywriting'
  | 'generic'

export interface PromptModeDefinition {
  id: PromptModeId
  label: string
  classifyHints: string
  system: string
  fewShot: { user: string; assistant: string }
  /** When set, all pairs are injected before the final user request (overrides single fewShot). */
  fewShots?: { user: string; assistant: string }[]
  placeholder: (prompt: string) => string
}
