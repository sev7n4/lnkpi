/** 形状（矩形 / 椭圆）与画笔的绘制样式分支（spec §5.5）：subtract 挖洞用 destination-out + 不透明黑，add 用选区色。 */
export type MaskShapeOp = 'add' | 'subtract'

export interface MaskShapeStyle {
  composite: GlobalCompositeOperation
  fill: string
  stroke: string
}

export function shapeStyleForOp(op: MaskShapeOp, color: string): MaskShapeStyle {
  if (op === 'subtract') {
    return { composite: 'destination-out', fill: 'rgba(0,0,0,1)', stroke: 'rgba(0,0,0,1)' }
  }
  return { composite: 'source-over', fill: color, stroke: color }
}
