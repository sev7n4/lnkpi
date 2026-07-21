import { ref, watch } from 'vue'

export type CanvasTheme = 'dark' | 'light'

const STORAGE_KEY = 'lnkpi-canvas-theme'

function loadTheme(): CanvasTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

const theme = ref<CanvasTheme>(loadTheme())

function applyTheme(value: CanvasTheme) {
  document.documentElement.setAttribute('data-canvas-theme', value)
  // 同步 Element Plus 明暗主题（el-dialog / el-input 等跟随画布主题）
  document.documentElement.classList.toggle('dark', value === 'dark')
}

applyTheme(theme.value)

watch(theme, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore
  }
  applyTheme(value)
})

export function useCanvasTheme() {
  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }

  return { theme, toggleTheme }
}
