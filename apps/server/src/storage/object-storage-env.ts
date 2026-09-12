export function isObjectStorageConfigured(): boolean {
  const driver = process.env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase()
  if (driver === 'none') {
    return false
  }

  const endpoint = process.env.OBJECT_STORAGE_ENDPOINT?.trim()
  const bucket = process.env.OBJECT_STORAGE_BUCKET?.trim()
  const accessKey = process.env.OBJECT_STORAGE_ACCESS_KEY?.trim()
  const secretKey = process.env.OBJECT_STORAGE_SECRET_KEY?.trim()
  return !!(endpoint && bucket && accessKey && secretKey)
}
