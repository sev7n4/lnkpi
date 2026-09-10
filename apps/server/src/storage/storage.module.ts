import { Global, Module } from '@nestjs/common'
import { S3CompatibleStorageAdapter } from './s3-compatible.storage-adapter'
import { STORAGE_ADAPTER, type StorageAdapter } from './storage.adapter'
import { UnconfiguredStorageAdapter } from './unconfigured.storage-adapter'

export function createStorageAdapterFromEnv(): StorageAdapter {
  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim()
  const accessKey = process.env.OBJECT_STORAGE_ACCESS_KEY?.trim()
  const secretKey = process.env.OBJECT_STORAGE_SECRET_KEY?.trim()
  if (!endpoint || !bucket || !accessKey || !secretKey) {
    return new UnconfiguredStorageAdapter()
  }
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

@Global()
@Module({
  providers: [
    { provide: STORAGE_ADAPTER, useFactory: createStorageAdapterFromEnv },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
