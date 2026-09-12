import { BadRequestException } from '@nestjs/common'
import { createWriteStream } from 'fs'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export type LocalFilesystemStorageConfig = {
  /** Absolute or cwd-relative uploads root (same as Nest static `/api/uploads/`). */
  rootDir: string
  /** Optional `API_PUBLIC_URL` so returned URLs are absolute for clients. */
  publicBaseUrl?: string
}

/**
 * Persist streams onto the CVM (or local) uploads volume.
 * Public URL shape matches existing upload refs: `/api/uploads/{userId}/{fileName}`.
 */
export class LocalFilesystemStorageAdapter implements StorageAdapter {
  constructor(private readonly config: LocalFilesystemStorageConfig) {}

  async putStream(input: StoragePutInput): Promise<{ publicUrl: string }> {
    const { userId, fileName } = resolveUploadTarget(input.key)
    const userDir = join(this.config.rootDir, userId)
    await mkdir(userDir, { recursive: true })
    const absPath = join(userDir, fileName)
    if (!absPath.startsWith(userDir)) {
      throw new BadRequestException('非法存储路径')
    }
    await pipeline(input.body, createWriteStream(absPath))
    const relativeUrl = `/api/uploads/${userId}/${fileName}`
    const base = this.config.publicBaseUrl?.replace(/\/$/, '')
    return { publicUrl: base ? `${base}${relativeUrl}` : relativeUrl }
  }
}

/** Map persist key `users/{userId}/assets/{year}/{uuid}.ext` → flat upload path. */
export function resolveUploadTarget(key: string): { userId: string; fileName: string } {
  const parts = key.split('/').filter(Boolean)
  if (parts[0] !== 'users' || !parts[1] || parts.length < 3) {
    throw new BadRequestException('非法存储 key')
  }
  if (parts.some((p) => p === '..' || p.includes('\\') || p.includes('\0'))) {
    throw new BadRequestException('非法存储 key')
  }
  const userId = parts[1]
  const fileName = parts[parts.length - 1]
  if (!userId || !fileName || fileName.includes('/')) {
    throw new BadRequestException('非法存储 key')
  }
  return { userId, fileName }
}
