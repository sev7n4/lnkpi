import type { GenerationScene } from '../types'

/** G9 — Slides and charts */
export const g9SlidesCharts: GenerationScene = {
  id: 'g9_slides_charts',
  kind: 'generation_scene',
  label: '幻灯片/图表',
  description: 'Present supplied data in a clear slide with an appropriate chart and concise hierarchy.',
  groupId: 'info_design',
  groupLabel: '信息设计',
  fundamentalsRefs: ['define_result', 'maintainable_format', 'exact_text'],
  promptScaffold: `Create a presentation slide about {{TOPIC}} using the supplied data.
Choose a chart form that represents the values faithfully and label units, categories, and legend clearly.
Use one strong takeaway, concise supporting copy, and a professional visual hierarchy.
Render titles, labels, and values exactly as provided.
Do not invent data, distort axes, add unrelated copy, logos, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
