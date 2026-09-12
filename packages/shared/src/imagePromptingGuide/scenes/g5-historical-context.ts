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
  promptScaffold: `创作一张有历史依据的场景，设定在 {{TIME_AND_PLACE}}。
表现 {{SUBJECT_AND_ACTION}}，服饰、建筑、器物与材质符合时代。
构图与光线贴合场景与目标媒介。
避免现代物品、时代错乱造型、无依据符号，以及多余文字、logo、水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
