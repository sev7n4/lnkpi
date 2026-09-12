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
  changePreserveTemplate: `根据提供的服装参考编辑图像中的人物着装。
只改服装。不要改变面部、五官、肤色、体型、姿态或身份。
保留精确相貌、表情、发型与比例。
服装贴合现有姿态，布料自然，光影匹配。
不要改变背景、机位或取景。不要添加配饰、文字、logo 或水印。`,
  refRoles: [
    { role: 'subject', required: true, hint: '人物原图（身份/姿态）' },
    { role: 'clothing', required: true, hint: '服装参考图' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
