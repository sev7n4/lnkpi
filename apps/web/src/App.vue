<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/layout/AppHeader.vue'
import LoginDialog from '@/components/auth/LoginDialog.vue'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const auth = useAuthStore()
const isImmersiveCanvas = computed(() => route.name === 'canvas')

onMounted(() => {
  void auth.restoreSession()
})
</script>

<template>
  <div class="min-h-screen bg-surface">
    <div v-if="!isImmersiveCanvas" class="pointer-events-none fixed inset-0 bg-hero-gradient" />
    <AppHeader v-if="!isImmersiveCanvas" />
    <main class="relative" :class="isImmersiveCanvas ? 'h-screen overflow-hidden' : ''">
      <RouterView />
    </main>
    <LoginDialog />
  </div>
</template>
