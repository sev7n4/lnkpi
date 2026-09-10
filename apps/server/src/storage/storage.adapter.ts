export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER')

export interface StoragePutInput {
  key: string
  body: NodeJS.ReadableStream
  contentType: string
  contentLength?: number
}

export interface StorageAdapter {
  putStream(input: StoragePutInput): Promise<{ publicUrl: string }>
}
