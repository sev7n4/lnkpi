import { validateWorkflow, type WorkflowDocument } from './workflowExchange'

const COMPILE_FAILED_MESSAGE = '这版构图还不能放到画布，请稍后再试或简化步骤。'
const MAX_DUMP_NODES = 24
const SOURCE_ID = /^image-src-/

export type CompositionLintOk = { ok: true }
export type CompositionLintFail = {
  ok: false
  code: 'compile_failed'
  message: string
}
export type CompositionLintResult = CompositionLintOk | CompositionLintFail

function compileFailed(): CompositionLintFail {
  return { ok: false, code: 'compile_failed', message: COMPILE_FAILED_MESSAGE }
}

export function lintCompositionDump(dump: WorkflowDocument): CompositionLintResult {
  try {
    validateWorkflow(dump)
  } catch {
    return compileFailed()
  }

  if (dump.graph.nodes.length > MAX_DUMP_NODES) return compileFailed()
  if (JSON.stringify(dump).includes('data:image')) return compileFailed()
  if (hasCycle(dump.graph.edges)) return compileFailed()

  for (const node of dump.graph.nodes) {
    if (node.data.status !== 'draft') return compileFailed()
    if (SOURCE_ID.test(node.id) && node.data.genMode !== undefined) return compileFailed()
  }

  return { ok: true }
}

export function hashCompositionDump(dump: WorkflowDocument): string {
  return sha256Hex(JSON.stringify(dump))
}

/** UTF-8 SHA-256 hex, browser-safe (must match node:crypto for the same string). */
function sha256Hex(message: string): string {
  const bytes = sha256Bytes(new TextEncoder().encode(message))
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const bitLen = message.length * 8
  const paddedLen = ((message.length + 9 + 63) & ~63) >>> 0
  const padded = new Uint8Array(paddedLen)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLen - 4, bitLen >>> 0)
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000))

  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let a = h[0]
    let b = h[1]
    let c = h[2]
    let d = h[3]
    let e = h[4]
    let f = h[5]
    let g = h[6]
    let hh = h[7]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (hh + S1 + ch + k[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i])
  return out
}

export function summarizeCompositionDump(
  dump: WorkflowDocument,
  opts: { existingNodeCount: number },
): string {
  const ids = dump.graph.nodes.map((node) => node.id)
  const added = ids.filter((id) => !id.startsWith('image-src-')).length
  const parts = ['请确认是否把构图落到画布']

  if (ids.includes('image-i0')) {
    parts.push('新建白底三视图')
  } else if (ids.some((id) => id.startsWith('image-look-'))) {
    parts.push('沿用 I1 作为 I0')
  }

  const lookCount = ids.filter((id) => id.startsWith('image-look-')).length
  if (lookCount > 0) {
    parts.push(`服装扇出 ${lookCount}`)
  }
  if (ids.includes('text-p') && ids.includes('video-v')) {
    parts.push('P+V')
  }

  parts.push(`保留 ${opts.existingNodeCount}`)
  parts.push(`新增 ${added}`)
  parts.push('生成请用 Dock 生成工作流')
  return parts.join('\n')
}

function hasCycle(edges: Array<{ source: string; target: string }>): boolean {
  const adj = new Map<string, string[]>()
  const nodes = new Set<string>()
  for (const edge of edges) {
    nodes.add(edge.source)
    nodes.add(edge.target)
    const next = adj.get(edge.source)
    if (next) next.push(edge.target)
    else adj.set(edge.source, [edge.target])
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }

  for (const id of nodes) {
    if (dfs(id)) return true
  }
  return false
}
