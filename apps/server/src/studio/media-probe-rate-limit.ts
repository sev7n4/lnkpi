import { HttpException, HttpStatus } from '@nestjs/common'

const RATE_WINDOW_MS = 60_000
const RATE_LIMIT = 30

const probeTimestamps = new Map<string, number[]>()

export function checkMediaProbeRateLimit(userId: string): void {
  const now = Date.now()
  const recent = (probeTimestamps.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_LIMIT) {
    throw new HttpException('media probe rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS)
  }
  recent.push(now)
  probeTimestamps.set(userId, recent)
}

export function resetMediaProbeRateLimitForTests(): void {
  probeTimestamps.clear()
}
