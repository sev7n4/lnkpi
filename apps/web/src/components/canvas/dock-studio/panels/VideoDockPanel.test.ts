/** @vitest-environment node */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const panelSrc = readFileSync(resolve(import.meta.dirname, 'VideoDockPanel.vue'), 'utf8')

describe('VideoDockPanel bottom dock', () => {
  it('does not render model capability badges', () => {
    expect(panelSrc).not.toContain('VideoCapabilityBadges')
    expect(panelSrc).not.toContain('V·A 参考')
    expect(panelSrc).not.toContain('连续镜')
  })
})
