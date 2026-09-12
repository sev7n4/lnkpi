import type { GenerationScene } from '../types'

/** G2 — Process infographic */
export const g2ProcessInfographic: GenerationScene = {
  id: 'g2_process_infographic',
  kind: 'generation_scene',
  label: '流程信息图',
  description: 'Turn a sequence into a clear, ordered infographic with concise labels.',
  groupId: 'info_design',
  groupLabel: '信息设计',
  fundamentalsRefs: ['define_result', 'maintainable_format', 'exact_text'],
  promptScaffold: `创作一张清晰的流程信息图，说明 {{PROCESS}}。
按阅读顺序展示步骤，带编号阶段与简短标签。
图标、间距、连接线风格统一，配色克制。
所给文案须精确呈现，层级易读。
不要添加未给出的步骤、装饰性废话、logo 或水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
