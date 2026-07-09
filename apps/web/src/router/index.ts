import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/workflow',
    },
    {
      path: '/workflow',
      name: 'workflow',
      component: () => import('@/pages/WorkflowPage.vue'),
    },
    {
      path: '/workflow/:sessionId',
      name: 'canvas',
      component: () => import('@/pages/CanvasPage.vue'),
    },
    {
      path: '/community',
      name: 'community',
      component: () => import('@/pages/CommunityPage.vue'),
    },
  ],
})

export default router
