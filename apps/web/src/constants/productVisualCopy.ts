/**
 * Product visual v2 user-facing guidance — mirrors
 * `services/agent-runtime/skills/ecommerce-product-visual/assets/copy/1.0.0.yaml` guidance.*
 */

export interface ProductVisualExampleUtterance {
  id: string
  label: string
  text: string
}

export const PRODUCT_VISUAL_GUIDANCE = {
  macroStyleInCards: '风格在这里选；需求用口语描述即可。',
  attachmentHint: '建议清晰 product 图；白底更佳，非白底也可继续。',
  exampleUtterances: [
    {
      id: 'gift_box',
      label: '礼盒',
      text: '这是我们的大闸蟹礼盒，帮我做一套电商包装推广图：包装主视觉、包装结构图、模特送礼场景图。风格喜庆高级，突出冷链保鲜和礼盒质感。',
    },
    {
      id: 'listing',
      label: 'Listing',
      text: '用这张产品实拍图出电商主图和详情页场景图：白底主图、两张生活场景，突出产品卖点和质感。',
    },
    {
      id: 'space',
      label: '空间',
      text: '这是待装修客厅，出有人在里面的现代简约空间效果图、材质软装搭配板，沙发置入效果，最好有一位女性在客厅使用沙发的真实生活感。暖白原木色调。',
    },
  ] satisfies ProductVisualExampleUtterance[],
} as const
