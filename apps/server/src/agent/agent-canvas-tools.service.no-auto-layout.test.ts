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

describe('no auto along-edges on write paths', () => {
  it('connectNodes does not arrange', () => {
    expect(sliceFn('connectNodes', 'removeNodes')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })

  it('importWorkflow does not arrange', () => {
    expect(sliceFn('importWorkflow', 'groupNodes')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })

  it('addNodesBatch does not arrange', () => {
    expect(sliceFn('addNodesBatch', 'upsertMediaNode')).not.toMatch(/layoutNodesAlongEdges|arrangeNodesAlongEdges/)
  })
})
