import { ServiceUnavailableException } from '@nestjs/common'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export class UnconfiguredStorageAdapter implements StorageAdapter {
  async putStream(_input: StoragePutInput): Promise<{ publicUrl: string }> {
    throw new ServiceUnavailableException(
      '存储未启用（OBJECT_STORAGE_DRIVER=none），无法持久化收藏',
    )
  }
}
