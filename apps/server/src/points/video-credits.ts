export function videoCredits(duration: number): number {
  if (duration >= 15) return 70
  if (duration >= 10) return 50
  return 30
}
