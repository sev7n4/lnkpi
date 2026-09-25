/**
 * 画布工具链统一积分定价（2026-09-25 用户拍板原则）：
 * 任何工具（快捷入口 / 精修入口）在生成或确认前，必须展示「消耗多少积分」或「免费」。
 * 数值统一单点定义于此，后续调整只改这里。
 *
 * 原则：
 *  - 生成类（产出新图，服务端实际扣费）→ 消耗积分；
 *  - 纯本地处理类（裁剪 / 抠图合成 / 标注烧录，不出新像素）→ 免费。
 *  - 生成类数值当前统一 10（与 IMAGE_EDIT_MODEL_PRICING.image2 一致）；
 *    服务端按模型定价扣费，前端展示为预估，两者保持同步调整。
 */

/** 生成类工具统一积分消耗（元素编辑 / 重绘 / 扩图 / 精修）。 */
export const CANVAS_GENERATE_CREDITS = 10

/** 各画布工具的展示定价：数值 = 消耗积分，0 = 免费。 */
export const CANVAS_TOOL_CREDITS = {
  refine: CANVAS_GENERATE_CREDITS,
  inpaint: CANVAS_GENERATE_CREDITS,
  element: CANVAS_GENERATE_CREDITS,
  outpaint: CANVAS_GENERATE_CREDITS,
  matting: 0,
  crop: 0,
  annotate: 0,
} as const

export type CanvasToolCreditKey = keyof typeof CANVAS_TOOL_CREDITS
