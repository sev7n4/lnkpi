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
    {
      path: '/replay/:sessionId',
      name: 'replay',
      component: () => import('@/pages/ReplayPage.vue'),
    },
    {
      path: '/creator/:id',
      name: 'creator',
      component: () => import('@/pages/CreatorPage.vue'),
    },
    {
      path: '/share/:id',
      name: 'share',
      component: () => import('@/pages/SharePage.vue'),
    },
  ],
})

export default router
