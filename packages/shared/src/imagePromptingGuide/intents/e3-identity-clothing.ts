import type { EditIntent } from '../types'

/** P0 E3 — Preserve identity and change clothing */
export const e3IdentityClothing: EditIntent = {
  id: 'e3_identity_clothing',
  kind: 'edit_intent',
  label: '换装保身份',
  description: 'Change only clothing; preserve face, identity, pose, and background.',
  groupId: 'identity_product',
  groupLabel: '身份/产品',
  fundamentalsRefs: ['separate_changes', 'assign_ref_roles', 'iterate'],
  changePreserveTemplate: `Edit the image to dress the person using the provided clothing reference(s).
Change only the clothing. Do not change face, facial features, skin tone, body shape, pose, or identity.
Preserve exact likeness, expression, hairstyle, and proportions.
Fit garments naturally to the existing pose with realistic fabric behavior; match lighting and shadows.
Do not change the background, camera angle, or framing. No accessories, text, logos, or watermarks.`,
  refRoles: [
    { role: 'subject', required: true, hint: '人物原图（身份/姿态）' },
    { role: 'clothing', required: true, hint: '服装参考图' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
