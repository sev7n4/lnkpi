import type { RefineChromeMode } from '@/utils/refineChrome'

export function refineWorkInsetRight(input: {
  innerWidth: number
  chrome: RefineChromeMode
  collapsed: boolean
  panelWidth: number
}): number {
  if (input.innerWidth < 640) return 0
  if (input.chrome === 'floating' && !input.collapsed) return 0
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
