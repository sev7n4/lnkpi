/**
 * 扩图「应用到节点」中心锚定几何（M2 Task 9，规格 §3.4）。
 *
 * 应用扩图版本时节点按新画布尺寸居中放大：
 *   position = oldCenter − newSize/2（即原式），与其他节点的重叠按画布既有 z 序处理，不做避让。
 * 只有扩图版本（newSize ≠ oldSize）需要改 position；普通精修版本尺寸不变不动。
 */

export type CenterExpandSize = { width: number; height: number }

/**
 * 中心锚定的新 position：x + (oldW − newW)/2, y + (oldH − newH)/2（奇数差值四舍五入）。
 */
export function centerExpandPosition(
  pos: { x: number; y: number },
  oldSize: CenterExpandSize,
  newSize: CenterExpandSize,
): { x: number; y: number } {
  return {
    x: Math.round(pos.x + (oldSize.width - newSize.width) / 2),
    y: Math.round(pos.y + (oldSize.height - newSize.height) / 2),
  }
}

/**
 * 把目标尺寸（新画布 outpaintTo）等比缩放到恰好 contain 进旧显示框，
 * 得到节点卡应用扩图结果后的显示尺寸——整张新画布在节点内完整可见。
 */
export function containFitSize(box: CenterExpandSize, target: CenterExpandSize): CenterExpandSize {
  const scale = Math.min(box.width / target.width, box.height / target.height)
  return {
    width: Math.round(target.width * scale),
    height: Math.round(target.height * scale),
  }
}
