import { Global, Module } from '@nestjs/common'
import { join } from 'path'
import { LocalFilesystemStorageAdapter } from './local-filesystem.storage-adapter'
import { isObjectStorageConfigured } from './object-storage-env'
import { S3CompatibleStorageAdapter } from './s3-compatible.storage-adapter'
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter'
import { UnconfiguredStorageAdapter } from './unconfigured.storage-adapter'

/**
 * Prefer COS/S3 when OBJECT_STORAGE_* is complete; otherwise persist to local uploads/
 * (CVM disk / docker volume). Set OBJECT_STORAGE_DRIVER=none to force 503 (tests / lock-down).
 */
export function createStorageAdapterFromEnv(): StorageAdapter {
  const driver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase()
  if (driver === 'none') {
    return new UnconfiguredStorageAdapter()
  }

  if (isObjectStorageConfigured()) {
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT!.trim()
    const bucket = process.env.OBJECT_STORAGE_BUCKET!.trim()
    const accessKey = process.env.OBJECT_STORAGE_ACCESS_KEY!.trim()
    const secretKey = process.env.OBJECT_STORAGE_SECRET_KEY!.trim()
    const region = process.env.OBJECT_STORAGE_REGION?.trim()
    const publicBaseUrl = process.env.OBJECT_STORAGE_PUBLIC_BASE_URL?.trim()
    const forcePathStyleRaw = process.env.OBJECT_STORAGE_FORCE_PATH_STYLE?.trim()
    const forcePathStyle =
      forcePathStyleRaw === undefined || forcePathStyleRaw === ''
        ? undefined
        : forcePathStyleRaw === 'true'
    return new S3CompatibleStorageAdapter({
      endpoint,
      bucket,
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
      ...(region ? { region } : {}),
      ...(publicBaseUrl ? { publicBaseUrl } : {}),
      ...(forcePathStyle !== undefined ? { forcePathStyle } : {}),
    })
  }

  const rootDir =
    process.env.UPLOADS_ROOT?.trim() || join(process.cwd(), 'uploads')
  const publicBaseUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '') || undefined
  return new LocalFilesystemStorageAdapter({
    rootDir,
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
  })
}

@Global()
@Module({
  providers: [
    { provide: STORAGE_ADAPTER, useFactory: createStorageAdapterFromEnv },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
