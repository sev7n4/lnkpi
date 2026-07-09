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
    {
      path: '/stories',
      name: 'stories',
      component: () => import('@/pages/StoriesPage.vue'),
    },
    {
      path: '/image-studio',
      name: 'image-studio',
      component: () => import('@/pages/studios/ImageStudioPage.vue'),
    },
    {
      path: '/video-studio',
      name: 'video-studio',
      component: () => import('@/pages/studios/VideoStudioPage.vue'),
    },
    {
      path: '/audio-studio',
      name: 'audio-studio',
      component: () => import('@/pages/studios/AudioStudioPage.vue'),
    },
    {
      path: '/video-editor',
      name: 'video-editor',
      component: () => import('@/pages/studios/VideoEditorPage.vue'),
    },
    {
      path: '/generation-records',
      name: 'generation-records',
      component: () => import('@/pages/studios/GenerationRecordsPage.vue'),
    },
  ],
})

export default router
