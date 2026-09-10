import { Global, Module } from '@nestjs/common'
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
  // Task 3: return new S3CompatibleStorageAdapter({...})
  return new UnconfiguredStorageAdapter()
}

@Global()
@Module({
  providers: [
    { provide: STORAGE_ADAPTER, useFactory: createStorageAdapterFromEnv },
  ],
  exports: [STORAGE_ADAPTER],
})
export class StorageModule {}
