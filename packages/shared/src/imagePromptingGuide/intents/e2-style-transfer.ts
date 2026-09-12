import type { EditIntent } from '../types'

/** E2 — Style transfer */
export const e2StyleTransfer: EditIntent = {
  id: 'e2_style_transfer',
  kind: 'edit_intent',
  label: '风格迁移',
  description: 'Apply the visual language of a style reference while preserving source content.',
  groupId: 'ref_compose',
  groupLabel: '参考合成',
  fundamentalsRefs: ['separate_changes', 'assign_ref_roles', 'iterate'],
  changePreserveTemplate: `用图 2 的视觉风格重绘图 1 的内容。
迁移风格参考的配色、介质、质感、光线处理与笔触。
保留图 1 的主体身份、姿态、构图、比例、物体与场景结构。
不要从图 2 复制人物、物体、文字或构图。
只改变视觉风格；不要添加文字、logo 或水印。`,
  refRoles: [
    { role: 'content', required: true, hint: '图1：保留内容与构图的原图' },
    { role: 'style', required: true, hint: '图2：仅提供视觉风格' },
  ],
  preferredParams: { size: '1024x1536', quality: 'medium' },
  capability: { minRefImages: 2 },
}
