/**
 * v3 SB-D16 / §13.1 Feature Flag
 *
 * V1 实现：内存 Map 注入；默认全 off。
 * 灰度通过 setFlag() 在启动时配置；后续接 Vite env / 后台 config 时只改这一处。
 */

const flags = new Map<string, boolean>([
  ['selection_batch_generate', false], // SB-D16 默认 off
])

export function isFeatureOn(key: string): boolean {
  return flags.get(key) === true
}

export function setFlag(key: string, on: boolean): void {
  flags.set(key, on)
}

/** 在测试中重置所有 flag（**仅** test 入口使用） */
export function _resetFlagsForTest(): void {
  flags.clear()
  flags.set('selection_batch_generate', false)
}
