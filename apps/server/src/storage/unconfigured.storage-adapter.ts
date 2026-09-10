import { ServiceUnavailableException } from '@nestjs/common'
import type { StorageAdapter, StoragePutInput } from './storage.adapter'

export class UnconfiguredStorageAdapter implements StorageAdapter {
  async putStream(_input: StoragePutInput): Promise<{ publicUrl: string }> {
    throw new ServiceUnavailableException(
      '对象存储未配置，无法持久化收藏。请配置 OBJECT_STORAGE_* 或稍后重试',
    )
  }
}
