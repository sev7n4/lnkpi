<script setup lang="ts">
import { BRAND_LOGO_URL } from '@/constants/brand'

defineProps<{
  active?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>()

const sizeMap = {
  xs: 30,
  sm: 40,
  md: 46,
  lg: 56,
}
</script>

<template>
  <div
    class="neo-agent-logo"
    :class="{ 'is-active': active }"
    :style="{ '--logo-size': `${sizeMap[size ?? 'md']}px` }"
  >
    <span class="neo-agent-logo__aura" />
    <span class="neo-agent-logo__ring">
      <img :src="BRAND_LOGO_URL" alt="超创助手" class="neo-agent-logo__img" draggable="false">
    </span>
  </div>
</template>

<style scoped>
.neo-agent-logo {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--logo-size);
  height: var(--logo-size);
}

.neo-agent-logo__ring {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 50%;
  background: transparent;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.28s ease, border-color 0.28s ease;
}

.neo-agent-logo__img {
  width: 88%;
  height: 88%;
  object-fit: contain;
  background: transparent;
  filter: drop-shadow(0 2px 10px rgba(99, 102, 241, 0.35));
}

.neo-agent-logo__aura {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.04),
    rgba(255, 255, 255, 0.04) 175deg,
    rgba(176, 184, 214, 0.28) 255deg,
    rgba(228, 233, 248, 0.42) 300deg,
    rgba(176, 184, 214, 0.28) 345deg,
    rgba(255, 255, 255, 0.04) 360deg
  );
  opacity: 0.65;
  animation: neo-agent-aura-spin 8s linear infinite;
  pointer-events: none;
}

.neo-agent-logo.is-active .neo-agent-logo__ring,
.neo-agent-logo:hover .neo-agent-logo__ring {
  transform: scale(1.06);
  border-color: rgba(255, 255, 255, 0.22);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 16px 1px rgba(170, 178, 205, 0.22);
}

.neo-agent-logo.is-active .neo-agent-logo__aura {
  opacity: 0.95;
  animation-duration: 4s;
}

@keyframes neo-agent-aura-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
