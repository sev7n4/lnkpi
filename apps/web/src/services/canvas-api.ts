import { api } from './api'
import type { GenerationRefPayload, VideoSettings } from '@lnkpi/shared'
import type {
  SceneComposerBatchGenerateRequest,
  SceneComposerSaveRequest,
  VideoCompositionExportRequest,
} from '@lnkpi/shared'

export const canvasApi = {
  list: () => api.get('/agent/canvas/list'),
  create: (title?: string) => api.post('/agent/canvas/create', { title }),
  update: (id: string, data: { title?: string; canvasData?: unknown }) =>
    api.put('/agent/canvas/update', { id, ...data }),
  createShot: (sessionId: string, data: { title?: string; prompt?: string }) =>
    api.post('/agent/canvas/shot/create', { sessionId, ...data }),
  editShot: (shotId: string, data: { title?: string; prompt?: string; status?: string }) =>
    api.post('/agent/canvas/shot/edit', { shotId, ...data }),
  reorderShots: (sessionId: string, shotIds: string[]) =>
    api.post('/agent/canvas/shot-order', { sessionId, shotIds }),
  generateImage: (
    shotId: string,
    prompt: string,
    opts?: {
      model?: string
      aspectRatio?: string
      resolution?: string
      count?: number
      refs?: GenerationRefPayload[]
      mentionedKeys?: string[]
    },
  ) =>
    api.post('/agent/canvas/material/generate-image', {
      shotId,
      prompt,
      model: opts?.model,
      aspectRatio: opts?.aspectRatio,
      resolution: opts?.resolution,
      count: 1,
      refs: opts?.refs,
      mentionedKeys: opts?.mentionedKeys,
    }),
  generateVideo: (
    shotId: string,
    prompt: string,
    settings?: Partial<VideoSettings> & {
      model?: string
      refs?: GenerationRefPayload[]
      mentionedKeys?: string[]
    },
  ) =>
    api.post('/agent/canvas/material/generate-video', {
      shotId,
      prompt,
      model: settings?.model,
      duration: settings?.duration,
      aspectRatio: settings?.aspectRatio,
      crop: settings?.crop,
      resolution: settings?.resolution,
      refs: settings?.refs,
      mentionedKeys: settings?.mentionedKeys,
    }),
  statusBatch: (ids: string[]) =>
    api.get('/agent/canvas/shot/status/batch', { params: { ids: ids.join(',') } }),
  optimizePrompt: (prompt: string, style?: string) =>
    api.post<{ data: { optimized: string } }>('/agent/chat/optimize-prompt', { prompt, style }),
  saveSceneComposer: (payload: SceneComposerSaveRequest) =>
    api.post('/agent/canvas/scene-composer/save', payload),
  batchGenerateSceneComposer: (payload: SceneComposerBatchGenerateRequest) =>
    api.post('/agent/canvas/scene-composer/batch-generate', payload),
  exportVideoComposition: (payload: VideoCompositionExportRequest) =>
    api.post('/agent/canvas/video-composition/export', payload),
  confirmMaterialPlatformFallback: (id: string) =>
    api.post(`/agent/canvas/material/${id}/confirm-platform-fallback`, {}, { timeout: 120_000 }),
  cancelMaterialPlatformFallback: (id: string) =>
    api.post(`/agent/canvas/material/${id}/cancel-platform-fallback`),
}
