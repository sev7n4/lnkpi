import type { EditIntent } from '../types'

/** E2 — Style transfer */
export const e2StyleTransfer: EditIntent = {
  id: 'e2_style_transfer',
  kind: 'edit_intent',
  label: '风格迁移',
  description: 'Apply the visual language of a style reference while preserving source content.',
  groupId: 'ref_compose',
  groupLabel: '参考合成',
  fundamentalsRefs: ['separate_changes', 'assign_ref_roles', 'iterate'],
  changePreserveTemplate: `Restyle the content of image 1 using the visual style of image 2.
Transfer palette, medium, texture, lighting treatment, and mark-making from the style reference.
Preserve the subject identity, pose, composition, proportions, objects, and scene structure from image 1.
Do not copy people, objects, text, or composition from image 2.
Change only the visual style; add no text, logos, or watermarks.`,
  refRoles: [
    { role: 'content', required: true, hint: '图1：保留内容与构图的原图' },
    { role: 'style', required: true, hint: '图2：仅提供视觉风格' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
