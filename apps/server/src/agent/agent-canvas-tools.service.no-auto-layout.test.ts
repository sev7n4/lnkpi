import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'agent-canvas-tools.service.ts'),
  'utf8',
)

function sliceFn(name: string, nextName: string) {
  const start = src.indexOf(`async ${name}(`)
  const end = src.indexOf(`async ${nextName}(`)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('along-edges on write paths (Hybrid)', () => {
  it('connectNodes does not arrange', () => {
    expect(sliceFn('connectNodes', 'removeNodes')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })

  it('importWorkflow default path calls layoutNodesAlongEdges', () => {
    // arrangeAlongEdges:false skip path is covered by service tests, not this source scan
    expect(sliceFn('importWorkflow', 'groupNodes')).toMatch(/layoutNodesAlongEdges/)
  })

  it('addNodesBatch does not arrange', () => {
    expect(sliceFn('addNodesBatch', 'upsertMediaNode')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })
})
