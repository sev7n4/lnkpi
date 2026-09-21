import { clampWipeRatio } from '@/utils/refineChrome'
import type { CompareMode } from '@/utils/refineChrome'

export function wipeHoldRatio(showingOriginal: boolean, wipeRatio: number): number {
  if (showingOriginal) return 0
  return clampWipeRatio(wipeRatio)
}

export function shouldRenderWipe(mode: CompareMode): boolean {
  return mode === 'wipe'
}

export function wipeAfterSrc(afterUrl: string | undefined, beforeUrl: string): string {
  return afterUrl || beforeUrl
}

/**
 * 版本 metadata 中与对照相关的字段（Task 2 服务端契约：editMode / outpaintFrom / outpaintTo）。
 */
export interface RefineCompareMetadata {
  editMode?: string
  outpaintFrom?: { width: number; height: number }
  outpaintTo?: { width: number; height: number }
}

/** 对照带「基准画布」模式载荷：新画布尺寸 + 原图在新画布中的左上角偏移。 */
export interface CompareBaseCanvas {
  width: number
  height: number
  beforeOffset: { x: number; y: number }
}

/**
 * 「应用到节点」载荷（M2 T9）：在既有 url/prompt/recordId 之上，
 * 携带当前工作版本的 metadata（Task 2 契约字段同形）——
 * 应用链路据此判断是否为扩图版本并做中心锚定重排；普通精修版本无 metadata，不动 position。
 */
export interface RefineApplyPayload {
  url: string
  prompt: string
  recordId?: string
  metadata?: RefineCompareMetadata
}

/**
 * 扩图版本的基准画布（Task 8）：以新画布 outpaintTo 为基准，Before 居中贴图——
 * 偏移取 (to - from) / 2（metadata 只记录两侧尺寸，无锚点信息，规格 §3 语义即居中）。
 * 非扩图版本或缺几何字段时返回 undefined（普通对照渲染不受影响）。
 */
export function baseCanvasFromMetadata(
  metadata: RefineCompareMetadata | null | undefined,
): CompareBaseCanvas | undefined {
  if (!metadata || metadata.editMode !== 'outpaint') return undefined
  const { outpaintFrom, outpaintTo } = metadata
  if (!outpaintFrom || !outpaintTo) return undefined
  return {
    width: outpaintTo.width,
    height: outpaintTo.height,
    beforeOffset: {
      x: Math.round((outpaintTo.width - outpaintFrom.width) / 2),
      y: Math.round((outpaintTo.height - outpaintFrom.height) / 2),
    },
  }
}
