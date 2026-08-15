import type { GenerationRefPayload } from '../nodeRefs'

export type CanvasAction = {
  type: 'add_node' | 'update_node' | 'remove_node' | 'add_edge' | 'remove_edge' | 'set_viewport'
  payload: Record<string, unknown>
}

export type VideoGenerationMode = 'text_to_video' | 'image_to_video' | 'first_last_frame'

export interface CanonicalVideoSettings {
  duration: number
  aspectRatio: string
  resolution: string
  crop: string
  generateAudio?: boolean
}

export interface VideoAccountDefaults {
  model?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  crop?: string
}

export interface CanonicalVideoGenerationRequest {
  prompt: string
  refs: GenerationRefPayload[]
  mentionedKeys?: string[]
  videoSettings: CanonicalVideoSettings
  videoMode: VideoGenerationMode
  model?: string
  /** Optional RNG seed for weak reproducibility when provider supports it. */
  seed?: number
  /** Optional negative prompt / exclusion hints when provider supports it. */
  negativePrompt?: string
  scope: { sessionId: string; nodeId: string }
}

export interface VideoGenerationStartResult {
  generationRecordId: string
  status: 'generating'
  generationStartedAt: string
  actions: CanvasAction[]
}

export interface VideoGenerationWaitResult {
  generationRecordId: string
  status: string
  url?: string
  actions: CanvasAction[]
}
