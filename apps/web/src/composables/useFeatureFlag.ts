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

/**
 * V1.1 灰度调试入口：扫描 `location.search` 启用指定 flag。
 *
 * 用法（URL 任意一个即可）：
 *   `?feature=selection_batch_generate`              启用单个 flag
 *   `?features=selection_batch_generate,other_key`   启用多个（逗号分隔）
 *
 * 仅用于内测 / 同事试用分发；V2 灰度方案（远程 config / 运营 CMS）落地后此函数
 * 仍保留作为本地 override，但生产主路径走 V2。
 *
 * Vite 编译时会 tree-shake 掉生产未使用的 enableViaQuery 调用——如果之后删掉 main.ts
 * 的调用，本函数自然消失。
 */
export function enableViaQuery(search: string = (typeof window !== 'undefined' ? window.location.search : '')): void {
  if (!search) return
  const params = new URLSearchParams(search)
  const raw = params.get('feature') ?? params.get('features')
  if (!raw) return
  for (const name of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    flags.set(name, true)
  }
}
