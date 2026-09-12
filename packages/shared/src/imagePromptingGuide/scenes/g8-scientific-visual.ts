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
  promptScaffold: `创作一张面向 {{AUDIENCE}} 的科学教育图，讲解 {{CONCEPT}}。
准确呈现相关结构、关系、比例线索与过程。
构图干净、配色克制、标注清楚。
所给标签须精确呈现，指示线指向明确、不歧义。
不要杜撰结构、数据、标签，以及 logo 或水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
