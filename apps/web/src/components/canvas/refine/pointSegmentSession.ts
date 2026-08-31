import { isSegmentUpstreamDegradable } from './segmentDegrade'

export type PointSegmentSession = {
  preferLocal: boolean
  fallbackToastShown: boolean
}

export function createPointSegmentSession(): PointSegmentSession {
  return { preferLocal: false, fallbackToastShown: false }
}

export function resetPointSegmentSession(session: PointSegmentSession): void {
  session.preferLocal = false
  session.fallbackToastShown = false
}

export async function resolvePointMaskRgba(opts: {
  session: PointSegmentSession
  remoteSegment: () => Promise<{ maskUrl: string }>
  loadRemoteRgba: (maskUrl: string) => Promise<Uint8ClampedArray>
  localSegment: () => Promise<Uint8ClampedArray>
  onFallbackToast?: () => void
}): Promise<Uint8ClampedArray> {
  const { session } = opts
  if (session.preferLocal) {
    return opts.localSegment()
  }
  try {
    const { maskUrl } = await opts.remoteSegment()
    return await opts.loadRemoteRgba(maskUrl)
  } catch (err) {
    if (!isSegmentUpstreamDegradable(err)) throw err
    const rgba = await opts.localSegment()
    session.preferLocal = true
    if (!session.fallbackToastShown) {
      session.fallbackToastShown = true
      opts.onFallbackToast?.()
    }
    return rgba
  }
}
