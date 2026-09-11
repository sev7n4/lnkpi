import type { GuideGroupId } from './types'

export const GUIDE_GROUP_ORDER: GuideGroupId[] = [
  'photo_ad',
  'info_design',
  'brand_ui',
  'narrative',
  'local_edit',
  'identity_product',
  'ref_compose',
]

const GROUP_LABELS: Record<GuideGroupId, string> = {
  photo_ad: '摄影/广告',
  info_design: '信息设计',
  brand_ui: '品牌/UI',
  narrative: '叙事',
  local_edit: '局部手术',
  identity_product: '身份/产品',
  ref_compose: '参考合成',
}

export function guideGroupLabel(id: GuideGroupId): string {
  return GROUP_LABELS[id]
}
