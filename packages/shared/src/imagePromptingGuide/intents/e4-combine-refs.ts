import type { EditIntent } from '../types'

/** P0 E4 — Combine references */
export const e4CombineRefs: EditIntent = {
  id: 'e4_combine_refs',
  kind: 'edit_intent',
  label: '多参考合成',
  description: 'Place the subject from image 2 into the scene of image 1; change nothing else.',
  groupId: 'ref_compose',
  groupLabel: '参考合成',
  changePreserveTemplate: `Place the subject from image 2 into the setting of image 1.
Use the same style of lighting, composition, and background as image 1.
Change nothing else — preserve identity of the subject and the rest of the scene.`,
  refRoles: [
    { role: 'scene', required: true, hint: '图1：场景/背景' },
    { role: 'subject', required: true, hint: '图2：要放入场景的主体' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
