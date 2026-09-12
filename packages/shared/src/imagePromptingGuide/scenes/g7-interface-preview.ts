import type { GenerationScene } from '../types'

/** G7 — Interface preview */
export const g7InterfacePreview: GenerationScene = {
  id: 'g7_interface_preview',
  kind: 'generation_scene',
  label: '界面预览',
  description: 'Visualize a polished product interface with a clear hierarchy and realistic content.',
  groupId: 'brand_ui',
  groupLabel: '品牌/UI',
  fundamentalsRefs: ['define_result', 'maintainable_format', 'exact_text'],
  promptScaffold: `为 {{PRODUCT_AND_SCREEN}} 创作一张精致的界面预览。
信息层级清楚，组件一致，间距实用，对比度可读。
内容贴近真实，所给文案标签须精确呈现。
取景正面清晰，勿遮挡关键控件。
不要难辨认的填充字、无关品牌或水印。`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
