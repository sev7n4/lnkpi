import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { CryptoService } from './crypto.service'
import { PLATFORM_CHANNEL_ID } from './provider.service'
import { ProviderResolverService } from './provider-resolver.service'
import { PrismaService } from '../prisma/prisma.service'

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

function createMemoryPrisma(seed: ChannelRow[] = []) {
  const channels = new Map<string, ChannelRow>(seed.map((row) => [row.id, row]))
  return {
    providerChannel: {
      findUnique: async ({ where }: { where: { id?: string } }) => {
        if (where.id) return channels.get(where.id) ?? null
        return null
      },
    },
    _channels: channels,
  }
}

describe('ProviderResolverService', () => {
  const originalKey = process.env.BYOK_ENCRYPTION_KEY_V1
  const originalOpenAiKey = process.env.OPENAI_API_KEY
  const originalOpenAiBase = process.env.OPENAI_BASE_URL
  let resolver: ProviderResolverService
  let crypto: CryptoService
  let prisma: ReturnType<typeof createMemoryPrisma>

  beforeEach(async () => {
    process.env.BYOK_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
    process.env.OPENAI_API_KEY = 'platform-env-key'
    process.env.OPENAI_BASE_URL = 'https://platform.example.com/v1'
    prisma = createMemoryPrisma([
      {
        id: PLATFORM_CHANNEL_ID,
        userId: null,
        name: '平台服务',
        apiFormat: 'openai',
        baseUrl: 'https://platform.example.com/v1',
        encryptedApiKey: null,
        iv: null,
        authTag: null,
        keyVersion: 1,
        models: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderResolverService,
        CryptoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    resolver = moduleRef.get(ProviderResolverService)
    crypto = moduleRef.get(CryptoService)
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env.BYOK_ENCRYPTION_KEY_V1
    else process.env.BYOK_ENCRYPTION_KEY_V1 = originalKey
    if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAiKey
    if (originalOpenAiBase === undefined) delete process.env.OPENAI_BASE_URL
    else process.env.OPENAI_BASE_URL = originalOpenAiBase
  })

  it('decrypts user channel credentials', async () => {
    const enc = crypto.encrypt('sk-user-secret')
    prisma._channels.set('ch_user', {
      id: 'ch_user',
      userId: 'u1',
      name: 'mine',
      apiFormat: 'openai',
      baseUrl: 'https://user.example.com/v1',
      encryptedApiKey: enc.ciphertext,
      iv: enc.iv,
      authTag: enc.authTag,
      keyVersion: enc.keyVersion,
      models: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await resolver.resolveForGeneration('u1', 'ch_user::gpt-custom', 'text')
    expect(result).toEqual({
      channelId: 'ch_user',
      modelName: 'gpt-custom',
      apiFormat: 'openai',
      credentials: { apiKey: 'sk-user-secret', baseUrl: 'https://user.example.com/v1' },
      source: 'user',
    })
  })

  it('resolves platform channel from env credentials', async () => {
    const result = await resolver.resolveForGeneration('u1', 'platform::seedream-5.0-pro', 'image')
    expect(result).toEqual({
      channelId: 'platform',
      modelName: 'seedream-5.0-pro',
      apiFormat: 'openai',
      credentials: {
        apiKey: 'platform-env-key',
        baseUrl: 'https://platform.example.com/v1',
      },
      source: 'platform',
    })
  })

  it('treats legacy bare model keys as platform', async () => {
    const result = await resolver.resolveForGeneration('u1', 'seedream-5.0-pro', 'image')
    expect(result.channelId).toBe('platform')
    expect(result.modelName).toBe('seedream-5.0-pro')
    expect(result.source).toBe('platform')
  })

  it('returns user source without apiKey when channel has no secret', async () => {
    prisma._channels.set('ch_nokey', {
      id: 'ch_nokey',
      userId: 'u1',
      name: 'empty',
      apiFormat: 'openai',
      baseUrl: 'https://user.example.com/v1',
      encryptedApiKey: null,
      iv: null,
      authTag: null,
      keyVersion: 1,
      models: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const result = await resolver.resolveForGeneration('u1', 'ch_nokey::m1', 'text')
    expect(result.source).toBe('user')
    expect(result.credentials.apiKey).toBeUndefined()
    expect(result.credentials.baseUrl).toBe('https://user.example.com/v1')
  })

  it('returns 404 for cross-user channel access', async () => {
    prisma._channels.set('ch_other', {
      id: 'ch_other',
      userId: 'u2',
      name: 'other',
      apiFormat: 'openai',
      baseUrl: 'https://other.example.com/v1',
      encryptedApiKey: null,
      iv: null,
      authTag: null,
      keyVersion: 1,
      models: '[]',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await expect(
      resolver.resolveForGeneration('u1', 'ch_other::m1', 'text'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
