import type { GenerationScene } from '../types'

/** G8 — Scientific visual */
export const g8ScientificVisual: GenerationScene = {
  id: 'g8_scientific_visual',
  kind: 'generation_scene',
  label: '科学教育图',
  description: 'Explain a scientific concept with accurate structure and readable annotations.',
  groupId: 'info_design',
  groupLabel: '信息设计',
  fundamentalsRefs: ['define_result', 'visible_details', 'exact_text'],
  promptScaffold: `Create an educational scientific visual explaining {{CONCEPT}} for {{AUDIENCE}}.
Show the relevant structures, relationships, scale cues, and process accurately.
Use a clean composition, restrained colors, and clear callouts.
Render supplied labels exactly and keep annotation lines unambiguous.
Do not invent unsupported anatomy, data, labels, logos, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
