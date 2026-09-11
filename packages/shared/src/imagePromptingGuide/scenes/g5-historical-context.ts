import type { GenerationScene } from '../types'

/** G5 — Historical context */
export const g5HistoricalContext: GenerationScene = {
  id: 'g5_historical_context',
  kind: 'generation_scene',
  label: '历史语境',
  description: 'Reconstruct a historically grounded scene with period-appropriate visual details.',
  groupId: 'narrative',
  groupLabel: '叙事',
  fundamentalsRefs: ['define_result', 'visible_details', 'people_actions'],
  promptScaffold: `Create a historically grounded scene set in {{TIME_AND_PLACE}}.
Depict {{SUBJECT_AND_ACTION}} with period-appropriate clothing, architecture, objects, and materials.
Use a coherent composition and lighting appropriate to the setting and intended medium.
Avoid modern objects, anachronistic styling, unsupported symbols, text, logos, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
