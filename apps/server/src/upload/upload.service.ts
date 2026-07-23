import { mkdir, writeFile, unlink, readFile } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { BadRequestException, Injectable } from '@nestjs/common'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
/** 分片经 Vercel JSON 代理时，单片 base64 需落在 ~4.5MB 请求体限制内 */
export const UPLOAD_CHUNK_RAW_BYTES = 2 * 1024 * 1024

type ChunkSession = {
  userId: string
  fileName: string
  mimeType: string
  size: number
  totalChunks: number
  dir: string
  received: Set<number>
  createdAt: number
}

@Injectable()
export class UploadService {
  private readonly rootDir = join(process.cwd(), 'uploads')
  private readonly chunkSessions = new Map<string, ChunkSession>()

  async saveUserFile(userId: string, buffer: Buffer, originalName: string, mimeType: string) {
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`文件过大，上限 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
    }
    const safeExt = extname(originalName).slice(0, 12) || this.extFromMime(mimeType)
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`
    const userDir = join(this.rootDir, userId)
    await mkdir(userDir, { recursive: true })
    const absPath = join(userDir, fileName)
    await writeFile(absPath, buffer)
    return this.toResult(userId, fileName, originalName, mimeType, buffer.length)
  }

  async initChunkedUpload(
    userId: string,
    opts: { fileName: string; mimeType: string; size: number; totalChunks: number },
  ) {
    const size = Number(opts.size) || 0
    const totalChunks = Number(opts.totalChunks) || 0
    if (!opts.fileName?.trim()) throw new BadRequestException('缺少文件名')
    if (size <= 0 || size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`文件大小无效或超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`)
    }
    if (totalChunks <= 0 || totalChunks > 200) {
      throw new BadRequestException('分片数量无效')
    }
    this.gcChunkSessions()
    const uploadId = randomUUID()
    const dir = join(this.rootDir, '_chunks', uploadId)
    await mkdir(dir, { recursive: true })
    this.chunkSessions.set(uploadId, {
      userId,
      fileName: opts.fileName.trim(),
      mimeType: opts.mimeType || 'application/octet-stream',
      size,
      totalChunks,
      dir,
      received: new Set(),
      createdAt: Date.now(),
    })
    return { uploadId, chunkSize: UPLOAD_CHUNK_RAW_BYTES }
  }

  async saveChunk(userId: string, uploadId: string, index: number, dataBase64: string) {
    const session = this.chunkSessions.get(uploadId)
    if (!session || session.userId !== userId) {
      throw new BadRequestException('上传会话不存在或已过期')
    }
    if (!Number.isInteger(index) || index < 0 || index >= session.totalChunks) {
      throw new BadRequestException('分片序号无效')
    }
    if (!dataBase64 || typeof dataBase64 !== 'string') {
      throw new BadRequestException('分片数据为空')
    }
    let buf: Buffer
    try {
      buf = Buffer.from(dataBase64, 'base64')
    } catch {
      throw new BadRequestException('分片数据解码失败')
    }
    if (buf.length === 0 || buf.length > UPLOAD_CHUNK_RAW_BYTES + 64 * 1024) {
      throw new BadRequestException('分片过大')
    }
    await writeFile(join(session.dir, `${index}.part`), buf)
    session.received.add(index)
    return { received: session.received.size, totalChunks: session.totalChunks }
  }

  async completeChunkedUpload(userId: string, uploadId: string) {
    const session = this.chunkSessions.get(uploadId)
    if (!session || session.userId !== userId) {
      throw new BadRequestException('上传会话不存在或已过期')
    }
    if (session.received.size !== session.totalChunks) {
      throw new BadRequestException(`分片不完整：${session.received.size}/${session.totalChunks}`)
    }
    const parts: Buffer[] = []
    let total = 0
    for (let i = 0; i < session.totalChunks; i++) {
      const part = await readFile(join(session.dir, `${i}.part`))
      parts.push(part)
      total += part.length
    }
    if (total !== session.size) {
      // 允许轻微偏差（末片）；严格校验上限
      if (total > MAX_UPLOAD_BYTES) {
        throw new BadRequestException('合并后文件过大')
      }
    }
    const buffer = Buffer.concat(parts, total)
    const result = await this.saveUserFile(userId, buffer, session.fileName, session.mimeType)
    await this.cleanupChunkSession(uploadId)
    return result
  }

  private async cleanupChunkSession(uploadId: string) {
    const session = this.chunkSessions.get(uploadId)
    this.chunkSessions.delete(uploadId)
    if (!session) return
    for (let i = 0; i < session.totalChunks; i++) {
      try {
        await unlink(join(session.dir, `${i}.part`))
      } catch {
        /* ignore */
      }
    }
    try {
      const { rmdir } = await import('fs/promises')
      await rmdir(session.dir)
    } catch {
      /* ignore */
    }
  }

  private gcChunkSessions() {
    const cutoff = Date.now() - 60 * 60 * 1000
    for (const [id, s] of this.chunkSessions) {
      if (s.createdAt < cutoff) {
        void this.cleanupChunkSession(id)
      }
    }
  }

  private toResult(
    userId: string,
    storedName: string,
    originalName: string,
    mimeType: string,
    size: number,
  ) {
    const relativeUrl = `/api/uploads/${userId}/${storedName}`
    const publicBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
    return {
      url: publicBase ? `${publicBase}${relativeUrl}` : relativeUrl,
      fileName: originalName,
      mimeType: mimeType || 'application/octet-stream',
      size,
    }
  }

  private extFromMime(mime: string) {
    if (mime.startsWith('image/')) return '.png'
    if (mime.startsWith('video/')) return '.mp4'
    if (mime.startsWith('audio/')) return '.mp3'
    if (mime.startsWith('text/')) return '.txt'
    return '.bin'
  }
}
