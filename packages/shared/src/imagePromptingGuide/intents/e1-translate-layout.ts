import type { EditIntent } from '../types'

/** E1 — Translate layout */
export const e1TranslateLayout: EditIntent = {
  id: 'e1_translate_layout',
  kind: 'edit_intent',
  label: '版面翻译',
  description: 'Translate visible copy while preserving the original layout and visual design.',
  groupId: 'local_edit',
  groupLabel: '局部手术',
  fundamentalsRefs: ['exact_text', 'separate_changes', 'iterate'],
  changePreserveTemplate: `将输入图中的可见文字翻译为 {{TARGET_LANGUAGE}}。
仅替换原文，并精确呈现所给译文。
保留版面、层级、字体气质、颜色、间距、图像、logo 与背景。
译文自然嵌入，避免裁切或重叠。
不要增删或重设计其他任何元素。`,
  refRoles: [{ role: 'source', required: true, hint: '待翻译的原版面' }],
  preferredParams: { size: '1536x1024', quality: 'medium' },
  capability: { minRefImages: 1 },
}
