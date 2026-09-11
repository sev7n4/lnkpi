import type { EditIntent } from '../types'

/** E7 — Remove object */
export const e7RemoveObject: EditIntent = {
  id: 'e7_remove_object',
  kind: 'edit_intent',
  label: '去物体',
  description: 'Remove a specified object and reconstruct the revealed background naturally.',
  groupId: 'local_edit',
  groupLabel: '局部手术',
  fundamentalsRefs: ['define_result', 'separate_changes', 'iterate'],
  changePreserveTemplate: `Remove {{OBJECT_TO_REMOVE}} from the input image.
Reconstruct the newly revealed area so it matches the surrounding background, texture, lighting, perspective, and depth.
Remove related shadows or reflections only when they belong to the removed object.
Preserve every other person, object, color, detail, camera angle, and crop exactly.
Do not add replacement objects, text, logos, or watermarks.`,
  refRoles: [{ role: 'source', required: true, hint: '包含待移除物体的原图' }],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 1 },
}
