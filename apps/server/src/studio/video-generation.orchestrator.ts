import { Injectable, NotFoundException } from '@nestjs/common'
import type { CanvasAction, CanonicalVideoGenerationRequest } from '@lnkpi/shared'
import { StudioService, type StudioRefInput } from './studio.service'
import type {
  VideoGenerationStartResult,
  VideoGenerationWaitResult,
} from '@lnkpi/shared'

/** Align with Agnes video provider maxPollMs (600s) plus headers/network buffer. */
export const VIDEO_POLL_TIMEOUT_MS = 660_000
const POLL_INTERVAL_MS = 1500

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toStudioRefs(refs: CanonicalVideoGenerationRequest['refs']): StudioRefInput[] {
  return refs.map((r) => ({
    refKey: r.refKey,
    mediaType: r.mediaType,
    label: r.label,
    text: r.text,
    url: r.url,
  }))
}

@Injectable()
export class VideoGenerationOrchestrator {
  constructor(private readonly studio: StudioService) {}

  async start(
    userId: string,
    request: CanonicalVideoGenerationRequest,
    persist: (actions: CanvasAction[]) => Promise<unknown>,
    legacyReferenceImageUrl?: string,
  ): Promise<VideoGenerationStartResult> {
    const { nodeId, sessionId } = request.scope
    const prompt = request.prompt.trim()
    if (!prompt) throw new NotFoundException('节点缺少 prompt')

    const generationStartedAt = new Date().toISOString()
    const started: CanvasAction[] = [
      {
        type: 'update_node',
        payload: {
          id: nodeId,
          data: {
            status: 'generating',
            generationStartedAt,
            prompt,
          },
        },
      },
    ]
    await persist(started)
    const allActions: CanvasAction[] = [...started]

    const { videoSettings } = request
    const record = await this.studio.generateVideo(
      userId,
      prompt,
      request.model,
      videoSettings.duration,
      videoSettings.aspectRatio,
      toStudioRefs(request.refs),
      request.mentionedKeys,
      videoSettings.resolution,
      videoSettings.crop,
      legacyReferenceImageUrl,
      { sessionId, nodeId },
      request.videoMode,
      videoSettings.generateAudio,
      request.seed,
      request.negativePrompt,
    )

    const recordId = record.id
    const recordPatch: CanvasAction = {
      type: 'update_node',
      payload: { id: nodeId, data: { generationRecordId: recordId } },
    }
    allActions.push(recordPatch)
    await persist([recordPatch])

    return {
      generationRecordId: recordId,
      status: 'generating',
      generationStartedAt,
      actions: allActions,
    }
  }

  async wait(
    userId: string,
    input: { sessionId: string; nodeId: string; generationRecordId: string },
    persist: (actions: CanvasAction[]) => Promise<unknown>,
  ): Promise<VideoGenerationWaitResult> {
    const recordId = input.generationRecordId
    const allActions: CanvasAction[] = []

    try {
      const initial = await this.studio.getGeneration(userId, recordId)
      const terminal = await this.pollGeneration(userId, recordId, initial)
      const status = String(terminal.status)
      const url = typeof terminal.url === 'string' && terminal.url ? terminal.url : undefined

      const finishData: Record<string, unknown> = {
        status:
          status === 'completed'
            ? 'completed'
            : status === 'failed' || status === 'error'
              ? 'error'
              : status,
        generationRecordId: recordId,
      }
      if (url) finishData.url = url
      if (status !== 'completed') {
        finishData.errorMessage = '视频生成未完成或超时'
      }

      const finishActions: CanvasAction[] = [
        { type: 'update_node', payload: { id: input.nodeId, data: finishData } },
      ]
      await persist(finishActions)
      allActions.push(...finishActions)

      return {
        url,
        status: String(finishData.status),
        generationRecordId: recordId,
        actions: allActions,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '视频生成失败'
      const errorActions: CanvasAction[] = [
        {
          type: 'update_node',
          payload: {
            id: input.nodeId,
            data: { status: 'error', errorMessage, generationRecordId: recordId },
          },
        },
      ]
      await persist(errorActions)
      allActions.push(...errorActions)
      return { status: 'error', generationRecordId: recordId, actions: allActions }
    }
  }

  private async pollGeneration(
    userId: string,
    recordId: string,
    initial: { id: string; status: string; url?: string | null },
    timeoutMs = VIDEO_POLL_TIMEOUT_MS,
  ): Promise<{ id: string; status: string; url?: string | null }> {
    const terminal = new Set(['completed', 'failed', 'error', 'fallback_pending'])
    if (terminal.has(initial.status)) return initial

    const deadline = Date.now() + timeoutMs
    let latest = initial
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      latest = await this.studio.getGeneration(userId, recordId)
      if (terminal.has(latest.status)) return latest
    }
    return { ...latest, status: latest.status === 'generating' ? 'timeout' : latest.status }
  }
}
