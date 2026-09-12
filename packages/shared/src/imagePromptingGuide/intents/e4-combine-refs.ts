import type { EditIntent } from '../types'

/** P0 E4 — Combine references */
export const e4CombineRefs: EditIntent = {
  id: 'e4_combine_refs',
  kind: 'edit_intent',
  label: '多参考合成',
  description: 'Place the subject from image 2 into the scene of image 1; change nothing else.',
  groupId: 'ref_compose',
  groupLabel: '参考合成',
  fundamentalsRefs: ['separate_changes', 'assign_ref_roles', 'iterate'],
  changePreserveTemplate: `将图 2 的主体放入图 1 的场景中。
光线、构图与背景风格与图 1 一致。
除此之外不要改动——保留主体身份与场景其余部分。`,
  refRoles: [
    { role: 'scene', required: true, hint: '图1：场景/背景' },
    { role: 'subject', required: true, hint: '图2：要放入场景的主体' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
