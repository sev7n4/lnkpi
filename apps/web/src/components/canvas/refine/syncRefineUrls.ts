export function syncRefineUrls(input: {
  beforeUrl: string
  afterUrl: string
  compareBeforeUrl: string
}): { afterUrl: string; compareBeforeUrl: string; reset: boolean } {
  if (input.beforeUrl === input.afterUrl) {
    return {
      afterUrl: input.afterUrl,
      compareBeforeUrl: input.compareBeforeUrl,
      reset: false,
    }
  }
  return {
    afterUrl: input.beforeUrl,
    compareBeforeUrl: input.beforeUrl,
    reset: true,
  }
}
