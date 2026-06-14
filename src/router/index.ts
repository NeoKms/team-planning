import { createRouter, createWebHistory } from 'vue-router'

import HomeView from '@/views/HomeView.vue'

const TeamsView = () => import('@/views/TeamsView.vue')
const SprintsView = () => import('@/views/SprintsView.vue')
const SprintPlanningView = () => import('@/views/SprintPlanningView.vue')
const AllocationView = () => import('@/views/AllocationView.vue')
const AllocationReportView = () => import('@/views/AllocationReportView.vue')
const VacationsView = () => import('@/views/VacationsView.vue')
const DataExchangeView = () => import('@/views/DataExchangeView.vue')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/teams',
      name: 'teams',
      component: TeamsView,
    },
    {
      path: '/vacations',
      name: 'vacations',
      component: VacationsView,
    },
    {
      path: '/sprints',
      name: 'sprints',
      component: SprintsView,
    },
    {
      path: '/sprints/:sprintId',
      name: 'sprint-planning',
      component: SprintPlanningView,
      props: true,
    },
    {
      path: '/allocation',
      redirect: { name: 'sprints' },
    },
    {
      path: '/allocation/:sprintId',
      name: 'sprint-allocation',
      component: AllocationView,
      props: true,
    },
    {
      path: '/data',
      name: 'data',
      component: DataExchangeView,
    },
    {
      path: '/reports/allocation/:sprintId',
      name: 'allocation-report',
      component: AllocationReportView,
      props: true,
      meta: {
        reportView: true,
      },
    },
  ],
})

router.afterEach(() => {
  if (typeof window.ym === 'function') {
    window.ym(109847069, 'hit', window.location.href, {
      title: document.title,
      referer: document.referrer,
    })
  }

  // Google Tag Manager — push virtualPageView on SPA navigation
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    event: 'virtualPageView',
    pageUrl: window.location.href,
    pageTitle: document.title,
  })
})

export default router
