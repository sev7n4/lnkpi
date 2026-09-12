export interface UpscaleInput {
  imageUrl: string
  scale: 2 | 4
}

export interface UpscaleResult {
  url: string
  providerId: string
  modelId?: string
}

export interface UpscaleProvider {
  readonly id: string
  /** 该实现是否支持给定 scale；不支持则 service 层返回 400/501 */
  supportsScale(scale: 2 | 4): boolean
  upscale(input: UpscaleInput): Promise<UpscaleResult>
}

const FAL_ESRGAN_MODEL = 'fal-ai/esrgan'

function extractUpscaleUrl(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const image = (json as Record<string, unknown>).image
  if (image && typeof image === 'object') {
    const url = (image as Record<string, unknown>).url
    if (typeof url === 'string' && url) return url
  }
  return undefined
}

/** Real-ESRGAN via fal (same FAL_KEY stack as SegmentProvider). */
export class FalEsrganUpscaleProvider implements UpscaleProvider {
  readonly id = 'fal'

  constructor(private apiKey: string) {}

  supportsScale(scale: 2 | 4): boolean {
    return scale === 2 || scale === 4
  }

  async upscale(input: UpscaleInput): Promise<UpscaleResult> {
    const res = await fetch(`https://fal.run/${FAL_ESRGAN_MODEL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${this.apiKey}`,
      },
      body: JSON.stringify({
        image_url: input.imageUrl,
        scale: input.scale,
        model: input.scale === 2 ? 'RealESRGAN_x2plus' : 'RealESRGAN_x4plus',
        output_format: 'png',
      }),
    })
    if (!res.ok) throw new Error(`Upscale API ${res.status}: ${await res.text()}`)
    const json = await res.json()
    const url = extractUpscaleUrl(json)
    if (!url) {
      throw new Error(`Upscale API response missing image url: ${JSON.stringify(json)}`)
    }
    return {
      url,
      providerId: this.id,
      modelId: FAL_ESRGAN_MODEL,
    }
  }
}

/**
 * Agnes-first factory: Agnes has no documented native upscale endpoint
 * (only generative img2img — forbidden as fake upscale). When Agnes is
 * unavailable, register fal Real-ESRGAN if `falApiKey` is set.
 *
 * `agnesApiKey` / `agnesBaseUrl` are reserved for a future Agnes upscale
 * wire-up; they currently never register a provider (see spec §5.3).
 */
export function createUpscaleProviders(opts: {
  agnesApiKey?: string
  agnesBaseUrl?: string
  /** Present only when Agnes cannot provide real upscale */
  falApiKey?: string
}): UpscaleProvider[] {
  const falKey = opts.falApiKey?.trim()
  return falKey ? [new FalEsrganUpscaleProvider(falKey)] : []
}
