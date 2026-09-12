import type { Readable } from 'stream'

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER')

export interface StoragePutInput {
  key: string
  body: Readable
  contentType: string
  contentLength?: number
}

export interface StoragePresignPutInput {
  key: string
  contentType: string
  expiresInSeconds: number
}

export interface StoragePresignPutResult {
  putUrl: string
  headers: Record<string, string>
  publicUrl: string
  expiresAt: string
}

export interface StorageAdapter {
  putStream(input: StoragePutInput): Promise<{ publicUrl: string }>
  presignPut?(input: StoragePresignPutInput): Promise<StoragePresignPutResult>
}
