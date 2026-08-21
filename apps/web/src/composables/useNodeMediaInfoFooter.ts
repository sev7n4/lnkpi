import { inject, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { CANVAS_NODE_PATCH_KEY } from '@/composables/canvasNodeActions'
import type { NodeMediaInfoSummary } from '@/composables/useMediaInspector'
import {
  hasSummaryPayload,
  mergeNodeMediaInfo,
  needsMediaInfoEnsure,
  summaryFromProbed,
} from '@/composables/nodeMediaInfo'
import { studioApi } from '@/services/studio-api'

const probedOkUrls = new Set<string>()

export function useNodeMediaInfoFooter(args: {
  nodeId: string
  url: MaybeRefOrGetter<string | undefined>
  kind: MaybeRefOrGetter<'image' | 'video' | 'audio'>
  mediaInfo: MaybeRefOrGetter<NodeMediaInfoSummary | undefined>
}) {
  const patchNode = inject(CANVAS_NODE_PATCH_KEY, null)

  async function ensureProbe() {
    const url = String(toValue(args.url) ?? '').trim()
    const kind = toValue(args.kind)
    const current = toValue(args.mediaInfo)
    if (!url || !patchNode) return
    const need = needsMediaInfoEnsure(kind, current, url)
    if (!need) return
    const onlyNeedDuration =
      kind === 'audio' && hasSummaryPayload(current) && current?.durationSec == null
    if (onlyNeedDuration) return
    if (probedOkUrls.has(url) && hasSummaryPayload(current)) return
    try {
      const probed = await studioApi.probeMedia(url)
      if (probed.probeStatus === 'ok') probedOkUrls.add(url)
      const built = summaryFromProbed(kind, probed)
      if (!built) return
      const merged = mergeNodeMediaInfo(toValue(args.mediaInfo), built)
      if (!hasSummaryPayload(merged)) return
      patchNode(args.nodeId, { mediaInfo: merged })
    } catch {
      // silent
    }
  }

  function applyDurationSec(durationSec: number) {
    if (!patchNode || !Number.isFinite(durationSec) || durationSec < 0) return
    const kind = toValue(args.kind)
    if (kind !== 'audio') return
    const merged = mergeNodeMediaInfo(toValue(args.mediaInfo), {
      kind: 'audio',
      durationSec,
    })
    patchNode(args.nodeId, { mediaInfo: merged })
  }

  watch(
    () => [toValue(args.url), toValue(args.kind), toValue(args.mediaInfo)] as const,
    () => {
      void ensureProbe()
    },
    { immediate: true },
  )

  return { applyDurationSec }
}
