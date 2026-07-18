<script setup lang="ts">
import { computed } from 'vue'
import { dockTypeToIcon, type DockNodeIconKind } from './dockIcons'

const props = defineProps<{
  type?: string
  icon?: DockNodeIconKind
  size?: number
}>()

const kind = computed(() => props.icon ?? dockTypeToIcon(props.type ?? 'text'))
const px = computed(() => props.size ?? 16)
</script>

<template>
  <svg
    :width="px"
    :height="px"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="kind === 'text'">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </template>
    <template v-else-if="kind === 'image'">
      <rect x="2.5" y="3" width="19" height="18" rx="3" stroke-width="1.5" />
      <circle cx="8" cy="9" r="2" stroke-width="1.5" />
      <path d="M21.5 15.5l-5-5L4 21" stroke-width="1.5" />
    </template>
    <template v-else-if="kind === 'video'">
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </template>
    <template v-else-if="kind === 'audio'">
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </template>
    <template v-else-if="kind === 'prompt'">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </template>
    <template v-else-if="kind === 'input'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </template>
    <template v-else>
      <rect x="3" y="3" width="18" height="18" rx="4" />
    </template>
  </svg>
</template>
