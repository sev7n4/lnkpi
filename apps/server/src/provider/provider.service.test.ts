import 'reflect-metadata'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { CryptoService } from './crypto.service'
import { ProviderService } from './provider.service'
import { WebdavService } from './webdav.service'
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

type SessionRow = {
  id: string
  userId: string
  title: string
  createdAt: Date
  updatedAt: Date
}

function createMemoryPrisma() {
  const channels = new Map<string, ChannelRow>()
  const preferences = new Map<string, PreferencesRow>()
  const webdav = new Map<string, WebdavRow>()
  const sessions = new Map<string, SessionRow>()
  let seq = 0

  return {
    _sessions: sessions,
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
      update: async ({
        where,
        data,
      }: {
        where: { userId: string }
        data: Partial<WebdavRow>
      }) => {
        const existing = webdav.get(where.userId)
        if (!existing) throw new Error('not found')
        const row = { ...existing, ...data }
        webdav.set(where.userId, row)
        return row
      },
    },
    session: {
      findMany: async ({
        where,
        select: _select,
      }: {
        where?: { userId?: string }
        orderBy?: unknown
        select?: unknown
      } = {}) => {
        return [...sessions.values()]
          .filter((row) => !where?.userId || row.userId === where.userId)
          .map((row) => ({
            id: row.id,
            title: row.title,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          }))
      },
    },
  }
}

describe('ProviderService', () => {
  const originalKey = process.env.BYOK_ENCRYPTION_KEY_V1
  let svc: ProviderService
  let prisma: ReturnType<typeof createMemoryPrisma>

  beforeEach(async () => {
    process.env.BYOK_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 7).toString('base64')
    prisma = createMemoryPrisma()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        CryptoService,
        WebdavService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    svc = moduleRef.get(ProviderService)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('rejects create/update with unsafe baseUrl as 400', async () => {
    await expect(
      svc.createChannel('u1', {
        name: 'bad',
        apiFormat: 'openai',
        baseUrl: 'http://127.0.0.1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException)

    const ch = await svc.createChannel('u1', {
      name: 'ok',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
    })
    await expect(
      svc.updateChannel('u1', ch.id, { baseUrl: 'https://169.254.169.254' }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects rename to reserved or duplicate channel name', async () => {
    const a = await svc.createChannel('u1', {
      name: 'alpha',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
    })
    await svc.createChannel('u1', {
      name: 'beta',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
    })

    await expect(svc.updateChannel('u1', a.id, { name: 'platform' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    await expect(svc.updateChannel('u1', a.id, { name: 'beta' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('rejects pullModels redirects instead of following them', async () => {
    const ch = await svc.createChannel('u1', {
      name: 'pull',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 302,
      ok: false,
      headers: { get: () => 'https://169.254.169.254/models' },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(svc.pullModels('u1', ch.id)).rejects.toBeInstanceOf(BadRequestException)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('pullModels infers capability and preserves prior tags', async () => {
    const ch = await svc.createChannel('u1', {
      name: 'pull-cap',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      models: [{ name: 'custom-img', capability: 'image' }],
    })

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        data: [
          { id: 'custom-img' },
          { id: 'dall-e-3' },
          { id: 'gpt-4o' },
          { id: 'kling-v2' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const updated = await svc.pullModels('u1', ch.id)
    const byName = Object.fromEntries(updated.models.map((m) => [m.name, m.capability]))
    expect(byName['custom-img']).toBe('image')
    expect(byName['dall-e-3']).toBe('image')
    expect(byName['gpt-4o']).toBe('text')
    expect(byName['kling-v2']).toBe('video')
  })

  it('rejects intranet WebDAV URL on update and test', async () => {
    await expect(
      svc.updateWebdav('u1', { url: 'https://10.0.0.5/webdav' }),
    ).rejects.toBeInstanceOf(BadRequestException)

    await svc.updateWebdav('u1', {
      url: 'https://dav.example.com/webdav',
      directory: 'lnkpi',
      username: 'alice',
      password: 'dav-secret',
    })

    // Force stored URL to an intranet host to exercise test-time SSRF guard
    const row = await prisma.userWebdavConfig.findUnique({ where: { userId: 'u1' } })
    await prisma.userWebdavConfig.update({
      where: { userId: 'u1' },
      data: { ...row!, url: 'https://169.254.169.254/latest' },
    })

    await expect(svc.testWebdav('u1')).rejects.toBeInstanceOf(BadRequestException)
  })

  it('encrypts WebDAV password and bootstrap never returns plaintext', async () => {
    const password = 'webdav-plain-secret'
    const publicCfg = await svc.updateWebdav('u1', {
      url: 'https://dav.example.com/webdav',
      directory: 'lnkpi',
      username: 'alice',
      password,
    })

    expect(publicCfg).toMatchObject({
      url: 'https://dav.example.com/webdav',
      hasPassword: true,
      connectionMode: 'proxy',
    })
    expect(JSON.stringify(publicCfg)).not.toContain(password)

    const stored = await prisma.userWebdavConfig.findUnique({ where: { userId: 'u1' } })
    expect(stored?.encryptedPassword).toBeTruthy()
    expect(stored?.encryptedPassword).not.toBe(password)
    expect(stored?.iv).toBeTruthy()
    expect(stored?.authTag).toBeTruthy()

    const boot = await svc.bootstrap('u1')
    expect(boot.webdav?.hasPassword).toBe(true)
    expect(JSON.stringify(boot)).not.toContain(password)
    expect(boot.webdav && 'password' in boot.webdav).toBe(false)
    expect(boot.webdav && 'encryptedPassword' in boot.webdav).toBe(false)
  })

  it('syncWebdav uploads sessions list JSON without API keys', async () => {
    await svc.createChannel('u1', {
      name: 'mine',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-never-sync',
    })
    await svc.updateWebdav('u1', {
      url: 'https://dav.example.com/webdav',
      directory: 'lnkpi',
      username: 'alice',
      password: 'dav-pass',
    })
    prisma._sessions.set('s1', {
      id: 's1',
      userId: 'u1',
      title: 'Canvas A',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    })

    const fetchMock = vi.fn().mockResolvedValue({ status: 201, ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const result = await svc.syncWebdav('u1')
    expect(result?.lastSyncedAt).toBeInstanceOf(Date)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.method).toBe('PUT')
    const body = String(init.body)
    expect(body).toContain('Canvas A')
    expect(body).toContain('"sessions"')
    expect(body).not.toContain('sk-never-sync')
    expect(body).not.toContain('dav-pass')
    expect(body).not.toContain('encryptedApiKey')
  })
})
