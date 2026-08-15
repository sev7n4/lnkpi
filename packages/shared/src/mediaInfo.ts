export interface ProbedMediaFile {
  url: string
  width?: number
  height?: number
  bytes?: number
  mimeType?: string
  durationSec?: number
  probeStatus: 'ok' | 'failed' | 'pending'
  probeError?: string
}

export interface MediaInfo {
  output?: ProbedMediaFile
  references?: Array<ProbedMediaFile & { refKey?: string; role?: string }>
  probedAt?: string
}

export type MediaRefWarningLevel = 'none' | 'warn' | 'error'

export interface MediaRefPreflight {
  level: MediaRefWarningLevel
  code?: 'ref_too_large' | 'ref_dimension_exceeded' | 'ref_probe_failed'
  message: string
  refs: Array<{
    url: string
    refKey?: string
    width?: number
    height?: number
    bytes?: number
    level: MediaRefWarningLevel
  }>
}

export const VIDEO_REF_WARN_BYTES = 5 * 1024 * 1024
export const VIDEO_REF_ERROR_BYTES = 10 * 1024 * 1024
export const VIDEO_REF_WARN_MAX_EDGE = 2048
export const VIDEO_REF_ERROR_MAX_EDGE = 4096

const LEVEL_RANK: Record<MediaRefWarningLevel, number> = {
  none: 0,
  warn: 1,
  error: 2,
}

function maxLevel(a: MediaRefWarningLevel, b: MediaRefWarningLevel): MediaRefWarningLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`
  }
  return `${bytes}B`
}

export function maxEdge(width?: number, height?: number): number {
  return Math.max(width ?? 0, height ?? 0)
}

export function classifyRefSize(
  file: Pick<ProbedMediaFile, 'width' | 'height' | 'bytes'>,
): MediaRefWarningLevel {
  const edge = maxEdge(file.width, file.height)
  const bytes = file.bytes ?? 0

  if (bytes > VIDEO_REF_ERROR_BYTES || edge > VIDEO_REF_ERROR_MAX_EDGE) {
    return 'error'
  }
  if (bytes > VIDEO_REF_WARN_BYTES || edge > VIDEO_REF_WARN_MAX_EDGE) {
    return 'warn'
  }
  return 'none'
}

function refPreflightCode(
  ref: ProbedMediaFile & { refKey?: string },
  level: MediaRefWarningLevel,
): MediaRefPreflight['code'] {
  if (level !== 'error') return undefined
  if (ref.probeStatus === 'failed') return 'ref_probe_failed'
  const bytes = ref.bytes ?? 0
  const edge = maxEdge(ref.width, ref.height)
  if (bytes > VIDEO_REF_ERROR_BYTES) return 'ref_too_large'
  if (edge > VIDEO_REF_ERROR_MAX_EDGE) return 'ref_dimension_exceeded'
  return 'ref_too_large'
}

function buildPreflightMessage(
  worst: {
    refKey?: string
    width?: number
    height?: number
    bytes?: number
    level: MediaRefWarningLevel
  },
  opts?: { blockWire?: string },
): string {
  const refLabel = worst.refKey ?? '参考图'
  const sizePart =
    worst.width != null && worst.height != null ? `${worst.width}×${worst.height}` : undefined
  const bytesPart = worst.bytes != null ? formatBytes(worst.bytes) : undefined
  const detail = [sizePart, bytesPart].filter(Boolean).join('，')

  if (worst.level === 'warn') {
    return detail
      ? `参考图 ${refLabel} 偏大（${detail}），可能上游拒收。`
      : `参考图 ${refLabel} 偏大，可能上游拒收。`
  }

  if (opts?.blockWire === 'agnes_keyframes') {
    return detail
      ? `参考图 ${refLabel} 过大（${detail}），Agnes 关键帧模式可能无法处理。请压缩后重试或移除该参考图。`
      : `参考图 ${refLabel} 过大，Agnes 关键帧模式可能无法处理。请压缩后重试或移除该参考图。`
  }

  return detail
    ? `参考图 ${refLabel} 过大（${detail}），可能无法被上游处理。请压缩后重试或移除该参考图。`
    : `参考图 ${refLabel} 过大，可能无法被上游处理。请压缩后重试或移除该参考图。`
}

export function evaluateMediaRefPreflight(
  refs: Array<ProbedMediaFile & { refKey?: string }>,
  opts?: { blockWire?: string },
): MediaRefPreflight {
  const evaluated = refs.map((ref) => {
    const level =
      ref.probeStatus === 'failed' ? 'error' : classifyRefSize(ref)
    return {
      url: ref.url,
      refKey: ref.refKey,
      width: ref.width,
      height: ref.height,
      bytes: ref.bytes,
      level,
    }
  })

  let level: MediaRefWarningLevel = 'none'
  for (const ref of evaluated) {
    level = maxLevel(level, ref.level)
  }

  if (level === 'none') {
    return { level, message: '', refs: evaluated }
  }

  const worst =
    evaluated.find((ref) => ref.level === 'error') ??
    evaluated.find((ref) => ref.level === 'warn')!

  const sourceRef = refs.find((ref) => ref.url === worst.url && ref.refKey === worst.refKey) ?? refs[0]

  return {
    level,
    code: refPreflightCode(sourceRef, worst.level),
    message: buildPreflightMessage(worst, opts),
    refs: evaluated,
  }
}
