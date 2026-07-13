import { mkdir, writeFile } from 'fs/promises'
import { join, extname } from 'path'
import { randomUUID } from 'crypto'
import { Injectable } from '@nestjs/common'

@Injectable()
export class UploadService {
  private readonly rootDir = join(process.cwd(), 'uploads')

  async saveUserFile(userId: string, buffer: Buffer, originalName: string, mimeType: string) {
    const safeExt = extname(originalName).slice(0, 12) || this.extFromMime(mimeType)
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`
    const userDir = join(this.rootDir, userId)
    await mkdir(userDir, { recursive: true })
    const absPath = join(userDir, fileName)
    await writeFile(absPath, buffer)
    const relativeUrl = `/api/uploads/${userId}/${fileName}`
    const publicBase = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
    return {
      url: publicBase ? `${publicBase}${relativeUrl}` : relativeUrl,
      fileName: originalName,
      mimeType: mimeType || 'application/octet-stream',
      size: buffer.length,
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
