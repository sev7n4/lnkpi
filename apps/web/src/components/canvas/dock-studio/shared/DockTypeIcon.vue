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
    <template v-else-if="kind === 'shot'">
      <rect x="2.5" y="5" width="19" height="14" rx="2" stroke-width="1.5" />
      <line x1="7" y1="5" x2="7" y2="19" stroke-width="1.5" />
      <line x1="17" y1="5" x2="17" y2="19" stroke-width="1.5" />
    </template>
    <template v-else-if="kind === 'director'">
      <path d="M4 11l16-4v4L4 15v-4z" stroke-width="1.5" />
      <path d="M6 15l-2 6M12 13.5L10 21M18 12l2 6" stroke-width="1.5" />
    </template>
    <template v-else-if="kind === 'composition'">
      <rect x="2.5" y="4" width="19" height="16" rx="2" stroke-width="1.5" />
      <line x1="2.5" y1="12" x2="21.5" y2="12" stroke-width="1.5" />
      <line x1="8" y1="4" x2="8" y2="12" stroke-width="1.5" />
      <line x1="14" y1="12" x2="14" y2="20" stroke-width="1.5" />
    </template>
    <template v-else-if="kind === 'world'">
      <circle cx="12" cy="12" r="9" stroke-width="1.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9" stroke-width="1.5" />
      <line x1="3" y1="12" x2="21" y2="12" stroke-width="1.5" />
    </template>
    <template v-else-if="kind === 'group'">
      <rect x="3" y="3" width="8" height="8" rx="2" stroke-width="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="2" stroke-width="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="2" stroke-width="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="2" stroke-width="1.5" />
    </template>
    <template v-else>
      <rect x="3" y="3" width="18" height="18" rx="4" />
    </template>
  </svg>
</template>
