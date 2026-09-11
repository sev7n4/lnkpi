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
  promptScaffold: `Create a polished interface preview for {{PRODUCT_AND_SCREEN}}.
Show a clear information hierarchy, consistent components, practical spacing, and accessible contrast.
Use realistic content and render all supplied labels exactly.
Present the interface from a straightforward viewing angle without obscuring important controls.
Do not add illegible filler text, unrelated branding, or watermarks.`,
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: {},
}
