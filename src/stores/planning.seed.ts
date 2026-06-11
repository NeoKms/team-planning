/**
 * Demo seed data for the onboarding "Load demo" action.
 * Kept separate from business logic so the store stays focused on state management.
 */

import {
  WORK_DAY_MINUTES,
  defaultDevelopmentFlow,
  emptyMeetingLoadByWeekday,
  emptyReleaseSupportEstimates,
  emptyWorkEstimates,
  priorityLabelByOrder,
  type PlanningState,
} from '@/domain/planning'

const isoNow = () => new Date().toISOString()

const nextMondayIso = (): string => {
  const today = new Date()
  // 0 = Sun, 1 = Mon … 6 = Sat; days until next Monday
  const daysUntilMonday = ((8 - today.getDay()) % 7) || 7
  const monday = new Date(today)
  monday.setDate(today.getDate() + daysUntilMonday)
  const y = monday.getFullYear()
  const m = String(monday.getMonth() + 1).padStart(2, '0')
  const d = String(monday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const isoDateAddDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export const createSeedState = (): PlanningState => {
  const createdAt = isoNow()
  const activeStart = nextMondayIso()
  // Archived sprints start before the active sprint
  const growthArchivedStart = isoDateAddDays(activeStart, -14)

  // ── Team IDs ──────────────────────────────────────────────────────────────
  const t1 = 'team-platform'
  const t2 = 'team-growth'

  // ── Platform member IDs ───────────────────────────────────────────────────
  const tl = 'member-tl'        // tech-lead
  const be = 'member-be'        // backend
  const be2 = 'member-be2'      // second backend, 1-day vacation Mon
  const fe = 'member-fe'        // frontend
  const fe2 = 'member-fe2'      // second frontend, full-sprint vacation
  const qa1 = 'member-qa1'
  const qa2 = 'member-qa2'
  const ios = 'member-ios'
  const android = 'member-android'

  // ── Growth member IDs ─────────────────────────────────────────────────────
  const beG = 'member-be-growth'
  const feG = 'member-fe-growth'
  const qaG = 'member-qa-growth'

  // ── Sprint IDs ────────────────────────────────────────────────────────────
  const sprintActive = 'sprint-active'
  const sprintGrowthArchive = 'sprint-growth-archive'

  // ── Epic IDs ──────────────────────────────────────────────────────────────
  const epicMobile = 'epic-mobile-release'

  // ── Work item IDs ─────────────────────────────────────────────────────────
  const wiCrash = 'wi-crash'
  const wiSync = 'wi-sync'
  const wiMemory = 'wi-memory'
  const wiFeed = 'wi-feed'
  const wiPush = 'wi-push'

  // ── Vacation dates derived from sprint dates ──────────────────────────────
  // Active sprint is 1 week: Mon … Fri = activeStart … activeStart + 4
  const sprintFriday = isoDateAddDays(activeStart, 4) // last day of 1-week sprint

  return {
    teams: [
      {
        id: t1,
        name: 'Product Platform',
        memberIds: [tl, be, be2, fe, fe2, qa1, qa2, ios, android],
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: t2,
        name: 'Growth',
        memberIds: [beG, feG, qaG],
        createdAt,
        updatedAt: createdAt,
      },
    ],

    members: [
      // ── Product Platform ────────────────────────────────────────────────
      {
        id: tl,
        teamId: t1,
        name: 'Алексей Костин',
        role: 'tech-lead',
        availableMinutesPerDay: 240, // 4 ч/день
        meetingLoadByWeekday: {
          monday: 150, // 150 > 120 → −30 мин к capacity
          tuesday: 60,
          wednesday: 90,
          thursday: 60,
          friday: 30,
        },
      },
      {
        id: be,
        teamId: t1,
        name: 'Дмитрий Фролов',
        role: 'backend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: { monday: 30, tuesday: 0, wednesday: 30, thursday: 0, friday: 0 },
      },
      {
        id: be2,
        teamId: t1,
        name: 'Иван Козлов',
        role: 'backend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: fe,
        teamId: t1,
        name: 'Елена Соколова',
        role: 'frontend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: fe2,
        teamId: t1,
        name: 'Кирилл Степанов',
        role: 'frontend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: qa1,
        teamId: t1,
        name: 'Ирина Павлова',
        role: 'qa',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: { monday: 30, tuesday: 0, wednesday: 0, thursday: 0, friday: 0 },
      },
      {
        id: qa2,
        teamId: t1,
        name: 'Михаил Зайцев',
        role: 'qa',
        availableMinutesPerDay: 300, // 5 ч/день
        meetingLoadByWeekday: { monday: 60, tuesday: 0, wednesday: 30, thursday: 0, friday: 0 },
      },
      {
        id: ios,
        teamId: t1,
        name: 'Артём Нечаев',
        role: 'ios',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: android,
        teamId: t1,
        name: 'Ольга Белова',
        role: 'android',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: { monday: 0, tuesday: 0, wednesday: 30, thursday: 0, friday: 0 },
      },
      // ── Growth ──────────────────────────────────────────────────────────
      {
        id: beG,
        teamId: t2,
        name: 'Сергей Малинин',
        role: 'backend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: feG,
        teamId: t2,
        name: 'Наталья Орлова',
        role: 'frontend',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
      {
        id: qaG,
        teamId: t2,
        name: 'Антон Лисов',
        role: 'qa',
        availableMinutesPerDay: WORK_DAY_MINUTES,
        meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
      },
    ],

    sprints: [
      {
        id: sprintActive,
        teamId: t1,
        name: 'Sprint 16',
        startsOn: activeStart,
        durationWeeks: 1,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: sprintGrowthArchive,
        teamId: t2,
        name: 'Growth Sprint 1',
        startsOn: growthArchivedStart,
        durationWeeks: 1,
        createdAt,
        updatedAt: createdAt,
      },
    ],

    epics: [
      {
        id: epicMobile,
        sprintId: sprintActive,
        title: 'Релиз мобильного 2.4',
        workItemIds: [wiCrash, wiSync],
        releaseSupport: { backend: 30, frontend: 0, qa: 30, ios: 60, android: 60 },
        createdAt,
        updatedAt: createdAt,
      },
    ],

    workItems: [
      // ── Platform active sprint ────────────────────────────────────────────
      // Epic: Релиз мобильного 2.4
      {
        id: wiCrash,
        sprintId: sprintActive,
        epicId: epicMobile,
        type: 'prod-bug',
        title: 'Крэш при открытии профиля на iOS',
        priority: 1,
        priorityLabel: priorityLabelByOrder(1),
        estimates: {
          ...emptyWorkEstimates(),
          ios: 240,
          qaTestCaseWriting: 60,
          qaTesting: 120,
        },
        assignments: { ios, qa: qa1 },
        developmentFlow: defaultDevelopmentFlow(),
        dependencyIds: [],
        requiresReleaseSupport: false, // release support на уровне epic
        releaseSupport: emptyReleaseSupportEstimates(),
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: wiSync,
        sprintId: sprintActive,
        epicId: epicMobile,
        type: 'prod-bug',
        title: 'Сбой синхронизации корзины',
        priority: 1,
        priorityLabel: priorityLabelByOrder(1),
        estimates: {
          ...emptyWorkEstimates(),
          backend: 180,
          android: 180,
          qaTestCaseWriting: 60,
          qaTesting: 120,
        },
        assignments: { backend: be, android, qa: qa1 },
        developmentFlow: { backendFrontendParallel: false, mobileParallelWithBackend: true },
        dependencyIds: [],
        requiresReleaseSupport: false,
        releaseSupport: emptyReleaseSupportEstimates(),
        createdAt,
        updatedAt: createdAt,
      },

      // Standalone critical prod-bug
      {
        id: wiMemory,
        sprintId: sprintActive,
        type: 'prod-bug',
        title: 'Утечка памяти при просмотре каталога',
        priority: 1,
        priorityLabel: priorityLabelByOrder(1),
        estimates: {
          ...emptyWorkEstimates(),
          android: 180,
          qaTesting: 60,
        },
        assignments: { android, qa: qa1 },
        developmentFlow: defaultDevelopmentFlow(),
        dependencyIds: [],
        requiresReleaseSupport: true,
        releaseSupport: { ...emptyReleaseSupportEstimates(), android: 30, qa: 15 },
        createdAt,
        updatedAt: createdAt,
      },

      // High: backend-heavy, tech lead
      {
        id: wiFeed,
        sprintId: sprintActive,
        type: 'story',
        title: 'Оптимизация ленты рекомендаций',
        priority: 2,
        priorityLabel: priorityLabelByOrder(2),
        estimates: {
          ...emptyWorkEstimates(),
          backend: 360,
          documentation: 60,
          qaTestCaseWriting: 60,
          qaTesting: 120,
        },
        assignments: { backend: tl, qa: qa2 },
        developmentFlow: defaultDevelopmentFlow(),
        dependencyIds: [],
        requiresReleaseSupport: true,
        releaseSupport: { ...emptyReleaseSupportEstimates(), backend: 30, qa: 30 },
        createdAt,
        updatedAt: createdAt,
      },

      // Medium: full stack + mobile + design review; be2 назначен — у него отпуск в Пн
      {
        id: wiPush,
        sprintId: sprintActive,
        type: 'story',
        title: 'Push-уведомления о статусе заказа',
        priority: 3,
        priorityLabel: priorityLabelByOrder(3),
        estimates: {
          ...emptyWorkEstimates(),
          backend: 360,
          frontend: 240,
          ios: 360,
          android: 360,
          qaTestCaseWriting: 90,
          qaTesting: 240,
        },
        assignments: { backend: be2, frontend: fe, ios, android, qa: qa2 },
        developmentFlow: { backendFrontendParallel: false, mobileParallelWithBackend: true },
        dependencyIds: [],
        requiresDesignReview: true,
        designReviewEstimateMinutes: 45,
        requiresReleaseSupport: true,
        releaseSupport: { backend: 30, frontend: 30, qa: 30, ios: 60, android: 60 },
        createdAt,
        updatedAt: createdAt,
      },

      // ── Growth archived sprint ────────────────────────────────────────────
      {
        id: 'wi-growth-ab',
        sprintId: sprintGrowthArchive,
        type: 'story',
        title: 'A/B тест кнопки оформления заказа',
        priority: 1,
        priorityLabel: priorityLabelByOrder(1),
        estimates: {
          ...emptyWorkEstimates(),
          backend: 180,
          frontend: 180,
          qaTestCaseWriting: 60,
          qaTesting: 120,
        },
        assignments: { backend: beG, frontend: feG, qa: qaG },
        developmentFlow: defaultDevelopmentFlow(),
        dependencyIds: [],
        requiresReleaseSupport: true,
        releaseSupport: { ...emptyReleaseSupportEstimates(), backend: 15, frontend: 15, qa: 15 },
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: 'wi-growth-ref',
        sprintId: sprintGrowthArchive,
        type: 'story',
        title: 'Реферальная программа: лендинг',
        priority: 2,
        priorityLabel: priorityLabelByOrder(2),
        estimates: {
          ...emptyWorkEstimates(),
          frontend: 360,
          qaTestCaseWriting: 30,
          qaTesting: 90,
        },
        assignments: { frontend: feG, qa: qaG },
        developmentFlow: defaultDevelopmentFlow(),
        dependencyIds: [],
        requiresReleaseSupport: true,
        releaseSupport: { ...emptyReleaseSupportEstimates(), frontend: 30, qa: 15 },
        createdAt,
        updatedAt: createdAt,
      },
    ],

    allocationResults: [],

    vacations: [
      // Кирилл Степанов (fe2) — весь спринт: Пн … Пт
      {
        id: 'vacation-fe2-sprint',
        memberId: fe2,
        startDate: activeStart,
        endDate: sprintFriday,
      },
      // Иван Козлов (be2) — первый день спринта: Пн
      {
        id: 'vacation-be2-sprint',
        memberId: be2,
        startDate: activeStart,
        endDate: activeStart,
      },
    ],
  }
}

