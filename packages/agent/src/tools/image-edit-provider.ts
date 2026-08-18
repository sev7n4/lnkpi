import { buildImageEditRequest } from '../studio/edit-adapter'
import { extractApimartTaskId, pollApimartImageTask } from './apimart-image-task'

export interface ImageEditInput {
  userPrompt: string
  imageUrl: string
  maskUrl: string
  modelId?: string
  pollIntervalMs?: number
  maxPollMs?: number
}

export interface ImageEditProvider {
  edit(input: ImageEditInput): Promise<{ url: string }>
}

export class ApimartImageEditProvider implements ImageEditProvider {
  constructor(
    private apiKey: string,
    private baseUrl = 'https://api.apimart.ai/v1',
    private model?: string,
  ) {}

  async edit(input: ImageEditInput): Promise<{ url: string }> {
    const built = buildImageEditRequest({
      userPrompt: input.userPrompt,
      imageUrl: input.imageUrl,
      maskUrl: input.maskUrl,
    })
    const body: Record<string, unknown> = { ...built.body }
    if (input.modelId) body.model = input.modelId
    else if (this.model) body.model = this.model

    const root = this.baseUrl.replace(/\/$/, '')
    const res = await fetch(`${root}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Image edit API ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const taskId = extractApimartTaskId(json)
    if (!taskId) {
      throw new Error(`Image edit API async response missing task_id: ${JSON.stringify(json)}`)
    }
    const urls = await pollApimartImageTask({
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      taskId,
      pollIntervalMs: input.pollIntervalMs,
      maxPollMs: input.maxPollMs,
    })
    if (!urls[0]) throw new Error('Image edit API returned no urls')
    return { url: urls[0] }
  }
}

export function createImageEditProvider(opts?: {
  apiKey?: string
  baseUrl?: string
  model?: string
}): ImageEditProvider {
  if (!opts?.apiKey) throw new Error('missing api key')
  return new ApimartImageEditProvider(opts.apiKey, opts.baseUrl, opts.model)
}
