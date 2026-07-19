import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import { CryptoService } from './crypto.service'
import { ProviderService } from './provider.service'
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

type PreferencesRow = {
  userId: string
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
}

type WebdavRow = {
  userId: string
  url: string
  directory: string
  username: string
  encryptedPassword: string | null
  iv: string | null
  authTag: string | null
  keyVersion: number
  connectionMode: string
  lastSyncedAt: Date | null
}

function createMemoryPrisma() {
  const channels = new Map<string, ChannelRow>()
  const preferences = new Map<string, PreferencesRow>()
  const webdav = new Map<string, WebdavRow>()
  let seq = 0

  return {
    providerChannel: {
      findUnique: async ({ where }: { where: { id?: string } }) => {
        if (where.id) return channels.get(where.id) ?? null
        return null
      },
      findFirst: async ({
        where,
      }: {
        where: { id?: string; userId?: string | null; name?: string }
      }) => {
        for (const row of channels.values()) {
          if (where.id && row.id !== where.id) continue
          if ('userId' in where && row.userId !== where.userId) continue
          if (where.name && row.name !== where.name) continue
          return row
        }
        return null
      },
      findMany: async ({
        where,
      }: { where?: { userId?: string | null }; orderBy?: unknown } = {}) => {
        return [...channels.values()].filter((row) => {
          if (!where) return true
          if ('userId' in where && row.userId !== where.userId) return false
          return true
        })
      },
      create: async ({ data }: { data: Omit<ChannelRow, 'createdAt' | 'updatedAt'> & Partial<ChannelRow> }) => {
        const now = new Date()
        const row: ChannelRow = {
          id: data.id ?? `ch_${++seq}`,
          userId: data.userId ?? null,
          name: data.name,
          apiFormat: data.apiFormat,
          baseUrl: data.baseUrl,
          encryptedApiKey: data.encryptedApiKey ?? null,
          iv: data.iv ?? null,
          authTag: data.authTag ?? null,
          keyVersion: data.keyVersion ?? 1,
          models: data.models,
          createdAt: now,
          updatedAt: now,
        }
        channels.set(row.id, row)
        return row
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string }
        data: Partial<ChannelRow>
      }) => {
        const existing = channels.get(where.id)
        if (!existing) throw new Error('not found')
        const row = { ...existing, ...data, updatedAt: new Date() }
        channels.set(where.id, row)
        return row
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const existing = channels.get(where.id)
        if (!existing) throw new Error('not found')
        channels.delete(where.id)
        return existing
      },
    },
    userAiPreferences: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        preferences.get(where.userId) ?? null,
      create: async ({ data }: { data: PreferencesRow }) => {
        preferences.set(data.userId, data)
        return data
      },
      update: async ({
        where,
        data,
      }: {
        where: { userId: string }
        data: Partial<PreferencesRow>
      }) => {
        const existing = preferences.get(where.userId)
        if (!existing) throw new Error('not found')
        const row = { ...existing, ...data }
        preferences.set(where.userId, row)
        return row
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string }
        create: PreferencesRow
        update: Partial<PreferencesRow>
      }) => {
        const existing = preferences.get(where.userId)
        if (!existing) {
          preferences.set(create.userId, create)
          return create
        }
        const row = { ...existing, ...update }
        preferences.set(where.userId, row)
        return row
      },
    },
    userWebdavConfig: {
      findUnique: async ({ where }: { where: { userId: string } }) =>
        webdav.get(where.userId) ?? null,
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { userId: string }
        create: WebdavRow
        update: Partial<WebdavRow>
      }) => {
        const existing = webdav.get(where.userId)
        if (!existing) {
          webdav.set(create.userId, create)
          return create
        }
        const row = { ...existing, ...update }
        webdav.set(where.userId, row)
        return row
      },
    },
  }
}

describe('ProviderService', () => {
  const originalKey = process.env.BYOK_ENCRYPTION_KEY_V1
  let svc: ProviderService

  beforeEach(async () => {
    process.env.BYOK_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        CryptoService,
        { provide: PrismaService, useValue: createMemoryPrisma() },
      ],
    }).compile()
    svc = moduleRef.get(ProviderService)
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.BYOK_ENCRYPTION_KEY_V1
    } else {
      process.env.BYOK_ENCRYPTION_KEY_V1 = originalKey
    }
  })

  it('bootstraps platform channel from catalog and default preferences', async () => {
    const result = await svc.bootstrap('u1')
    expect(result.platformChannel.id).toBe('platform')
    expect(result.preferences.defaultImageModel).toBe('platform::seedream-5.0-pro')
    expect(result.platformChannel.hasApiKey).toBe(false)
  })

  it('stores encrypted apiKey and never returns plaintext', async () => {
    await svc.createChannel('u1', {
      name: 'mine',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-secret',
      models: [],
    })
    const boot = await svc.bootstrap('u1')
    const ch = boot.channels.find((c) => c.name === 'mine')!
    expect(ch.hasApiKey).toBe(true)
    expect(JSON.stringify(boot)).not.toContain('sk-secret')
  })
})
