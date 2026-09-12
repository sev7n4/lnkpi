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
  changePreserveTemplate: `将输入草图转为写实照片效果。
精确保留构图、主体位置、姿态、透视、轮廓与关键设计特征。
把草图区域落实为合理材质、纹理、光线与阴影。
草图已标明的颜色与细节应保留；未标明处可合理补全。
不要重设计主体、改变取景，不要添加物体、文字、logo 或水印。`,
  refRoles: [{ role: 'drawing', required: true, hint: '要转为写实效果的草图/线稿' }],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 1 },
}
