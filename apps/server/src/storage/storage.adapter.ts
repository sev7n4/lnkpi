import type { Readable } from 'stream'

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER')

export interface StoragePutInput {
  key: string
  body: Readable
  contentType: string
  contentLength?: number
}

export interface StorageAdapter {
  putStream(input: StoragePutInput): Promise<{ publicUrl: string }>
}
