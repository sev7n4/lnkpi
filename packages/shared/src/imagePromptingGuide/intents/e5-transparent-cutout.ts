import type { EditIntent } from '../types'

/** P0 E5 — Transparent product cutout */
export const e5TransparentCutout: EditIntent = {
  id: 'e5_transparent_cutout',
  kind: 'edit_intent',
  label: '透明抠图',
  description: 'Isolate the product on a fully transparent background; no checkerboard or scenery.',
  groupId: 'identity_product',
  groupLabel: '身份/产品',
  fundamentalsRefs: ['define_result', 'separate_changes', 'iterate'],
  changePreserveTemplate: `从输入图中提取产品，并置于完全透明背景。
输出：产品居中、轮廓干净、无光晕/毛边。
精确保留产品造型与标签可读性。
仅可做轻微抛光。不要添加纯色底、棋盘格、场景或投影。
不要重绘产品；去掉背景并保留干净透明通道。`,
  refRoles: [{ role: 'product', required: true, hint: '产品图' }],
  preferredParams: {
    size: '1024x1536',
    quality: 'medium',
    background: 'transparent',
    outputFormat: 'png',
  },
  capability: { requiresTransparentBackground: true, minRefImages: 1 },
}
