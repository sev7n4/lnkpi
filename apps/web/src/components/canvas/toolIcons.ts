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

/** 「选区」模式入口：四角框线（marquee corner brackets），表述「框出一片区域」（spec §5.1） */
export const TOOL_ICON_SELECT =
  '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" /><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" /><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" /><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />'

/** 「扩图」模式入口：虚线外框 + 实线内框，表述「画布向外扩展」（spec §5.1） */
export const TOOL_ICON_OUTPAINT =
  '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="3 2.5" /><rect x="8.5" y="8.5" width="7" height="7" rx="1" />'

/** 「裁剪」模式入口：经典 crop 标（两把 L 形尺） */
export const TOOL_ICON_CROP =
  '<path d="M6.5 2.5v13a2 2 0 0 0 2 2h13" /><path d="M17.5 21.5v-13a2 2 0 0 0-2-2h-13" />'

/** 「局部重绘」入口：画笔（笔杆 + 笔头斜切），与 rail 能力区占位图标同形 */
export const TOOL_ICON_INPAINT =
  '<path d="M5 19.5l3.8-.7L19.2 8.4a1.7 1.7 0 0 0 0-2.4l-1.2-1.2a1.7 1.7 0 0 0-2.4 0L5.7 15.2z" /><path d="M14.8 6.6l2.6 2.6" />'
