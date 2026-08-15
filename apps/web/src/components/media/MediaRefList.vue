<script setup lang="ts">
import { computed } from 'vue'
import type { MediaRefPreflight, ProbedMediaFile } from '@lnkpi/shared'
import { resolveMediaUrl } from '@/services/api-base'
import { formatMediaBytes, formatMediaDimensions } from '@/utils/mediaInfoFormat'

type RefItem =
  | (ProbedMediaFile & { refKey?: string; role?: string })
  | MediaRefPreflight['refs'][number]

const props = defineProps<{
  refs: RefItem[]
}>()

const items = computed(() =>
  props.refs.map((ref) => {
    const dims = formatMediaDimensions(ref.width, ref.height)
    const size = formatMediaBytes(ref.bytes)
    const detail = [dims, size].filter(Boolean).join(' · ')
    const level = 'level' in ref ? ref.level : undefined
    return {
      key: ref.refKey ?? ref.url,
      refKey: ref.refKey,
      url: ref.url,
      thumbUrl: resolveMediaUrl(ref.url),
      detail,
      level,
      probeFailed: 'probeStatus' in ref && ref.probeStatus === 'failed',
    }
  }),
)
</script>

<template>
  <ul v-if="items.length" class="media-ref-list">
    <li v-for="item in items" :key="item.key" class="media-ref-item">
      <img
        v-if="item.thumbUrl"
        :src="item.thumbUrl"
        alt=""
        class="media-ref-thumb"
        loading="lazy"
      >
      <div class="media-ref-body">
        <div class="media-ref-title">
          <span class="media-ref-key">{{ item.refKey || '参考图' }}</span>
          <span v-if="item.level === 'warn'" class="media-ref-badge is-warn">偏大</span>
          <span v-else-if="item.level === 'error'" class="media-ref-badge is-error">过大</span>
          <span v-else-if="item.probeFailed" class="media-ref-badge is-error">读取失败</span>
        </div>
        <p v-if="item.detail" class="media-ref-detail">{{ item.detail }}</p>
      </div>
    </li>
  </ul>
  <p v-else class="media-ref-empty">无参考媒体</p>
</template>

<style scoped>
.media-ref-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.media-ref-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.media-ref-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
}

.media-ref-body {
  min-width: 0;
  flex: 1;
}

.media-ref-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.media-ref-key {
  font-size: 12px;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.media-ref-badge {
  display: inline-flex;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
}

.media-ref-badge.is-warn {
  background: rgba(234, 179, 8, 0.15);
  color: #facc15;
}

.media-ref-badge.is-error {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}

.media-ref-detail {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--neo-text-secondary);
}

.media-ref-empty {
  margin: 0;
  font-size: 12px;
  color: var(--neo-text-secondary);
}
</style>
