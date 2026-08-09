export type AnchorRect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

const PREVIEW_WIDTH = 340
const PREVIEW_MAX_HEIGHT = 420

/** Distance from viewport bottom reserved for dock / agent composer. */
export function measureReservedBottom(): number {
  if (typeof window === 'undefined') return 120
  const selectors = ['.dock-studio-toolbar', '.bottom-toolbar-container', '.agent-input-dock', '.agent-panel-shell']
  let studioTop = window.innerHeight
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((el) => {
      const rect = el.getBoundingClientRect()
      if (rect.height <= 0 || rect.width <= 0) return
      if (rect.top < studioTop && rect.top > window.innerHeight * 0.35) {
        studioTop = rect.top
      }
    })
  }
  return studioTop < window.innerHeight ? window.innerHeight - studioTop + 12 : 120
}

export function computeRefPreviewStyle(
  anchor: AnchorRect,
  previewWidth = PREVIEW_WIDTH,
  previewMaxHeight = PREVIEW_MAX_HEIGHT,
): { left: string; top: string } {
  const margin = 12
  const reservedBottom = measureReservedBottom()
  const maxBottom = window.innerHeight - reservedBottom
  const previewHeight = Math.min(previewMaxHeight, window.innerHeight * 0.7)

  let left = anchor.left
  if (left + previewWidth > window.innerWidth - margin) {
    left = window.innerWidth - previewWidth - margin
  }
  left = Math.max(margin, left)

  const spaceBelow = maxBottom - anchor.bottom - 8
  const spaceAbove = anchor.top - margin - 8
  let top: number
  if (spaceBelow < previewHeight * 0.5 && spaceAbove > spaceBelow) {
    top = anchor.top - previewHeight - 8
  } else {
    top = anchor.bottom + 8
  }

  if (top + previewHeight > maxBottom) {
    top = Math.max(margin, maxBottom - previewHeight)
  }
  if (top < margin) top = margin

  return { left: `${left}px`, top: `${top}px` }
}

export function anchorFromElement(el: HTMLElement): AnchorRect {
  const rect = el.getBoundingClientRect()
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}
