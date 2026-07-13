#!/usr/bin/env node
/** Docker build 阶段：将 workspace 包入口指向 dist，便于 Nest CJS 运行时 require */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const packages = ['packages/shared/package.json', 'packages/agent/package.json']

for (const rel of packages) {
  const file = path.join(root, rel)
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  delete pkg.type
  pkg.main = './dist/index.js'
  pkg.types = './dist/index.d.ts'
  pkg.exports = {
    '.': {
      types: './dist/index.d.ts',
      default: './dist/index.js',
    },
  }
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`)
  console.log(`patched ${rel}`)
}
