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
  promptScaffold: `用所给数据创作一张关于 {{TOPIC}} 的演示幻灯片。
选择忠实呈现数值的图表类型，并清楚标注单位、类别与图例。
突出一条核心结论，辅以简短说明，视觉层级专业。
标题、标签与数值须按提供内容精确呈现。
不要编造数据、扭曲坐标轴，不要加无关文案、logo 或水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
