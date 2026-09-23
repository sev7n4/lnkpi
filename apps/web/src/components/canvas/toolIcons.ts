/**
 * 工具图标（内联 SVG 片段，渲染层用 v-html 注入）。
 *
 * 「抠图」图标由两处共用同一份常量，避免两处各自维护导致观感漂移
 * （2026-09-23 用户要求：画布浮层快捷条与精修左栏 rail 的抠图图标必须一致）：
 * - 画布节点浮层快捷工具条（SelectionActionBar）
 * - 精修工作台左栏 rail（RefineToolRail）
 */
export const TOOL_ICON_MATTING =
  '<circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.12 15.88" /><path d="M14.47 14.48L20 20" /><path d="M8.12 8.12L12 12" />'
