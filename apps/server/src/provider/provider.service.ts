import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  STUDIO_MODEL_CATALOG,
  defaultModelKey,
  encodeChannelModel,
  type ApiCallFormat,
  type ModelCapability,
  type StudioModality,
} from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import { CryptoService } from './crypto.service'
import { assertSafeOutboundUrl } from './ssrf'
import { WebdavService } from './webdav.service'

export const PLATFORM_CHANNEL_ID = 'platform'

export type ChannelModelEntry = {
  name: string
  capability: ModelCapability
}

export type ChannelPublic = {
  id: string
  name: string
  apiFormat: ApiCallFormat
  baseUrl: string
  models: ChannelModelEntry[]
  hasApiKey: boolean
  apiKeyMask?: string
  readOnly: boolean
  createdAt: Date
  updatedAt: Date
}

export type PreferencesPublic = {
  selectableImageModels: string[]
  selectableVideoModels: string[]
  selectableTextModels: string[]
  selectableAudioModels: string[]
  defaultImageModel: string
  defaultVideoModel: string
  defaultTextModel: string
  defaultAudioModel: string
  canvasImageCount: number
  audioVoice: string
  audioFormat: string
  audioSpeed: number
  audioInstructions: string | null
  systemPrompt: string | null
}

export type WebdavPublic = {
  url: string
  directory: string
  username: string
  hasPassword: boolean
  connectionMode: 'proxy'
  lastSyncedAt: Date | null
}

export type CreateChannelInput = {
  name: string
  apiFormat: ApiCallFormat
  baseUrl: string
  apiKey?: string
  models?: ChannelModelEntry[]
}

export type UpdateChannelInput = {
  name?: string
  apiFormat?: ApiCallFormat
  baseUrl?: string
  apiKey?: string
  clearApiKey?: boolean
  models?: ChannelModelEntry[]
}

export type UpdatePreferencesInput = {
  selectableImageModels?: string[]
  selectableVideoModels?: string[]
  selectableTextModels?: string[]
  selectableAudioModels?: string[]
  defaultImageModel?: string
  defaultVideoModel?: string
  defaultTextModel?: string
  defaultAudioModel?: string
  canvasImageCount?: number
  audioVoice?: string
  audioFormat?: string
  audioSpeed?: number
  audioInstructions?: string | null
  systemPrompt?: string | null
}

export type UpdateWebdavInput = {
  url?: string
  directory?: string
  username?: string
  password?: string
  clearPassword?: boolean
}

type ChannelRow = {
  id: string
  userId: string | null
  name: string
  apiFormat: string
  baseUrl: string
  encryptedApiKey: string | null
  iv: string | null
  authTag: string | null
  keyVersion: number
  models: string
  createdAt: Date
  updatedAt: Date
}

function parseModelsJson(raw: string): ChannelModelEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ChannelModelEntry =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ChannelModelEntry).name === 'string' &&
        typeof (item as ChannelModelEntry).capability === 'string',
    )
  } catch {
    return []
  }
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function maskApiKey(plaintext: string): string {
  if (plaintext.length <= 4) return '••••'
  const prefix = plaintext.slice(0, Math.min(3, plaintext.length - 4))
  return `${prefix}…${plaintext.slice(-4)}`
}

function catalogModels(): ChannelModelEntry[] {
  return STUDIO_MODEL_CATALOG.map((entry) => ({
    name: entry.modelKey,
    capability: entry.modality,
  }))
}

function defaultSelectableFor(modality: StudioModality): string[] {
  return STUDIO_MODEL_CATALOG.filter((entry) => entry.modality === modality).map((entry) =>
    encodeChannelModel(PLATFORM_CHANNEL_ID, entry.modelKey),
  )
}

function defaultPreferencesData(userId: string) {
  return {
    userId,
    selectableImageModels: JSON.stringify(defaultSelectableFor('image')),
    selectableVideoModels: JSON.stringify(defaultSelectableFor('video')),
    selectableTextModels: JSON.stringify(defaultSelectableFor('text')),
    selectableAudioModels: JSON.stringify(defaultSelectableFor('audio')),
    defaultImageModel: encodeChannelModel(PLATFORM_CHANNEL_ID, defaultModelKey('image')),
    defaultVideoModel: encodeChannelModel(PLATFORM_CHANNEL_ID, defaultModelKey('video')),
    defaultTextModel: encodeChannelModel(PLATFORM_CHANNEL_ID, defaultModelKey('text')),
    defaultAudioModel: encodeChannelModel(PLATFORM_CHANNEL_ID, defaultModelKey('audio')),
    canvasImageCount: 3,
    audioVoice: 'female-shaonv',
    audioFormat: 'mp3',
    audioSpeed: 1,
    audioInstructions: null as string | null,
    systemPrompt: null as string | null,
  }
}

@Injectable()
export class ProviderService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(WebdavService) private readonly webdav: WebdavService,
  ) {}

  async bootstrap(userId: string) {
    const platformChannel = await this.ensurePlatformChannel()
    const preferences = await this.ensurePreferences(userId)
    const userChannels = await this.prisma.providerChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    })
    const webdavRow = await this.prisma.userWebdavConfig.findUnique({ where: { userId } })

    return {
      platformChannel: this.toPublicChannel(platformChannel, { readOnly: true }),
      channels: userChannels.map((ch) => this.toPublicChannel(ch, { readOnly: false })),
      preferences: this.toPublicPreferences(preferences),
      webdav: this.toPublicWebdav(webdavRow),
    }
  }

  async createChannel(userId: string, input: CreateChannelInput) {
    const name = this.assertChannelName(input.name)
    if (input.apiFormat !== 'openai' && input.apiFormat !== 'gemini') {
      throw new BadRequestException('apiFormat must be openai or gemini')
    }

    const baseUrl = this.safeOutboundUrl(input.baseUrl).toString()
    await this.assertUniqueChannelName(userId, name)

    const keyFields = this.encryptOptionalSecret(input.apiKey)
    const row = await this.prisma.providerChannel.create({
      data: {
        userId,
        name,
        apiFormat: input.apiFormat,
        baseUrl,
        models: JSON.stringify(input.models ?? []),
        ...keyFields,
      },
    })
    return this.toPublicChannel(row, { readOnly: false })
  }

  async updateChannel(userId: string, id: string, input: UpdateChannelInput) {
    if (id === PLATFORM_CHANNEL_ID) {
      throw new ForbiddenException('platform channel is read-only')
    }
    const existing = await this.requireUserChannel(userId, id)

    const data: Record<string, unknown> = {}
    if (input.name !== undefined) {
      const name = this.assertChannelName(input.name)
      if (name !== existing.name) {
        await this.assertUniqueChannelName(userId, name)
      }
      data.name = name
    }
    if (input.apiFormat !== undefined) {
      if (input.apiFormat !== 'openai' && input.apiFormat !== 'gemini') {
        throw new BadRequestException('apiFormat must be openai or gemini')
      }
      data.apiFormat = input.apiFormat
    }
    if (input.baseUrl !== undefined) {
      data.baseUrl = this.safeOutboundUrl(input.baseUrl).toString()
    }
    if (input.models !== undefined) {
      data.models = JSON.stringify(input.models)
    }

    if (input.clearApiKey === true) {
      Object.assign(data, {
        encryptedApiKey: null,
        iv: null,
        authTag: null,
        keyVersion: 1,
      })
    } else if (input.apiKey !== undefined && input.apiKey !== '') {
      Object.assign(data, this.encryptOptionalSecret(input.apiKey))
    }

    const row = await this.prisma.providerChannel.update({
      where: { id: existing.id },
      data,
    })
    return this.toPublicChannel(row, { readOnly: false })
  }

  async deleteChannel(userId: string, id: string) {
    if (id === PLATFORM_CHANNEL_ID) {
      throw new ForbiddenException('platform channel cannot be deleted')
    }
    await this.requireUserChannel(userId, id)
    await this.prisma.providerChannel.delete({ where: { id } })
    return { id }
  }

  async pullModels(userId: string, id: string) {
    const channel =
      id === PLATFORM_CHANNEL_ID
        ? await this.ensurePlatformChannel()
        : await this.requireUserChannel(userId, id)

    if (id === PLATFORM_CHANNEL_ID) {
      const models = catalogModels()
      const row = await this.prisma.providerChannel.update({
        where: { id: PLATFORM_CHANNEL_ID },
        data: { models: JSON.stringify(models) },
      })
      return this.toPublicChannel(row, { readOnly: true })
    }

    if (channel.apiFormat !== 'openai') {
      throw new BadRequestException('pull-models currently supports openai format only')
    }

    let apiKey = ''
    if (channel.encryptedApiKey && channel.iv && channel.authTag) {
      apiKey = this.crypto.decrypt({
        ciphertext: channel.encryptedApiKey,
        iv: channel.iv,
        authTag: channel.authTag,
        keyVersion: channel.keyVersion,
      })
    }
    if (!apiKey) throw new BadRequestException('apiKey is required to pull models')

    const base = this.safeOutboundUrl(channel.baseUrl)
    const modelsUrl = new URL(base.toString().replace(/\/?$/, '/') + 'models')
    this.safeOutboundUrl(modelsUrl.toString())

    const response = await fetch(modelsUrl, {
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      throw new BadRequestException('redirects are not allowed when pulling models')
    }
    if (!response.ok) {
      throw new BadRequestException(`failed to pull models (${response.status})`)
    }

    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    const models: ChannelModelEntry[] = (body.data ?? [])
      .map((item) => item.id)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .map((name) => ({ name, capability: 'text' as ModelCapability }))

    const row = await this.prisma.providerChannel.update({
      where: { id: channel.id },
      data: { models: JSON.stringify(models) },
    })
    return this.toPublicChannel(row, { readOnly: false })
  }

  async pullAllModels(userId: string) {
    const channels = await this.prisma.providerChannel.findMany({ where: { userId } })
    const results: ChannelPublic[] = []
    for (const channel of channels) {
      try {
        results.push(await this.pullModels(userId, channel.id))
      } catch {
        results.push(this.toPublicChannel(channel, { readOnly: false }))
      }
    }
    return results
  }

  async updatePreferences(userId: string, input: UpdatePreferencesInput) {
    await this.ensurePreferences(userId)

    if (input.canvasImageCount !== undefined) {
      if (
        !Number.isInteger(input.canvasImageCount) ||
        input.canvasImageCount < 1 ||
        input.canvasImageCount > 15
      ) {
        throw new BadRequestException('canvasImageCount must be an integer between 1 and 15')
      }
    }

    const data: Record<string, unknown> = {}
    if (input.selectableImageModels !== undefined) {
      data.selectableImageModels = JSON.stringify(input.selectableImageModels)
    }
    if (input.selectableVideoModels !== undefined) {
      data.selectableVideoModels = JSON.stringify(input.selectableVideoModels)
    }
    if (input.selectableTextModels !== undefined) {
      data.selectableTextModels = JSON.stringify(input.selectableTextModels)
    }
    if (input.selectableAudioModels !== undefined) {
      data.selectableAudioModels = JSON.stringify(input.selectableAudioModels)
    }
    for (const key of [
      'defaultImageModel',
      'defaultVideoModel',
      'defaultTextModel',
      'defaultAudioModel',
      'canvasImageCount',
      'audioVoice',
      'audioFormat',
      'audioSpeed',
      'audioInstructions',
      'systemPrompt',
    ] as const) {
      if (input[key] !== undefined) data[key] = input[key]
    }

    const row = await this.prisma.userAiPreferences.update({
      where: { userId },
      data,
    })
    return this.toPublicPreferences(row)
  }

  async updateWebdav(userId: string, input: UpdateWebdavInput) {
    if (input.url !== undefined && input.url.trim()) {
      this.safeOutboundUrl(input.url)
    }

    const existing = await this.prisma.userWebdavConfig.findUnique({ where: { userId } })
    const createBase = {
      userId,
      url: input.url ?? '',
      directory: input.directory ?? '',
      username: input.username ?? '',
      connectionMode: 'proxy',
      lastSyncedAt: null as Date | null,
      encryptedPassword: null as string | null,
      iv: null as string | null,
      authTag: null as string | null,
      keyVersion: 1,
    }

    let passwordFields: {
      encryptedPassword: string | null
      iv: string | null
      authTag: string | null
      keyVersion: number
    } = {
      encryptedPassword: existing?.encryptedPassword ?? null,
      iv: existing?.iv ?? null,
      authTag: existing?.authTag ?? null,
      keyVersion: existing?.keyVersion ?? 1,
    }

    if (input.clearPassword === true) {
      passwordFields = {
        encryptedPassword: null,
        iv: null,
        authTag: null,
        keyVersion: 1,
      }
    } else if (input.password !== undefined && input.password !== '') {
      const enc = this.crypto.encrypt(input.password)
      passwordFields = {
        encryptedPassword: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
        keyVersion: enc.keyVersion,
      }
    }

    const row = await this.prisma.userWebdavConfig.upsert({
      where: { userId },
      create: {
        ...createBase,
        ...passwordFields,
        url: input.url ?? '',
        directory: input.directory ?? '',
        username: input.username ?? '',
      },
      update: {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.directory !== undefined ? { directory: input.directory } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        connectionMode: 'proxy',
        ...passwordFields,
      },
    })
    return this.toPublicWebdav(row)
  }

  async testWebdav(userId: string) {
    const creds = await this.requireWebdavCredentials(userId)
    return this.webdav.testConnection(creds)
  }

  async syncWebdav(userId: string) {
    const creds = await this.requireWebdavCredentials(userId)
    const sessions = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // MVP sync payload: session list only — never API keys or encrypted secrets
    const payload = {
      exportedAt: new Date().toISOString(),
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    }

    await this.webdav.uploadJson(creds, 'sessions.json', payload)

    const row = await this.prisma.userWebdavConfig.update({
      where: { userId },
      data: { lastSyncedAt: new Date() },
    })
    return this.toPublicWebdav(row)
  }

  private async requireWebdavCredentials(userId: string) {
    const row = await this.prisma.userWebdavConfig.findUnique({ where: { userId } })
    if (!row?.url?.trim()) {
      throw new BadRequestException('WebDAV is not configured')
    }
    this.safeOutboundUrl(row.url)

    let password = ''
    if (row.encryptedPassword && row.iv && row.authTag) {
      try {
        password = this.crypto.decrypt({
          ciphertext: row.encryptedPassword,
          iv: row.iv,
          authTag: row.authTag,
          keyVersion: row.keyVersion,
        })
      } catch {
        throw new BadRequestException('failed to decrypt WebDAV password')
      }
    }

    return {
      url: row.url,
      directory: row.directory ?? '',
      username: row.username ?? '',
      password,
    }
  }

  private async ensurePlatformChannel(): Promise<ChannelRow> {
    const existing = await this.prisma.providerChannel.findUnique({
      where: { id: PLATFORM_CHANNEL_ID },
    })
    if (existing) return existing

    return this.prisma.providerChannel.create({
      data: {
        id: PLATFORM_CHANNEL_ID,
        userId: null,
        name: '平台服务',
        apiFormat: 'openai',
        baseUrl: process.env.OPENAI_BASE_URL || '',
        models: JSON.stringify(catalogModels()),
        encryptedApiKey: null,
        iv: null,
        authTag: null,
        keyVersion: 1,
      },
    })
  }

  private async ensurePreferences(userId: string) {
    const existing = await this.prisma.userAiPreferences.findUnique({ where: { userId } })
    if (existing) return existing
    return this.prisma.userAiPreferences.create({
      data: defaultPreferencesData(userId),
    })
  }

  private async requireUserChannel(userId: string, id: string): Promise<ChannelRow> {
    const channel = await this.prisma.providerChannel.findUnique({ where: { id } })
    if (!channel || channel.userId !== userId) {
      throw new NotFoundException('channel not found')
    }
    return channel
  }

  private assertChannelName(raw: string | undefined): string {
    const name = raw?.trim()
    if (!name) throw new BadRequestException('name is required')
    if (name === 'platform' || name.toLowerCase() === PLATFORM_CHANNEL_ID) {
      throw new BadRequestException('reserved channel name')
    }
    return name
  }

  private async assertUniqueChannelName(userId: string, name: string) {
    const existing = await this.prisma.providerChannel.findFirst({
      where: { userId, name },
    })
    if (existing) throw new BadRequestException('channel name already exists')
  }

  private safeOutboundUrl(url: string): URL {
    try {
      return assertSafeOutboundUrl(url, {
        allowHttpLocalhost: process.env.NODE_ENV !== 'production',
      })
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      const message = err instanceof Error ? err.message : 'Invalid URL'
      throw new BadRequestException(message)
    }
  }

  private encryptOptionalSecret(secret?: string) {
    if (!secret) {
      return {
        encryptedApiKey: null as string | null,
        iv: null as string | null,
        authTag: null as string | null,
        keyVersion: 1,
      }
    }
    const enc = this.crypto.encrypt(secret)
    return {
      encryptedApiKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyVersion: enc.keyVersion,
    }
  }

  private toPublicChannel(
    row: ChannelRow,
    opts: { readOnly: boolean },
  ): ChannelPublic {
    const hasApiKey = Boolean(row.encryptedApiKey)
    let apiKeyMask: string | undefined
    if (hasApiKey && row.encryptedApiKey && row.iv && row.authTag) {
      try {
        const plaintext = this.crypto.decrypt({
          ciphertext: row.encryptedApiKey,
          iv: row.iv,
          authTag: row.authTag,
          keyVersion: row.keyVersion,
        })
        apiKeyMask = maskApiKey(plaintext)
      } catch {
        apiKeyMask = '••••'
      }
    }

    return {
      id: row.id,
      name: row.name,
      apiFormat: row.apiFormat as ApiCallFormat,
      baseUrl: row.baseUrl,
      models: parseModelsJson(row.models),
      hasApiKey,
      ...(apiKeyMask ? { apiKeyMask } : {}),
      readOnly: opts.readOnly,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private toPublicPreferences(row: {
    selectableImageModels: string
    selectableVideoModels: string
    selectableTextModels: string
    selectableAudioModels: string
    defaultImageModel: string
    defaultVideoModel: string
    defaultTextModel: string
    defaultAudioModel: string
    canvasImageCount: number
    audioVoice: string
    audioFormat: string
    audioSpeed: number
    audioInstructions: string | null
    systemPrompt: string | null
  }): PreferencesPublic {
    return {
      selectableImageModels: parseStringArray(row.selectableImageModels),
      selectableVideoModels: parseStringArray(row.selectableVideoModels),
      selectableTextModels: parseStringArray(row.selectableTextModels),
      selectableAudioModels: parseStringArray(row.selectableAudioModels),
      defaultImageModel: row.defaultImageModel,
      defaultVideoModel: row.defaultVideoModel,
      defaultTextModel: row.defaultTextModel,
      defaultAudioModel: row.defaultAudioModel,
      canvasImageCount: row.canvasImageCount,
      audioVoice: row.audioVoice,
      audioFormat: row.audioFormat,
      audioSpeed: row.audioSpeed,
      audioInstructions: row.audioInstructions,
      systemPrompt: row.systemPrompt,
    }
  }

  private toPublicWebdav(
    row: {
      url: string
      directory: string
      username: string
      encryptedPassword: string | null
      connectionMode: string
      lastSyncedAt: Date | null
    } | null,
  ): WebdavPublic | null {
    if (!row) return null
    return {
      url: row.url,
      directory: row.directory,
      username: row.username,
      hasPassword: Boolean(row.encryptedPassword),
      connectionMode: 'proxy',
      lastSyncedAt: row.lastSyncedAt,
    }
  }
}
