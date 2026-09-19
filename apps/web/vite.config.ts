import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  // @lnkpi/shared 通过 pnpm symlink 解析到 packages/shared/src（见其 package.json main 字段）。
  // Vite 6 默认 optimizeDeps 不包含 workspace TS src，selectionBatchGenerate 等模块
  // 会被 tree-shake 误删——生产 bundle 里 planSelectionGenerate 函数体丢失，
  // multiSelectPlan 调它时抛 'planSelectionGenerate is not a function'，被 Vue 静默
  // 吞掉 → runCount=0 → 按钮 disabled → 点击无反应。强制 include 让 esbuild 预构建保留 export。
  optimizeDeps: {
    include: ['@lnkpi/shared'],
  },
})
