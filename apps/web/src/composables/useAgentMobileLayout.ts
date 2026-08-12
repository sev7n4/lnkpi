import { onBeforeUnmount, onMounted, ref } from 'vue'

/** 与 Tailwind `md` 断点对齐：768px 以下为移动端 Agent 全屏 sheet */
export const AGENT_MOBILE_MAX_WIDTH_PX = 767

export function useAgentMobileLayout() {
  const query = `(max-width: ${AGENT_MOBILE_MAX_WIDTH_PX}px)`

  const isMobileLayout = ref(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  let mediaQuery: MediaQueryList | null = null

  function sync() {
    isMobileLayout.value = mediaQuery?.matches ?? false
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(query)
    sync()
    mediaQuery.addEventListener('change', sync)
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', sync)
  })

  return { isMobileLayout }
}
