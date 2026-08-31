export interface SegmentPointInput {
  imageUrl: string
  x: number
  y: number
  label?: 0 | 1
}

export interface SegmentProvider {
  segment(input: SegmentPointInput): Promise<{ maskUrl: string }>
}

const DEFAULT_FAL_MODEL = 'fal-ai/sam-3/image'

function extractMaskUrl(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined
  const record = json as Record<string, unknown>
  const masks = record.masks
  if (Array.isArray(masks) && masks[0] && typeof masks[0] === 'object') {
    const url = (masks[0] as Record<string, unknown>).url
    if (typeof url === 'string' && url) return url
  }
  const image = record.image
  if (image && typeof image === 'object') {
    const url = (image as Record<string, unknown>).url
    if (typeof url === 'string' && url) return url
  }
  return undefined
}

export function createSegmentProvider(opts: {
  apiKey: string
  falModel?: string
}): SegmentProvider {
  const apiKey = opts.apiKey
  const model = opts.falModel ?? DEFAULT_FAL_MODEL

  return {
    async segment(input: SegmentPointInput): Promise<{ maskUrl: string }> {
      const res = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify({
          image_url: input.imageUrl,
          point_prompts: [{ x: input.x, y: input.y, label: input.label ?? 1 }],
          return_multiple_masks: false,
          apply_mask: false,
          output_format: 'png',
        }),
      })
      if (!res.ok) throw new Error(`Segment API ${res.status}: ${await res.text()}`)
      const json = await res.json()
      const maskUrl = extractMaskUrl(json)
      if (!maskUrl) {
        throw new Error(`Segment API response missing mask url: ${JSON.stringify(json)}`)
      }
      return { maskUrl }
    },
  }
}
