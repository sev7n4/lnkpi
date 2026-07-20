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

export function applyRefundMeta(
  meta: Record<string, unknown>,
  refundedPoints: number,
  refundReason: string,
) {
  return { ...meta, refundedPoints, refundReason }
}
