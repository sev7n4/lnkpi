import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { extname } from 'path'
import { parseUploadRefPath } from '@lnkpi/shared'
import { PrismaService } from '../prisma/prisma.service'
import {
  MediaService,
  mimeFromExt,
  openDownloadStream,
} from '../media/media.service'
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter'
import { UnconfiguredStorageAdapter } from '../storage/unconfigured.storage-adapter'
import {
  buildUserAssetMetadataFromGeneration,
  mergeUserAssetMetadata,
  parseUserAssetMetadata,
  serializeUserAssetMetadata,
} from './build-user-asset-metadata'

export type PersistRemoteInput = {
  userId: string
  url: string
  kind: 'image' | 'video' | 'audio'
  label?: string
  sessionId?: string
  sourceNodeId?: string
  replaceNodeUrl?: boolean
  generationRecordId?: string
}

export type PersistRemoteResult = {
  persistedUrl: string
  assetId: string
  storageTier: 'persisted' | 'upload'
}

type UserAssetRow = {
  id: string
  url: string
  label: string
  metadata: string | null
  sourceNodeId?: string | null
}

@Injectable()
export class PersistRemoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async persistRemote(input: PersistRemoteInput): Promise<PersistRemoteResult> {
    const url = input.url.trim()
    const upload = parseUploadRefPath(url)
    if (upload) {
      if (upload.userId !== input.userId) {
        throw new ForbiddenException('无权持久化该上传文件')
      }
      return this.persistUploadRef(input, url)
    }
    return this.persistRemoteUrl(input, url)
  }

  private async persistUploadRef(
    input: PersistRemoteInput,
    url: string,
  ): Promise<PersistRemoteResult> {
    const baseMeta = await this.loadGenerationMetadata(input)
    const metadata = serializeUserAssetMetadata(
      mergeUserAssetMetadata(baseMeta, { storageTier: 'upload' }),
    )

    const asset = await this.prisma.userAsset.upsert({
      where: { userId_url: { userId: input.userId, url } },
      create: {
        userId: input.userId,
        kind: input.kind,
        url,
        label: input.label ?? '',
        sourceNodeId: input.sourceNodeId,
        metadata,
      },
      update: {
        kind: input.kind,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.sourceNodeId !== undefined ? { sourceNodeId: input.sourceNodeId } : {}),
        metadata,
      },
    })

    if (input.replaceNodeUrl) {
      await this.rewriteNodeUrl({
        userId: input.userId,
        sessionId: input.sessionId,
        sourceNodeId: input.sourceNodeId,
        publicUrl: url,
        upstreamUrl: url,
        storageTier: 'upload',
      })
    }

    return {
      persistedUrl: url,
      assetId: asset.id,
      storageTier: 'upload',
    }
  }

  private async persistRemoteUrl(
    input: PersistRemoteInput,
    url: string,
  ): Promise<PersistRemoteResult> {
    const existingByUrl = await this.prisma.userAsset.findUnique({
      where: { userId_url: { userId: input.userId, url } },
    })
    if (existingByUrl) {
      const meta = parseUserAssetMetadata(existingByUrl.metadata)
      if (meta.storageTier === 'persisted') {
        return this.reusePersistedAsset(input, existingByUrl, meta.upstreamUrl ?? url)
      }
    }

    if (looksLikeObjectStoragePublicUrl(url, input.userId)) {
      return this.ensurePersistedWithoutReupload(input, url, {
        upstreamUrl: parseUserAssetMetadata(existingByUrl?.metadata).upstreamUrl,
      })
    }

    const existingByUpstream = await this.findPersistedByUpstreamUrl(input.userId, url)
    if (existingByUpstream) {
      return this.reusePersistedAsset(input, existingByUpstream, url)
    }

    this.assertStorageConfigured()

    const source = await this.media.resolveDownloadSource(
      input.userId,
      url,
      undefined,
      input.sessionId,
    )

    let stream: Awaited<ReturnType<typeof openDownloadStream>>
    try {
      stream = await openDownloadStream(source)
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw new BadGatewayException(
          err.message || '上游资源获取失败，无法持久化',
        )
      }
      throw err
    }

    const ext = extname(source.filename) || defaultExtForKind(input.kind)
    const year = String(new Date().getFullYear())
    const objectKey = `users/${input.userId}/assets/${year}/${randomUUID().replace(/-/g, '')}${ext}`
    const contentType =
      stream.contentType || mimeFromExt(source.filename) || defaultMimeForKind(input.kind)

    const { publicUrl } = await this.storage.putStream({
      key: objectKey,
      body: stream.body,
      contentType,
      contentLength: stream.contentLength,
    })

    const baseMeta = await this.loadGenerationMetadata(input)
    const metadata = serializeUserAssetMetadata(
      mergeUserAssetMetadata(baseMeta, {
        storageTier: 'persisted',
        upstreamUrl: url,
        objectKey,
      }),
    )

    const asset = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.userAsset.upsert({
        where: { userId_url: { userId: input.userId, url: publicUrl } },
        create: {
          userId: input.userId,
          kind: input.kind,
          url: publicUrl,
          label: input.label ?? '',
          sourceNodeId: input.sourceNodeId,
          metadata,
        },
        update: {
          kind: input.kind,
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.sourceNodeId !== undefined ? { sourceNodeId: input.sourceNodeId } : {}),
          metadata,
        },
      })
      if (publicUrl !== url) {
        await tx.userAsset.deleteMany({
          where: { userId: input.userId, url },
        })
      }
      return upserted
    })

    if (input.replaceNodeUrl) {
      await this.rewriteNodeUrl({
        userId: input.userId,
        sessionId: input.sessionId,
        sourceNodeId: input.sourceNodeId,
        publicUrl,
        upstreamUrl: url,
        storageTier: 'persisted',
      })
    }

    return {
      persistedUrl: publicUrl,
      assetId: asset.id,
      storageTier: 'persisted',
    }
  }

  private assertStorageConfigured(): void {
    if (this.storage instanceof UnconfiguredStorageAdapter) {
      throw new ServiceUnavailableException(
        '对象存储未配置，无法持久化收藏。请配置 OBJECT_STORAGE_* 或稍后重试',
      )
    }
  }

  private async findPersistedByUpstreamUrl(
    userId: string,
    upstreamUrl: string,
  ): Promise<UserAssetRow | null> {
    const rows = await this.prisma.userAsset.findMany({
      where: {
        userId,
        metadata: { contains: upstreamUrl },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    for (const row of rows) {
      const meta = parseUserAssetMetadata(row.metadata)
      if (meta.storageTier === 'persisted' && meta.upstreamUrl === upstreamUrl) {
        return row
      }
      if (row.url === upstreamUrl && meta.storageTier === 'persisted') {
        return row
      }
    }
    return null
  }

  private async reusePersistedAsset(
    input: PersistRemoteInput,
    asset: UserAssetRow,
    upstreamUrl: string,
  ): Promise<PersistRemoteResult> {
    const shouldUpdateLabel = input.label !== undefined && input.label !== asset.label
    const shouldUpdateSource =
      input.sourceNodeId !== undefined && input.sourceNodeId !== asset.sourceNodeId

    let assetId = asset.id
    if (shouldUpdateLabel || shouldUpdateSource) {
      const updated = await this.prisma.userAsset.update({
        where: { id: asset.id },
        data: {
          ...(shouldUpdateLabel ? { label: input.label } : {}),
          ...(shouldUpdateSource ? { sourceNodeId: input.sourceNodeId } : {}),
        },
      })
      assetId = updated.id
    }

    if (input.replaceNodeUrl) {
      await this.rewriteNodeUrl({
        userId: input.userId,
        sessionId: input.sessionId,
        sourceNodeId: input.sourceNodeId,
        publicUrl: asset.url,
        upstreamUrl,
        storageTier: 'persisted',
      })
    }

    return {
      persistedUrl: asset.url,
      assetId,
      storageTier: 'persisted',
    }
  }

  private async ensurePersistedWithoutReupload(
    input: PersistRemoteInput,
    publicUrl: string,
    opts: { upstreamUrl?: string },
  ): Promise<PersistRemoteResult> {
    const baseMeta = await this.loadGenerationMetadata(input)
    const metadata = serializeUserAssetMetadata(
      mergeUserAssetMetadata(baseMeta, {
        storageTier: 'persisted',
        ...(opts.upstreamUrl ? { upstreamUrl: opts.upstreamUrl } : {}),
      }),
    )

    const asset = await this.prisma.userAsset.upsert({
      where: { userId_url: { userId: input.userId, url: publicUrl } },
      create: {
        userId: input.userId,
        kind: input.kind,
        url: publicUrl,
        label: input.label ?? '',
        sourceNodeId: input.sourceNodeId,
        metadata,
      },
      update: {
        kind: input.kind,
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.sourceNodeId !== undefined ? { sourceNodeId: input.sourceNodeId } : {}),
        metadata,
      },
    })

    if (input.replaceNodeUrl) {
      await this.rewriteNodeUrl({
        userId: input.userId,
        sessionId: input.sessionId,
        sourceNodeId: input.sourceNodeId,
        publicUrl,
        upstreamUrl: opts.upstreamUrl ?? publicUrl,
        storageTier: 'persisted',
      })
    }

    return {
      persistedUrl: publicUrl,
      assetId: asset.id,
      storageTier: 'persisted',
    }
  }

  private async loadGenerationMetadata(
    input: PersistRemoteInput,
  ): Promise<string | null> {
    if (!input.generationRecordId) return null
    const record = await this.prisma.generationRecord.findFirst({
      where: { id: input.generationRecordId, userId: input.userId },
    })
    if (!record) return null
    return serializeUserAssetMetadata(buildUserAssetMetadataFromGeneration(record))
  }

  private async rewriteNodeUrl(args: {
    userId: string
    sessionId?: string
    sourceNodeId?: string
    publicUrl: string
    upstreamUrl: string
    storageTier: 'persisted' | 'upload'
  }) {
    if (!args.sessionId || !args.sourceNodeId) return

    const session = await this.prisma.session.findFirst({
      where: { id: args.sessionId, userId: args.userId },
    })
    if (!session) {
      throw new NotFoundException('会话不存在')
    }

    let canvas: { nodes?: Array<{ id?: string; data?: Record<string, unknown> }> }
    try {
      canvas = session.canvasData ? (JSON.parse(session.canvasData) as typeof canvas) : { nodes: [] }
    } catch {
      canvas = { nodes: [] }
    }

    const nodes = canvas.nodes ?? []
    let changed = false
    for (const node of nodes) {
      if (node.id !== args.sourceNodeId) continue
      const data = { ...(node.data ?? {}) }
      data.url = args.publicUrl
      data.upstreamUrl = args.upstreamUrl
      data.storageTier = args.storageTier
      node.data = data
      changed = true
      break
    }

    if (!changed) return

    await this.prisma.session.update({
      where: { id: session.id },
      data: { canvasData: JSON.stringify({ ...canvas, nodes }) },
    })
  }
}

/** Heuristic: object keys are `users/{userId}/assets/{year}/...`. */
export function looksLikeObjectStoragePublicUrl(url: string, userId: string): boolean {
  try {
    const pathname = new URL(url).pathname
    return pathname.includes(`/users/${userId}/assets/`)
  } catch {
    return false
  }
}

function defaultExtForKind(kind: PersistRemoteInput['kind']): string {
  switch (kind) {
    case 'video':
      return '.mp4'
    case 'audio':
      return '.mp3'
    default:
      return '.bin'
  }
}

function defaultMimeForKind(kind: PersistRemoteInput['kind']): string {
  switch (kind) {
    case 'video':
      return 'video/mp4'
    case 'audio':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}
