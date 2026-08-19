export function panZoomFromWheel(input: {
  scale: number
  panX: number
  panY: number
  deltaY: number
}): { scale: number; panX: number; panY: number } {
  const factor = input.deltaY > 0 ? 0.9 : 1.1
  const scale = Math.min(8, Math.max(1, input.scale * factor))
  if (scale === 1) return { scale, panX: 0, panY: 0 }
  return { scale, panX: input.panX, panY: input.panY }
}

export function panFromDrag(input: {
  panX: number
  panY: number
  dx: number
  dy: number
}): { panX: number; panY: number } {
  return { panX: input.panX + input.dx, panY: input.panY + input.dy }
}
