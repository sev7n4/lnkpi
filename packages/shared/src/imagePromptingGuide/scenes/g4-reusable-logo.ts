import type { GenerationScene } from '../types'

/** G4 — Reusable logo */
export const g4ReusableLogo: GenerationScene = {
  id: 'g4_reusable_logo',
  kind: 'generation_scene',
  label: '可复用 Logo',
  description: 'Create a simple, reusable logo mark with a clean transparent background.',
  groupId: 'brand_ui',
  groupLabel: '品牌/UI',
  fundamentalsRefs: ['define_result', 'visible_details', 'exact_text'],
  promptScaffold: `为 {{BRAND}} 创作一个可复用、辨识度高的 logo。
造型简洁、几何平衡，小尺寸仍清晰，配色克制。
若需要字标，将「{{LOGOTYPE}}」精确呈现一次并保持可读。
logo 置于完全透明背景，边缘干净利落。
不要样机、场景、投影、多余文字或水印。`,
  preferredParams: {
    size: '1024x1024',
    quality: 'medium',
    background: 'transparent',
    outputFormat: 'png',
  },
  capability: { requiresTransparentBackground: true },
}
