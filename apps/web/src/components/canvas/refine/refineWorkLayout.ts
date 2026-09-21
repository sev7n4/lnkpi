export function refineWorkInsetRight(input: {
  innerWidth: number
  collapsed: boolean
  panelWidth: number
}): number {
  if (input.innerWidth < 640) return 0
  if (input.collapsed) return 44
  return input.panelWidth
}

export function containRect(
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
): { x: number; y: number; width: number; height: number } {
  if (boxW <= 0 || boxH <= 0 || imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  const scale = Math.min(boxW / imgW, boxH / imgH)
  const width = imgW * scale
  const height = imgH * scale
  return {
    x: (boxW - width) / 2,
    y: (boxH - height) / 2,
    width,
    height,
  }
}

/**
 * 原始比例 1:1 的缩放系数：按图片像素对显示宽度的倍率，夹在 1–8 之间。
 * 抽成纯函数便于单测（jsdom 无真实布局，film.width 常为 0，组件内退化成 1）。
 */
export function oneToOneScaleOf(imgW: number, filmW: number): number {
  if (filmW <= 0 || imgW <= 0) return 1
  return Math.min(8, Math.max(1, imgW / filmW))
}

export function clampLoupeZoom(n: number): number {
  if (!Number.isFinite(n)) return 2.5
  return Math.min(6, Math.max(1.5, n))
}

export function loupeBackground(input: {
  displayW: number
  displayH: number
  pointerX: number
  pointerY: number
  lens: number
  zoom: number
}): { backgroundSize: string; backgroundPosition: string } {
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 2
  const x = Math.min(input.displayW, Math.max(0, input.pointerX))
  const y = Math.min(input.displayH, Math.max(0, input.pointerY))
  return {
    backgroundSize: `${input.displayW * zoom}px ${input.displayH * zoom}px`,
    backgroundPosition: `${-x * zoom + input.lens / 2}px ${-y * zoom + input.lens / 2}px`,
  }
}
