import type { EditableFlowNode } from '@/composables/useSelectedNodeEditor'
import type { CanvasEdgeLike } from '@/composables/useUpstreamNodeContext'

export type CompositionTrackType = 'video' | 'audio'

export interface CompositionTrack {
  nodeId: string
  type: CompositionTrackType
  title: string
  url: string
  label: string
}

function trackLabel(type: CompositionTrackType) {
  return type === 'video' ? '视频' : '音频'
}

function readTrackTitle(node: EditableFlowNode) {
  const data = node.data ?? {}
  return String(data.title ?? data.prompt ?? data.content ?? node.id).slice(0, 48)
}

/** 收集指向合成节点的入边 video/audio 轨（C-2 基础，供 C-1 Dock 展示） */
export function resolveCompositionTracks(
  targetNodeId: string,
  nodes: EditableFlowNode[],
  edges: CanvasEdgeLike[],
): CompositionTrack[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const tracks: CompositionTrack[] = []

  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue
    const source = nodeMap.get(edge.source)
    if (!source) continue
    const type = String(source.type ?? '')
    if (type !== 'video' && type !== 'audio') continue

    const trackType = type as CompositionTrackType
    const url = String(source.data?.url ?? '').trim()
    tracks.push({
      nodeId: source.id,
      type: trackType,
      title: readTrackTitle(source),
      url,
      label: trackLabel(trackType),
    })
  }

  return tracks
}

export function compositionTracksToNodePatch(tracks: CompositionTrack[]) {
  return {
    clipCount: tracks.length,
    tracks: tracks.map((track) => ({
      nodeId: track.nodeId,
      type: track.type,
      title: track.title,
      url: track.url,
    })),
  }
}
