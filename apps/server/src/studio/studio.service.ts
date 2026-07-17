import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import {
  createAudioProvider,
  createImageProvider,
  createTextProvider,
  createVideoProvider,
  generatePromptFromUserInput,
  generateTextWithImages,
  mergeRefsToPrompt,
  type MergeTextSource,
} from '@lnkpi/agent'
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
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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
    await this.consumePoints(userId, 5, '文本生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'text',
      mentionedKeys,
    )
    const { text } =
      referenceImages.length > 0
        ? await generateTextWithImages(mergedText, referenceImages, {
            model,
            apiKey: process.env.OPENAI_API_KEY,
            baseUrl: process.env.OPENAI_BASE_URL,
          })
        : await createTextProvider().generate(mergedText, model)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'text',
        prompt: mergedText,
        model,
        url: null,
        status: 'completed',
        metadata: JSON.stringify({
          text,
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
    await this.consumePoints(userId, 5, '提示词模式生成')
    const { mode, content } = await generatePromptFromUserInput(trimmed, {
      model,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL,
    })
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'prompt',
        prompt: trimmed,
        model,
        url: null,
        status: 'completed',
        metadata: JSON.stringify({ mode, content }),
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
  ) {
    await this.consumePoints(userId, 10, '图像生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'image',
      mentionedKeys,
    )
    const primaryRef = referenceImages[0] // only I1 is sent to the image provider; see extractReferenceImages
    const effectivePrompt = primaryRef ? buildPromptWithRefImage(mergedText, primaryRef) : mergedText
    const { url } = await createImageProvider().generate(effectivePrompt)
    return this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'image',
        prompt: effectivePrompt,
        model,
        url,
        status: 'completed',
        metadata: JSON.stringify({ aspectRatio, referenceImages, skippedMerge }),
      },
    })
  }

  async generateImageVariation(userId: string, prompt: string, basePrompt?: string, model?: string) {
    await this.consumePoints(userId, 10, '图像变体')
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
  ) {
    await this.consumePoints(userId, 30, '视频生成')
    const { mergedText, skippedMerge, referenceImages } = await this.resolveMergedPrompt(
      prompt,
      refs,
      'video',
      mentionedKeys,
    )
    const primaryRef = referenceImages[0]
    const effectivePrompt = primaryRef ? buildPromptWithRefImage(mergedText, primaryRef) : mergedText
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'video',
        prompt: effectivePrompt,
        model,
        status: 'generating',
        metadata: JSON.stringify({ duration, aspectRatio, referenceImages, skippedMerge, mergedText }),
      },
    })
    this.completeVideo(record.id, effectivePrompt, model, duration, aspectRatio).catch(console.error)
    return record
  }

  async generateAudio(
    userId: string,
    text: string,
    options: { voice?: string; emotion?: string; language?: string; speed?: number } = {},
    refs?: StudioRefInput[],
    mentionedKeys?: string[],
  ) {
    const voice = options.voice
    await this.consumePoints(userId, 5, '音频生成')
    const { mergedText, skippedMerge } = await this.resolveMergedPrompt(text, refs, 'audio', mentionedKeys)
    const { url } = await createAudioProvider().generate(mergedText, voice)
    const storeUrl = url.startsWith('data:') ? AUDIO_PLACEHOLDER : url
    const record = await this.prisma.generationRecord.create({
      data: {
        userId,
        type: 'audio',
        prompt: mergedText,
        model: voice,
        url: storeUrl,
        status: 'completed',
        metadata: JSON.stringify({
          voice: voice ?? 'default',
          emotion: options.emotion ?? 'neutral',
          language: options.language ?? 'zh',
          speed: options.speed ?? 1,
          hasTtsData: url.startsWith('data:'),
          skippedMerge,
        }),
      },
    })
    return { ...record, url }
  }

  private async completeVideo(
    id: string,
    prompt: string,
    model?: string,
    duration?: number,
    aspectRatio?: string,
  ) {
    try {
      const { url } = await createVideoProvider().generate(prompt, { model, duration, aspectRatio })
      await this.prisma.generationRecord.update({
        where: { id },
        data: { url, status: 'completed' },
      })
    } catch (err) {
      console.error('Video generation failed:', err)
      await this.prisma.generationRecord.update({ where: { id }, data: { status: 'failed' } })
    }
  }

  private async consumePoints(userId: string, cost: number, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user || user.points < cost) {
      throw new BadRequestException('积分不足')
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { points: { decrement: cost } },
      }),
      this.prisma.pointTransaction.create({
        data: { userId, amount: -cost, reason },
      }),
    ])
  }
}
