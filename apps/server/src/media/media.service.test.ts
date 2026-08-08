import 'reflect-metadata'
import { ForbiddenException } from '@nestjs/common'
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Test } from '@nestjs/testing'
import {
  collectUrlsFromCanvasData,
  MediaService,
  sanitizeFilename,
} from './media.service'
import { PrismaService } from '../prisma/prisma.service'

const uploadsRoot = join(process.cwd(), 'uploads')

describe('collectUrlsFromCanvasData', () => {
  it('collects node url and images array', () => {
    const urls = collectUrlsFromCanvasData(
      JSON.stringify({
        nodes: [
          { data: { url: 'https://cdn.example/a.png' } },
          { data: { images: ['https://cdn.example/b.png'] } },
        ],
      }),
    )
    expect(urls).toEqual(['https://cdn.example/a.png', 'https://cdn.example/b.png'])
  })
})

describe('MediaService.resolveDownloadSource', () => {
  let service: MediaService
  const findManySessions = vi.fn()
  const findManyMaterials = vi.fn()
  const findManyRecords = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    process.env.API_PUBLIC_URL = 'http://119.29.173.89:8888'
    await mkdir(join(uploadsRoot, 'u1'), { recursive: true })
    await writeFile(join(uploadsRoot, 'u1', 'pic.png'), Buffer.from('png'))

    findManySessions.mockResolvedValue([
      {
        canvasData: JSON.stringify({
          nodes: [{ data: { url: 'https://platform-outputs.example/out.png' } }],
        }),
      },
    ])
    findManyMaterials.mockResolvedValue([])
    findManyRecords.mockResolvedValue([])

    const moduleRef = await Test.createTestingModule({
      providers: [
        MediaService,
        {
          provide: PrismaService,
          useValue: {
            session: { findMany: findManySessions },
            material: { findMany: findManyMaterials },
            generationRecord: { findMany: findManyRecords },
          },
        },
      ],
    }).compile()
    service = moduleRef.get(MediaService)
  })

  afterEach(async () => {
    await rm(join(uploadsRoot, 'u1'), { recursive: true, force: true })
  })

  it('allows owned upload file on disk', async () => {
    const source = await service.resolveDownloadSource(
      'u1',
      '/api/uploads/u1/pic.png',
      'pic.png',
    )
    expect(source.kind).toBe('disk')
    if (source.kind === 'disk') {
      expect(source.absPath).toContain('pic.png')
    }
  })

  it('rejects upload file owned by another user', async () => {
    await expect(
      service.resolveDownloadSource('u2', '/api/uploads/u1/pic.png'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('allows upstream url present in session canvas', async () => {
    const source = await service.resolveDownloadSource(
      'u1',
      'https://platform-outputs.example/out.png',
    )
    expect(source.kind).toBe('remote')
  })

  it('rejects upstream url not in user canvas', async () => {
    await expect(
      service.resolveDownloadSource('u1', 'https://evil.example/x.png'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('rejects private IP SSRF targets', async () => {
    findManySessions.mockResolvedValue([
      {
        canvasData: JSON.stringify({
          nodes: [{ data: { url: 'http://127.0.0.1:3000/x.png' } }],
        }),
      },
    ])
    await expect(
      service.resolveDownloadSource('u1', 'http://127.0.0.1:3000/x.png'),
    ).rejects.toThrow(/private|localhost|HTTP/i)
  })
})

describe('sanitizeFilename', () => {
  it('strips unsafe characters from basename', () => {
    expect(sanitizeFilename('a/b?c*.png')).toBe('b_c_.png')
  })
})
