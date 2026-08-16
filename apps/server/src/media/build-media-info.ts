import type { MediaInfo } from '@lnkpi/shared'
import type { MediaProbeService } from './media-probe.service'

export async function buildMediaInfoPayload(
  mediaProbe: MediaProbeService,
  outputUrl: string | null,
  referenceUrls: string[],
): Promise<MediaInfo> {
  const output = outputUrl ? await mediaProbe.probeUrl(outputUrl) : undefined
  const references = await Promise.all(
    referenceUrls
      .filter((url) => typeof url === 'string' && url.trim())
      .map(async (url) => mediaProbe.probeUrl(url.trim())),
  )
  return {
    ...(output ? { output } : {}),
    ...(references.length ? { references } : {}),
    probedAt: new Date().toISOString(),
  }
}

export async function enrichVideoMediaInfoDimensions(
  mediaProbe: MediaProbeService,
  mediaInfo: MediaInfo,
  lastFrameUrl?: string | null,
): Promise<MediaInfo> {
  if (mediaInfo.output?.width && mediaInfo.output?.height) {
    return mediaInfo
  }
  const frameUrl = String(lastFrameUrl ?? '').trim()
  if (!frameUrl) {
    return mediaInfo
  }
  const lastFrame = await mediaProbe.probeUrl(frameUrl)
  if (!lastFrame.width || !lastFrame.height) {
    return mediaInfo
  }
  return {
    ...mediaInfo,
    output: {
      ...(mediaInfo.output ?? { url: frameUrl, probeStatus: 'ok' as const }),
      width: lastFrame.width,
      height: lastFrame.height,
    },
  }
}
