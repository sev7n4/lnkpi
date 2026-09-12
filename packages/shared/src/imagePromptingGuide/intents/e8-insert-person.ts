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
  changePreserveTemplate: `将图 2 中的人物自然放入图 1 场景的 {{PLACEMENT}}。
保留人物精确身份、五官、发型、体型比例与服装。
匹配场景的透视、尺度、光线、色彩、景深、接触阴影与遮挡。
保留原有背景、人物、物体、机位与取景。
不要改变人物身份，不要添加文字、logo 或水印。`,
  refRoles: [
    { role: 'scene', required: true, hint: '图1：目标场景' },
    { role: 'subject', required: true, hint: '图2：要放入场景的人物' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2, requiresSubjectRef: true },
}
