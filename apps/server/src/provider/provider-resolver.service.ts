import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  decodeChannelModel,
  type ApiCallFormat,
  type ModelCapability,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from './crypto.service'
import { PLATFORM_CHANNEL_ID } from './provider.service'

export type ResolvedGenerationProvider = {
  channelId: string
  modelName: string
  apiFormat: ApiCallFormat
  credentials: { apiKey?: string; baseUrl: string }
  source: 'user' | 'platform'
}

@Injectable()
export class ProviderResolverService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  /**
   * Resolve channel credentials for a generation request.
   * - Bare / undecodable model values → platform + legacy modelName
   * - User channel without apiKey → still returns source:'user' (caller may fail into fallback_pending)
   */
  async resolveForGeneration(
    userId: string,
    modelValue: string | undefined,
    _modality: ModelCapability,
  ): Promise<ResolvedGenerationProvider> {
    const decoded = modelValue ? decodeChannelModel(modelValue) : null
    const channelId = decoded?.channelId ?? PLATFORM_CHANNEL_ID
    const modelName = decoded?.modelName ?? (modelValue ?? '')

    if (channelId === PLATFORM_CHANNEL_ID) {
      const channel = await this.prisma.providerChannel.findUnique({
        where: { id: PLATFORM_CHANNEL_ID },
      })
      const baseUrl =
        channel?.baseUrl || process.env.OPENAI_BASE_URL || ''
      const apiKey = process.env.OPENAI_API_KEY || undefined
      return {
        channelId: PLATFORM_CHANNEL_ID,
        modelName,
        apiFormat: (channel?.apiFormat as ApiCallFormat) ?? 'openai',
        credentials: { apiKey, baseUrl },
        source: 'platform',
      }
    }

    const channel = await this.prisma.providerChannel.findUnique({
      where: { id: channelId },
    })
    if (!channel || channel.userId !== userId) {
      throw new NotFoundException('channel not found')
    }

    let apiKey: string | undefined
    if (channel.encryptedApiKey && channel.iv && channel.authTag) {
      apiKey = this.crypto.decrypt({
        ciphertext: channel.encryptedApiKey,
        iv: channel.iv,
        authTag: channel.authTag,
        keyVersion: channel.keyVersion,
      })
    }

    return {
      channelId,
      modelName,
      apiFormat: channel.apiFormat as ApiCallFormat,
      credentials: { apiKey, baseUrl: channel.baseUrl },
      source: 'user',
    }
  }
}
