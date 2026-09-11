import type { EditIntent } from '../types'

/** E8 — Insert person */
export const e8InsertPerson: EditIntent = {
  id: 'e8_insert_person',
  kind: 'edit_intent',
  label: '人物入景',
  description: 'Insert a referenced person into a scene while preserving identity and scene continuity.',
  groupId: 'identity_product',
  groupLabel: '身份/产品',
  fundamentalsRefs: ['people_actions', 'separate_changes', 'assign_ref_roles'],
  changePreserveTemplate: `Insert the person from image 2 naturally into the scene in image 1 at {{PLACEMENT}}.
Preserve the person's exact identity, facial features, hairstyle, body proportions, and clothing.
Match the scene's perspective, scale, lighting, color, focus, contact shadows, and occlusion.
Preserve the existing background, people, objects, camera angle, and framing.
Do not alter the person's identity or add text, logos, or watermarks.`,
  refRoles: [
    { role: 'scene', required: true, hint: '图1：目标场景' },
    { role: 'subject', required: true, hint: '图2：要放入场景的人物' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2, requiresSubjectRef: true },
}
