import { extname } from 'path'
import { randomUUID } from 'crypto'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { isObjectStorageConfigured } from '../storage/object-storage-env'
import { STORAGE_ADAPTER, type StorageAdapter } from '../storage/storage.adapter'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const PRESIGN_TTL_SECONDS = 600

export type DirectUploadCredential =
  | { mode: 'local' }
  | {
      mode: 'presign'
      key: string
      putUrl: string
      headers: Record<string, string>
      expiresAt: string
      publicUrl: string
    }

@Injectable()
export class DirectUploadService {
  constructor(
    @Inject(STORAGE_ADAPTER) private readonly adapter: StorageAdapter,
  ) {}

  async createCredential(
    userId: string,
    opts: { fileName: string; mimeType: string; size: number },
  ): Promise<DirectUploadCredential> {
    const size = Number(opts.size) || 0
    if (size <= 0 || size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `文件大小无效或超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`,
      )
    }

    if (!isObjectStorageConfigured() || !this.adapter.presignPut) {
      return { mode: 'local' }
    }

    const mimeType = opts.mimeType || 'application/octet-stream'
    const key = this.buildKey(userId, opts.fileName, mimeType)
    const presigned = await this.adapter.presignPut({
      key,
      contentType: mimeType,
      expiresInSeconds: PRESIGN_TTL_SECONDS,
    })

    return {
      mode: 'presign',
      key,
      putUrl: presigned.putUrl,
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
      publicUrl: presigned.publicUrl,
    }
  }

  private buildKey(userId: string, fileName: string, mimeType: string): string {
    const now = new Date()
    const yyyy = String(now.getFullYear())
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const safeExt = extname(fileName).slice(0, 12) || this.extFromMime(mimeType)
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`
    return `uploads/${userId}/${yyyy}/${mm}/${dd}/${stamp}`
  }

  private extFromMime(mime: string) {
    if (mime.startsWith('image/')) return '.png'
    if (mime.startsWith('video/')) return '.mp4'
    if (mime.startsWith('audio/')) return '.mp3'
    if (mime.startsWith('text/')) return '.txt'
    return '.bin'
  }
}
