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
  changePreserveTemplate: `从输入图中移除 {{OBJECT_TO_REMOVE}}。
重建露出区域，使其与周围背景、纹理、光线、透视与纵深一致。
仅当阴影/倒影属于被移除物体时一并去掉。
其余人物、物体、颜色、细节、机位与裁切保持不变。
不要用其他物体替换，不要添加文字、logo 或水印。`,
  refRoles: [{ role: 'source', required: true, hint: '包含待移除物体的原图' }],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 1 },
}
