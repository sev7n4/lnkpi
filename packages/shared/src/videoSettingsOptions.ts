import type { VideoModelCapabilities } from './videoModelCapabilities'
import type { VideoAspectRatio, VideoResolution } from './index'

export interface VideoAspectRatioOption {
  value: VideoAspectRatio
  label: string
}

export interface VideoResolutionOption {
  value: VideoResolution
  label: string
}

/** Base labels aligned with VIDEO_ASPECT_RATIO_OPTIONS in index.ts */
const BASE_ASPECT_RATIO_OPTIONS: VideoAspectRatioOption[] = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方形' },
]

const EXTRA_ASPECT_RATIO_LABELS: Record<string, string> = {
  '4:3': '4:3',
  '3:4': '3:4',
  '21:9': '21:9 超宽',
  adaptive: '自适应',
}

/** Base labels aligned with VIDEO_RESOLUTION_OPTIONS in index.ts */
const BASE_RESOLUTION_OPTIONS: VideoResolutionOption[] = [
  { value: '480p', label: '480p' },
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' },
]

const EXTRA_RESOLUTION_OPTIONS: VideoResolutionOption[] = [
  { value: '4k', label: '4K' },
]

function aspectRatioLabel(value: VideoAspectRatio): string {
  const base = BASE_ASPECT_RATIO_OPTIONS.find((o) => o.value === value)
  if (base) return base.label
  return EXTRA_ASPECT_RATIO_LABELS[value] ?? value
}

function resolutionLabel(value: VideoResolution): string {
  const base = BASE_RESOLUTION_OPTIONS.find((o) => o.value === value)
  if (base) return base.label
  const extra = EXTRA_RESOLUTION_OPTIONS.find((o) => o.value === value)
  if (extra) return extra.label
  return value
}

export function videoAspectRatioOptionsForCapabilities(
  c: VideoModelCapabilities,
): VideoAspectRatioOption[] {
  const allowed = new Set(c.allowedAspectRatios)
  const fromBase = BASE_ASPECT_RATIO_OPTIONS.filter((o) => allowed.has(o.value))
  const extras = c.allowedAspectRatios
    .filter((ratio) => !BASE_ASPECT_RATIO_OPTIONS.some((o) => o.value === ratio))
    .map((value) => ({ value: value as VideoAspectRatio, label: aspectRatioLabel(value as VideoAspectRatio) }))
  return [...fromBase, ...extras]
}

export function videoResolutionOptionsForCapabilities(
  c: VideoModelCapabilities,
): VideoResolutionOption[] {
  const allowed = new Set(c.allowedResolutions)
  const fromBase = BASE_RESOLUTION_OPTIONS.filter((o) => allowed.has(o.value))
  const extras = c.allowedResolutions
    .filter((res) => !BASE_RESOLUTION_OPTIONS.some((o) => o.value === res))
    .map((value) => ({ value: value as VideoResolution, label: resolutionLabel(value as VideoResolution) }))
  return [...fromBase, ...extras]
}
