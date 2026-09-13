import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { Test } from '@nestjs/testing'
import { DirectUploadService } from './direct-upload.service'
import { STORAGE_ADAPTER } from '../storage/storage.adapter'

describe('DirectUploadService Nest DI', () => {
  it('resolves with only STORAGE_ADAPTER (no optional Function param)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DirectUploadService,
        { provide: STORAGE_ADAPTER, useValue: {} },
      ],
    }).compile()
    expect(moduleRef.get(DirectUploadService)).toBeInstanceOf(DirectUploadService)
    await moduleRef.close()
  })
})
