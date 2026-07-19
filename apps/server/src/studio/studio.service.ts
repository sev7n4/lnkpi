import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  buildAudioRequest,
  buildImageProviderOptions,
  buildVideoProviderOptions,
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generatePromptFromUserInput,
  generateTextWithImages,
  mergeRefsToPrompt,
  type MergeTextSource,
} from '@lnkpi/agent'
import { resolveImageSize, resolveModelKey, type ImageResolutionTier } from '@lnkpi/shared'
import { PointsService } from '../points/points.service'
import { PrismaService } from '../prisma/prisma.service'

const AUDIO_PLACEHOLDER = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

export interface StudioRefInput {
  refKey: string
  mediaType: string
  label?: string
  text?: string
  url?: string
}

function extractTextSources(refs?: StudioRefInput[]): MergeTextSource[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'text' && r.text?.trim())
    .map((r) => ({
      refKey: r.refKey,
      label: r.label?.trim() || r.refKey,
      text: r.text!.trim(),
    }))
}

// Provider image/video APIs currently use only referenceImages[0] (I1); full list is kept in metadata.
function extractReferenceImages(refs?: StudioRefInput[]): string[] {
  return (refs ?? [])
    .filter((r) => r.mediaType === 'image' && r.url?.trim())
    .map((r) => r.url!.trim())
}

function buildPromptWithRefImage(prompt: string, refImageUrl: string): string {
  const trimmed = prompt.trim()
  const ref = refImageUrl.trim()
  if (!ref) return trimmed
  return `${trimmed} [ref-image:${ref}]`
}

@Injectable()
export class StudioService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PointsService) private readonly points: PointsService,
  ) {}

  async listGenerations(userId: string, type?: string) {
    return this.prisma.generationRecord.findMany({
      where: { userId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }

  private async resolveMergedPrompt(
    localPrompt: string,
    refs: StudioRefInput[] | undefined,
    downstreamType: 'text' | 'image' | 'video' | 'audio',
    mentionedKeys?: string[],
  ) {
    const { mergedText, skippedMerge } = await mergeRefsToPrompt({
      sources: extractTextSources(refs),
      localPrompt: localPrompt.trim() || undefined,
      downstreamType,
      mentionedKeys: mentionedKeys?.length ? mentionedKeys : undefined,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    return {
      mergedText,
      skippedMerge,
      referenceImages: extractReferenceImages(refs),
    }
  }

  async generateText(
    userId: string,
    prompt: string,
    model?: string,
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
  ) {
    await this.points.consume(userId, 5, '文本生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'text',
      mentionedKeys,
    )
    const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('text', model)
    const gatewayModelId = entry.gatewayModelId
    const { text } =
      referenceImages.length > 0
        ? await generateTextWithImages(mergedText, referenceImages, {
            model: gatewayModelId,
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL,
          })
        : await createTextProvider().generate(mergedText, gatewayModelId)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'text',
        prompt: mergedText,
        model: resolvedKey,
        url: null,
        status: 'completed',
        metadata: JSON.stringify({
          text,
          modelKey: resolvedKey,
          gatewayModelId,
          ...(fallback ? { modelFallback: true } : {}),
          skippedMerge,
          refsCount: refs?.length ?? 0,
          visionUsed: referenceImages.length > 0,
          referenceImages,
        }),
      },
    })
  }

  async generatePrompt(userId: string, prompt: string, model?: string) {
    const trimmed = prompt?.trim()
    if (!trimmed) throw new BadRequestException('prompt 不能为空')
    await this.points.consume(userId, 5, '提示词模式生成')
    const { modelKey: resolvedKey, entry, fallback } = resolveModelKey('text', model)
    const gatewayModelId = entry.gatewayModelId
    const { mode, content } = await generatePromptFromUserInput(trimmed, {
      model: gatewayModelId,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'prompt',
        prompt: trimmed,
        model: resolvedKey,
        url: null,
        status: 'completed',
        metadata: JSON.stringify({
          mode,
          content,
          modelKey: resolvedKey,
          gatewayModelId,
          ...(fallback ? { modelFallback: true } : {}),
        }),
      },
    })
  }

  async getGeneration(userId: string, id: string) {
    const record = await this.prisma.generationRecord.findFirst({
      where: { id, userId },
    })
    if (!record) {
      throw new BadRequestException('生成记录不存在')
    }
    return record
  }

  async generateImage(
    userId: string,
    prompt: string,
    model?: string,
    aspectRatio = '16:9',
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    resolution = '1K',
    count = 1,
  ) {
    const n = Math.max(1, Math.min(4, Number(count) || 1))
    await this.points.consume(userId, 10 * n, '图像生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'image',
      mentionedKeys,
    )
    const size = resolveImageSize(aspectRatio, resolution as ImageResolutionTier)
    const built = buildImageProviderOptions({ modelKey: model, size, n, referenceImages })
    const primaryRef = built.referenceImages[0]
    const basePrompt = primaryRef ? buildPromptWithRefImage(mergedText, primaryRef) : mergedText
    const effectivePrompt = [basePrompt, built.effectivePromptSuffix].filter(Boolean).join('\n')
    const { url, urls } = await createImageProvider().generate(effectivePrompt, {
      size: built.size,
      n: built.n,
      modelId: built.modelId,
    })
    const imageUrls = urls?.length ? urls : [url]
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt: effectivePrompt,
        model: built.meta.modelKey,
        url: imageUrls[0],
        status: 'completed',
        metadata: JSON.stringify({
          ...built.meta,
          aspectRatio,
          resolution,
          count: n,
          size: built.size,
          urls: imageUrls,
          referenceImages,
          skippedMerge,
        }),
      },
    })
  }

  async generateImageVariation(userId: string, prompt: string, basePrompt?: string, model?: string) {
    await this.points.consume(userId, 10, '图像变体')
    const combined = basePrompt ? `${basePrompt}。变体要求：${prompt}` : prompt
    const { url } = await createImageProvider().generate(combined)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt: combined,
        model,
        url,
        status: 'completed',
        metadata: JSON.stringify({ variation: true, basePrompt }),
      },
    })
  }

  async generateVideo(
    userId: string,
    prompt: string,
    model?: string,
    duration = 5,
    aspectRatio = '16:9',
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
    resolution = '720p',
    crop = 'none',
  ) {
    const durationCredits = duration >= 15 ? 70 : duration >= 10 ? 50 : 30
    await this.points.consume(userId, durationCredits, '视频生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
    )
    const built = buildVideoProviderOptions({
      modelKey: model,
      duration,
      aspectRatio,
      resolution,
      crop,
      referenceImages,
    })
    const effectivePrompt = [mergedText, built.effectivePromptSuffix].filter(Boolean).join('\n')
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'video',
        prompt: effectivePrompt,
        model: built.meta.modelKey,
        status: 'generating',
        metadata: JSON.stringify({
          ...built.meta,
          duration,
          aspectRatio,
          resolution,
          crop,
          referenceImages,
          skippedMerge,
          mergedText,
        }),
      },
    })
    this.completeVideo(record.id, effectivePrompt, {
      model: built.model,
      duration: built.duration,
      aspectRatio: built.aspectRatio,
      resolution: built.resolution,
      crop: built.crop,
      image: built.image,
    }).catch(console.error)
    return record
  }

  async generateAudio(
    userId: string,
    text: string,
    options: {
      model?: string
      voice?: string
      emotion?: string
      language?: string
      speed?: number
      volume?: number
      pitch?: number
    } = {},
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
  ) {
    await this.points.consume(userId, 5, '音频生成')
    const { mergedText, skippedMerge } = await this.resolveMergedPrompt(text, refs, 'audio', mentionedKeys)
    const built = buildAudioRequest({
      mergedText,
      modelKey: options.model,
      voice: options.voice,
      emotion: options.emotion,
      language: options.language,
      speed: options.speed,
      volume: options.volume,
      pitch: options.pitch,
    })
    const { url } = await createAudioProvider().generate(built.text, built.options)
    const storeUrl = url.startsWith('data:') ? AUDIO_PLACEHOLDER : url
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'audio',
        prompt: mergedText,
        model: built.meta.modelKey,
        url: storeUrl,
        status: 'completed',
        metadata: JSON.stringify({
          ...built.meta,
          skippedMerge,
          voice: built.options.voice ?? options.voice ?? 'default',
          emotion: options.emotion ?? 'neutral',
          language: options.language ?? 'zh',
          speed: options.speed ?? 1,
          volume: options.volume,
          pitch: options.pitch,
          hasTtsData: url.startsWith('data:'),
        }),
      },
    })
    return { ...record, url }
  }

  private async completeVideo(
    id: string,
    prompt: string,
    options: {
      model?: string
      duration?: number
      aspectRatio?: string
      resolution?: string
      crop?: string
      image?: string
    },
  ) {
    try {
      const { url } = await createVideoProvider().generate(prompt, options)
      await this.prisma.generationRecord.update({
        where: { id },
        data: { url, status: 'completed' },
      })
    } catch (err) {
      console.error('Video generation failed:', err)
      await this.prisma.generationRecord.update({ where: { id }, data: { status: 'failed' } })
    }
  }

}
