/** 视频合成 videoComposition 节点 export 数据结构（C-4） */

export type VideoCompositionTrackType = 'video' | 'audio'

export interface VideoCompositionExportTrack {
  nodeId: string
  type: VideoCompositionTrackType
  title: string
  url: string
  durationSec: number
  startSec?: number
}

export interface VideoCompositionExportRequest {
  sessionId: string
  compositionNodeId: string
  title?: string
  tracks: VideoCompositionExportTrack[]
}

export interface VideoCompositionExportResult {
  compositionNodeId: string
  url: string
  durationSec: number
  status: 'completed'
}
