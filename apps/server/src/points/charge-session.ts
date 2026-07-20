import { BadRequestException } from '@nestjs/common'

export function createCancelFlag(req: {
  on(event: string, cb: () => void): void
  aborted?: boolean
}) {
  let cancelled = Boolean(req.aborted)
  req.on('close', () => {
    cancelled = true
  })
  return { isCancelled: () => cancelled }
}

export function applyChargeMeta(meta: Record<string, unknown>, chargedPoints: number) {
  return { ...meta, chargedPoints }
}

export function alreadyRefunded(meta: Record<string, unknown>): boolean {
  return typeof meta.refundedPoints === 'number' && meta.refundedPoints > 0
}

export function isCancelledMeta(meta: Record<string, unknown>): boolean {
  return meta.cancelled === true
}

export function applyRefundMeta(
  meta: Record<string, unknown>,
  refundedPoints: number,
  refundReason: string,
) {
  return { ...meta, refundedPoints, refundReason }
}

export function throwCancelledException(refundedPoints: number): never {
  throw new BadRequestException({ message: '已取消', refundedPoints })
}

export function isCancelledException(err: unknown): boolean {
  if (!(err instanceof BadRequestException)) return false
  const response = err.getResponse()
  if (typeof response === 'string') return response === '已取消'
  if (response && typeof response === 'object') {
    return (response as { message?: unknown }).message === '已取消'
  }
  return false
}

export function rethrowWithRefundedPoints(err: unknown, refundedPoints: number): never {
  if (err instanceof BadRequestException) {
    const response = err.getResponse()
    if (typeof response === 'object' && response !== null && !Array.isArray(response)) {
      throw new BadRequestException({ ...(response as Record<string, unknown>), refundedPoints })
    }
    const message = typeof response === 'string' ? response : '请求失败'
    throw new BadRequestException({ message, refundedPoints })
  }
  const message = err instanceof Error ? err.message : '生成失败'
  throw new BadRequestException({ message, refundedPoints })
}
