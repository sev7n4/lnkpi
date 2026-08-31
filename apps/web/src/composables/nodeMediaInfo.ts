import type { ProbedMediaFile } from '@lnkpi/shared'
import type { NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import { aspectRatioLabel, formatMediaDimensions, formatMediaFormat } from '@/utils/mediaInfoFormat'

export function hasSummaryPayload(summary?: NodeMediaInfoSummary): boolean {
  if (!summary) return false
  const { kind: _k, refWarning: _r, ...rest } = summary
  return Object.values(rest).some((v) => v != null && v !== '')
}

export function needsMediaInfoEnsure(
  kind: 'image' | 'video' | 'audio',
  summary: NodeMediaInfoSummary | undefined,
  url: string | undefined,
): boolean {
  if (!url?.trim()) return false
  if (!hasSummaryPayload(summary)) return true
  if (kind === 'audio' && (summary?.durationSec == null || !Number.isFinite(summary.durationSec))) {
    return true
  }
  return false
}

export function summaryFromProbed(
  kind: 'image' | 'video' | 'audio',
  probed: ProbedMediaFile,
): NodeMediaInfoSummary | undefined {
  const summary: NodeMediaInfoSummary = { kind }
  if (probed.bytes != null) summary.bytes = probed.bytes
  if (kind === 'audio') {
    const fmt = formatMediaFormat(probed.mimeType)
    if (fmt) summary.format = fmt
    if (probed.durationSec != null) summary.durationSec = probed.durationSec
  } else if (kind === 'video') {
    const dims = formatMediaDimensions(probed.width, probed.height)
    if (dims) summary.resolution = dims
    const ar = aspectRatioLabel(probed.width, probed.height)
    if (ar) summary.aspectRatio = ar
  } else {
    if (probed.width != null) summary.width = probed.width
    if (probed.height != null) summary.height = probed.height
    const ar = aspectRatioLabel(probed.width, probed.height)
    if (ar) summary.aspectRatio = ar
  }
  return hasSummaryPayload(summary) ? summary : undefined
}

export function mergeNodeMediaInfo(
  prev: NodeMediaInfoSummary | undefined,
  next: NodeMediaInfoSummary,
): NodeMediaInfoSummary {
  const out: NodeMediaInfoSummary = { ...(prev ?? {}), ...next, kind: next.kind ?? prev?.kind }
  const keys = [
    'width',
    'height',
    'bytes',
    'aspectRatio',
    'resolution',
    'durationSec',
    'format',
    'refWarning',
  ] as const
  for (const k of keys) {
    const v = next[k]
    if (v == null || v === '') {
      if (prev?.[k] != null && prev[k] !== '') (out as Record<string, unknown>)[k] = prev[k]
    }
  }
  return out
}
