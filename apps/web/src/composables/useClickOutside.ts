import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/**
 * 点击目标元素外部时触发回调（capture 阶段监听，避免被画布 stopPropagation 拦截）。
 * 用于各类弹出卡片点击空白自动收起。
 */
export function useClickOutside(target: Ref<HTMLElement | null>, handler: () => void) {
  function onPointerDown(event: PointerEvent) {
    const el = target.value
    if (!el) return
    const node = event.target as Node | null
    if (node && el.contains(node)) return
    handler()
  }

  onMounted(() => document.addEventListener('pointerdown', onPointerDown, true))
  onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))
}
