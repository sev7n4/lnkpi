import type { EditIntent } from '../types'

/** E6 — Drawing to realistic */
export const e6DrawingToRealistic: EditIntent = {
  id: 'e6_drawing_to_realistic',
  kind: 'edit_intent',
  label: '草图转写实',
  description: 'Convert a drawing into a realistic image while preserving its structure and intent.',
  groupId: 'ref_compose',
  groupLabel: '参考合成',
  fundamentalsRefs: ['visible_details', 'separate_changes', 'assign_ref_roles'],
  changePreserveTemplate: `Convert the input drawing into a photorealistic image.
Preserve the exact composition, subject placement, pose, perspective, silhouette, and key design features.
Resolve sketched areas into plausible materials, textures, lighting, and shadows.
Keep intentional colors and details unless the drawing leaves them unspecified.
Do not redesign the subject, alter the framing, add objects, text, logos, or watermarks.`,
  refRoles: [{ role: 'drawing', required: true, hint: '要转为写实效果的草图/线稿' }],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 1 },
}
