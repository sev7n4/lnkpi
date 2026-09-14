<script setup lang="ts">
import { ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import AccountPointsPill from '@/components/account/AccountPointsPill.vue'
import AccountUserMenu from '@/components/account/AccountUserMenu.vue'
import MembershipModal from '@/components/membership/MembershipModal.vue'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  compact?: boolean
  rootClass?: string
  ownsModal?: boolean
}>(), {
  compact: false,
  ownsModal: true,
})

const auth = useAuthStore()
const showMembership = ref(false)

function openMembership() {
  showMembership.value = true
}
</script>

<template>
  <template v-if="auth.isLoggedIn">
    <div class="flex items-center gap-2" :class="[rootClass, $attrs.class]">
      <AccountPointsPill @click="openMembership" />
      <AccountUserMenu :compact="compact" @open-membership="openMembership" />
    </div>
    <MembershipModal v-if="ownsModal" v-model="showMembership" />
  </template>
  <button
    v-else
    type="button"
    class="neo-chrome rounded-xl px-3 py-1.5 text-xs transition"
    :class="[rootClass, $attrs.class]"
    @click="auth.openLogin()"
  >
    登录
  </button>
</template>
