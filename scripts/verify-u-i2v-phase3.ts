#!/usr/bin/env npx tsx
/**
 * U-I2V Phase 3 guard: video upload paths must not write referenceImageUrl.
 *
 * Exit 0 = OK, 1 = forbidden write pattern found.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dirname, '..')

const FILES: Array<{ path: string; forbidden: RegExp[] }> = [
  {
    path: 'apps/web/src/components/canvas/dock-studio/panels/VideoDockPanel.vue',
    forbidden: [
      /emit\s*\(\s*['"]patch['"]\s*,\s*\{[^}]*referenceImageUrl/s,
    ],
  },
  {
    path: 'apps/web/src/pages/CanvasPage.vue',
    forbidden: [
      /nodeType === 'video'\)\s*return\s*\{\s*referenceImageUrl:/,
    ],
  },
  {
    path: 'apps/web/src/composables/useNodeGeneration.ts',
    forbidden: [
      /startVideoGeneration\([\s\S]{0,500}?refImage/s,
      /startVideoGeneration[\s\S]{0,800}patchNodeData\(node\.id, \{[\s\S]{0,200}referenceImageUrl/s,
    ],
  },
]

let failed = false

for (const { path, forbidden } of FILES) {
  const full = join(ROOT, path)
  const src = readFileSync(full, 'utf8')
  for (const re of forbidden) {
    if (re.test(src)) {
      console.error(`❌ ${path}: forbidden referenceImageUrl write pattern: ${re}`)
      failed = true
    }
  }
}

if (failed) {
  process.exit(1)
}

console.log('✅ U-I2V Phase 3: no forbidden referenceImageUrl writes in video paths')
process.exit(0)
