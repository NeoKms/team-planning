import { computed, type ComputedRef, type Ref } from 'vue'

import {
  CALENDAR_MEETING_BUFFER_MINUTES,
  EXTERNAL_DESIGNER_ID,
  EXTERNAL_DESIGNER_NAME,
  WORKING_DAYS,
  WORK_DAY_MINUTES,
  formatDuration,
  type AssignmentReplacementRecommendation,
  type PlanningState,
  type PlanningStage,
  type PlanningStageType,
  type PlanningWarning,
  type ScheduledSlot,
  type Sprint,
  type TeamMember,
  type Weekday,
  type WorkDirection,
} from '@/domain/planning'
import { usePlanningStore } from '@/stores/planning'

const QA_STAGE_TYPES = new Set<PlanningStageType>(['qa-test-case-writing', 'qa-testing'])
const DEV_STAGE_TYPES = new Set<PlanningStageType>([
  'backend-development',
  'frontend-development',
  'ios-development',
  'android-development',
  'documentation',
])

const MS_PER_DAY = 24 * 60 * 60 * 1000
const workingDaySet = new Set<string>(WORKING_DAYS)
const weekdaysByDateDay: (Weekday | undefined)[] = [
  undefined,
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  undefined,
]

export const stageLabels: Record<PlanningStageType, string> = {
  analysis: 'Анализ',
  'backend-development': 'Backend',
  documentation: 'Docs',
  'frontend-development': 'Frontend',
  'ios-development': 'iOS',
  'android-development': 'Android',
  'design-review': 'Design review',
  'qa-test-case-writing': 'QA test cases',
  'qa-testing': 'QA testing',
  'release-support': 'Release',
}

export const directionLabels: Record<WorkDirection, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  ios: 'iOS',
  android: 'Android',
  qa: 'QA',
}

export const stageToneByDirection: Record<WorkDirection, string> = {
  backend: 'bg-sky-600',
  frontend: 'bg-emerald-600',
  ios: 'bg-cyan-700',
  android: 'bg-red-600',
  qa: 'bg-amber-600',
}

/** Цветовые переопределения для конкретных типов этапов (имеют приоритет над направлением). */
export const stageToneByType: Partial<Record<PlanningStageType, string>> = {
  'release-support': 'bg-purple-600',
  'design-review': 'bg-fuchsia-500',
}

export const getSlotToneClass = (
  stage: { type: PlanningStageType; direction: WorkDirection } | undefined,
): string => {
  if (!stage) return stageToneByDirection.backend
  return stageToneByType[stage.type] ?? stageToneByDirection[stage.direction]
}

export const severityClasses: Record<PlanningWarning['severity'], string> = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900',
}

export const allocationCalculationNotes = [
  'Рабочими считаются дни спринта с понедельника по пятницу; release support не ставится на нерелизные дни.',
  'Дневная capacity участника берется из доступности, а встречи сверх встроенного буфера уменьшают доступное время.',
  'Отпуска обнуляют capacity в соответствующие рабочие дни; отпуск на весь спринт исключает участника из автоназначения.',
  'Расчет сравнивает несколько допустимых порядков работ и выбирает вариант с меньшим overflow, более ранним релизом, меньшим makespan и меньшим числом конфликтов QA/release.',
  'Если исполнитель не выбран, автоназначение выбирает подходящего участника с самым ранним завершением этапа на текущем календаре.',
  'Ручные назначения не меняются автоматически; если замена исполнителя заметно улучшает план, она показывается как рекомендация.',
  'Для каждого участника считается загрузка внутри спринта; целевой минимум для сигнала загрузки — 80% capacity.',
  'Все, что не помещается в рабочие дни спринта, попадает в прогноз после спринта.',
]

export interface AllocationMemberRow {
  member: TeamMember
  isExternal: boolean
  sprintMinutes: number
  overflowMinutes: number
  assignedMinutes: number
  capacityMinutes: number
  balanceMinutes: number
  loadPercent: number
  targetLoadMinutes: number
  targetLoadGapMinutes: number
  isUnderloaded: boolean
}

export interface AllocationTimelineBar {
  slot: ScheduledSlot
  title: string
  directionLabel: string
  toneClass: string
  isOverflow: boolean
  leftPercent: number
  widthPercent: number
  labelLeftPercent: number
  labelWidthPercent: number
  laneIndex: number
  /** Epic this bar belongs to (for release-support and other epic-level stages). */
  epicId: string | undefined
}

export interface AllocationTimelineRow {
  member: TeamMember
  isExternal: boolean
  assignedMinutes: number
  capacityMinutes: number
  bars: AllocationTimelineBar[]
  laneCount: number
}

export interface AllocationWarningDisplayItem extends PlanningWarning {
  displaySeverity: PlanningWarning['severity']
}

export interface AllocationWarningGroup {
  severity: PlanningWarning['severity']
  title: string
  items: AllocationWarningDisplayItem[]
}

export interface AllocationAssignmentRecommendation extends AssignmentReplacementRecommendation {
  workItemTitle: string
  stageLabel: string
  fromAssigneeName: string
  toAssigneeName: string
}

export interface SprintTicket {
  stageId: string
  workItemId: string
  workItemTitle: string
  epicId: string | undefined
  epicTitle: string | undefined
  stageType: PlanningStageType
  direction: WorkDirection
  assigneeId: string
  assigneeName: string
  totalSprintMinutes: number
  /** Individual tracker tasks to create — max 1 work day each for non-QA stages. */
  tasks: { estimateMinutes: number }[]
}

export type WorkItemOutcome = 'released' | 'fully-tested' | 'dev-completed' | 'in-progress'

export interface WorkItemNavItem {
  id: string
  title: string
  type: 'story' | 'prod-bug'
  priority: number
  epicId: string | undefined
  epicTitle: string | undefined
}

export interface WorkItemOutcomeRow {
  workItemId: string
  workItemTitle: string
  epicId: string | undefined
  epicTitle: string | undefined
  outcome: WorkItemOutcome
  priority: number
}

export interface WorkItemOutcomeGroup {
  outcome: WorkItemOutcome
  label: string
  description: string
  items: WorkItemOutcomeRow[]
}

const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)

  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

const formatIsoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)
const addDays = (date: string, days: number) =>
  formatIsoDate(parseIsoDate(date) + days * MS_PER_DAY)
const getWeekday = (date: string) => weekdaysByDateDay[new Date(parseIsoDate(date)).getUTCDay()]

const getEffectiveDailyCapacity = (member: TeamMember, date: string) => {
  const weekday = getWeekday(date)
  const meetingLoad = weekday ? (member.meetingLoadByWeekday?.[weekday] ?? 0) : 0
  const meetingOverload = Math.max(0, Math.round(meetingLoad) - CALENDAR_MEETING_BUFFER_MINUTES)

  return Math.max(0, Math.round(member.availableMinutesPerDay) - meetingOverload)
}

const targetLoadPercent = 80

const getWarningDisplaySeverity = (warning: PlanningWarning): PlanningWarning['severity'] => {
  if (warning.message.includes('в отпуске весь спринт')) {
    return 'info'
  }

  return warning.severity
}

export const formatMinutes = (minutes: number) => {
  return formatDuration(minutes)
}

export const formatDateLabel = (date: string) => {
  const weekdayLabels: Record<Weekday, string> = {
    monday: 'Пн',
    tuesday: 'Вт',
    wednesday: 'Ср',
    thursday: 'Чт',
    friday: 'Пт',
  }
  const weekday = getWeekday(date)
  const [, month, day] = date.split('-')

  return `${weekday ? weekdayLabels[weekday] : 'День'} ${day}.${month}`
}

export const useAllocationReport = (
  selectedSprint: ComputedRef<Sprint | undefined>,
  /** When provided (e.g. report opened via shareable link), all data is read from this
   *  state instead of the global Pinia store — the global store is never touched. */
  stateOverride?: Ref<PlanningState | null> | ComputedRef<PlanningState | null>,
) => {
  const planningStore = usePlanningStore()

  // ── Data sources: use stateOverride when present, otherwise fall back to global store ──
  const allocationResultsSource = computed(
    () => stateOverride?.value?.allocationResults ?? planningStore.allocationResults,
  )
  const teamsSource = computed(() => stateOverride?.value?.teams ?? planningStore.teams)
  const membersSource = computed(() => stateOverride?.value?.members ?? planningStore.members)
  const workItemsSource = computed(
    () => stateOverride?.value?.workItems ?? planningStore.workItems,
  )
  const epicsSource = computed(() => stateOverride?.value?.epics ?? planningStore.epics)
  const vacationsSource = computed(
    () => stateOverride?.value?.vacations ?? planningStore.vacations,
  )

  const allocationResult = computed(() =>
    selectedSprint.value
      ? allocationResultsSource.value.find(
          (result) => result.sprintId === selectedSprint.value?.id,
        )
      : undefined,
  )

  const selectedTeam = computed(() =>
    teamsSource.value.find((team) => team.id === selectedSprint.value?.teamId),
  )

  // Sprint working dates — defined early, used by vacation logic and teamMembers
  const sprintWorkingDates = computed(() => {
    const sprint = selectedSprint.value
    const dates: string[] = []

    if (!sprint) {
      return dates
    }

    for (let dayOffset = 0; dayOffset < sprint.durationWeeks * 7; dayOffset += 1) {
      const date = addDays(sprint.startsOn, dayOffset)
      const weekday = getWeekday(date)

      if (weekday && workingDaySet.has(weekday)) {
        dates.push(date)
      }
    }

    return dates
  })

  const sprintWorkingDateSet = computed(() => new Set(sprintWorkingDates.value))

  // Vacation dates per member (only sprint working dates)
  const vacationDatesByMemberId = computed(() => {
    const map = new Map<string, Set<string>>()
    const vacations = vacationsSource.value
    const sprintDates = sprintWorkingDates.value

    vacations.forEach((v) => {
      const vacationDates = sprintDates.filter((d) => d >= v.startDate && d <= v.endDate)
      if (!vacationDates.length) return
      const existing = map.get(v.memberId) ?? new Set<string>()
      vacationDates.forEach((d) => existing.add(d))
      map.set(v.memberId, existing)
    })

    return map
  })

  const teamMembers = computed(() => {
    const allMembers = membersSource.value.filter(
      (member) => member.teamId === selectedTeam.value?.id,
    )
    const hasExternalDesignerSlots = allocationResult.value?.slots.some(
      (slot) => slot.assigneeId === EXTERNAL_DESIGNER_ID,
    )

    const members: TeamMember[] = hasExternalDesignerSlots
      ? [
          ...allMembers,
          {
            id: EXTERNAL_DESIGNER_ID,
            teamId: selectedTeam.value?.id ?? 'external-design',
            name: EXTERNAL_DESIGNER_NAME,
            role: 'frontend' as const,
            availableMinutesPerDay: WORK_DAY_MINUTES,
            meetingLoadByWeekday: {
              monday: 0,
              tuesday: 0,
              wednesday: 0,
              thursday: 0,
              friday: 0,
            },
          },
        ]
      : allMembers

    // Exclude members on full-sprint vacation
    return members.filter((member) => {
      const vacDates = vacationDatesByMemberId.value.get(member.id)
      if (!vacDates || vacDates.size === 0) return true
      const sprintDates = sprintWorkingDates.value
      if (!sprintDates.length) return true
      return !sprintDates.every((d) => vacDates.has(d))
    })
  })

  const sprintWorkItems = computed(() =>
    workItemsSource.value.filter((workItem) => workItem.sprintId === selectedSprint.value?.id),
  )

  const workItemById = computed(() =>
    Object.fromEntries(sprintWorkItems.value.map((workItem) => [workItem.id, workItem])),
  )

  const epicById = computed(() =>
    Object.fromEntries(
      epicsSource.value
        .filter((epic) => epic.sprintId === selectedSprint.value?.id)
        .map((epic) => [epic.id, epic]),
    ),
  )

  const stageById = computed<Record<string, PlanningStage>>(() =>
    Object.fromEntries((allocationResult.value?.stages ?? []).map((stage) => [stage.id, stage])),
  )

  const displayDates = computed(() => {
    const overflowDates = allocationResult.value?.overflow.map((slot) => slot.date) ?? []

    return [...new Set([...sprintWorkingDates.value, ...overflowDates])].sort()
  })

  const slotsByMemberDate = computed(() => {
    const grouped = new Map<string, ScheduledSlot[]>()

    for (const slot of allocationResult.value?.slots ?? []) {
      const key = `${slot.assigneeId}:${slot.date}`
      grouped.set(key, [...(grouped.get(key) ?? []), slot])
    }

    grouped.forEach((slots, key) => {
      grouped.set(
        key,
        slots.sort(
          (left, right) =>
            left.startsAtMinute - right.startsAtMinute || left.stageId.localeCompare(right.stageId),
        ),
      )
    })

    return grouped
  })

  const allocationMembers = computed(() =>
    teamMembers.value.filter((member) => member.id !== EXTERNAL_DESIGNER_ID),
  )

  const buildMemberRow = (member: TeamMember): AllocationMemberRow => {
    const isExternal = member.id === EXTERNAL_DESIGNER_ID
    const slots = (allocationResult.value?.slots ?? []).filter(
      (slot) => slot.assigneeId === member.id,
    )
    const sprintMinutes = slots
      .filter((slot) => sprintWorkingDateSet.value.has(slot.date))
      .reduce((total, slot) => total + slot.minutes, 0)
    const overflowMinutes = slots
      .filter((slot) => !sprintWorkingDateSet.value.has(slot.date))
      .reduce((total, slot) => total + slot.minutes, 0)
    const assignedMinutes = sprintMinutes
    const vacDates = vacationDatesByMemberId.value.get(member.id)
    const capacityMinutes = isExternal
      ? 0
      : sprintWorkingDates.value.reduce(
          (total, date) =>
            total + (vacDates?.has(date) ? 0 : getEffectiveDailyCapacity(member, date)),
          0,
        )
    const balanceMinutes = Math.max(0, capacityMinutes - assignedMinutes)
    const targetLoadMinutes = Math.ceil((capacityMinutes * targetLoadPercent) / 100)
    const targetLoadGapMinutes = Math.max(0, targetLoadMinutes - assignedMinutes)
    const loadPercent = capacityMinutes ? Math.round((assignedMinutes / capacityMinutes) * 100) : 0

    return {
      member,
      isExternal,
      sprintMinutes,
      overflowMinutes,
      assignedMinutes,
      capacityMinutes,
      balanceMinutes,
      loadPercent,
      targetLoadMinutes,
      targetLoadGapMinutes,
      isUnderloaded: !isExternal && capacityMinutes > 0 && loadPercent < targetLoadPercent,
    }
  }

  const memberRows = computed<AllocationMemberRow[]>(() =>
    allocationMembers.value.map((member) => buildMemberRow(member)),
  )

  const scheduleRows = computed<AllocationMemberRow[]>(() =>
    teamMembers.value.map((member) => buildMemberRow(member)),
  )

  const allocationSlotFilter = (slot: ScheduledSlot) => slot.assigneeId !== EXTERNAL_DESIGNER_ID

  const summary = computed(() => {
    const result = allocationResult.value
    const totalMinutes =
      result?.slots
        .filter((slot) => allocationSlotFilter(slot) && sprintWorkingDateSet.value.has(slot.date))
        .reduce((total, slot) => total + slot.minutes, 0) ?? 0
    const overflowMinutes =
      result?.overflow
        .filter((slot) => allocationSlotFilter(slot))
        .reduce((total, slot) => total + slot.minutes, 0) ?? 0
    const warnings = result?.warnings ?? []
    const errorCount =
      warnings.filter((warning) => getWarningDisplaySeverity(warning) === 'error').length ?? 0
    const warningCount =
      warnings.filter((warning) => getWarningDisplaySeverity(warning) === 'warning').length ?? 0
    const infoCount =
      warnings.filter((warning) => getWarningDisplaySeverity(warning) === 'info').length ?? 0

    return {
      totalMinutes,
      overflowMinutes,
      errorCount,
      warningCount,
      infoCount,
      underloadedMemberCount: memberRows.value.filter((row) => row.isUnderloaded).length,
      targetLoadPercent,
    }
  })

  const warningGroups = computed<AllocationWarningGroup[]>(() => {
    const warnings = (allocationResult.value?.warnings ?? []).map((warning) => ({
      ...warning,
      displaySeverity: getWarningDisplaySeverity(warning),
    }))

    return [
      {
        severity: 'error' as const,
        title: 'Ошибки',
        items: warnings.filter((warning) => warning.displaySeverity === 'error'),
      },
      {
        severity: 'warning' as const,
        title: 'Риски',
        items: warnings.filter((warning) => warning.displaySeverity === 'warning'),
      },
      {
        severity: 'info' as const,
        title: 'Информация',
        items: warnings.filter((warning) => warning.displaySeverity === 'info'),
      },
    ].filter((group) => group.items.length > 0)
  })

  const assignmentRecommendations = computed<AllocationAssignmentRecommendation[]>(() =>
    (allocationResult.value?.assignmentRecommendations ?? []).map((recommendation) => {
      const stage = stageById.value[recommendation.stageId]

      return {
        ...recommendation,
        workItemTitle:
          workItemById.value[recommendation.workItemId]?.title ?? 'Задача удалена',
        stageLabel: stage ? stageLabels[stage.type] : 'Этап',
        fromAssigneeName:
          memberByIdMap.value[recommendation.fromAssigneeId]?.name ??
          recommendation.fromAssigneeId,
        toAssigneeName:
          memberByIdMap.value[recommendation.toAssigneeId]?.name ?? recommendation.toAssigneeId,
      }
    }),
  )

  const getSlots = (memberId: string, date: string) =>
    slotsByMemberDate.value.get(`${memberId}:${date}`) ?? []

  const getSlotStage = (slot: ScheduledSlot) => stageById.value[slot.stageId]
  const getSlotWorkItem = (slot: ScheduledSlot) => workItemById.value[slot.workItemId]

  const slotTitle = (slot: ScheduledSlot) => {
    const stage = getSlotStage(slot)
    const workItem = getSlotWorkItem(slot)
    const epic = stage?.epicId ? epicById.value[stage.epicId] : undefined

    if (stage?.type === 'release-support' && epic) {
      return [stageLabels[stage.type], epic.title].join(' · ')
    }

    return [
      stage ? stageLabels[stage.type] : 'Этап',
      workItem?.title ?? 'Задача удалена',
      epic?.title,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  const slotDirectionLabel = (slot: ScheduledSlot) => {
    const stage = getSlotStage(slot)

    return stage ? directionLabels[stage.direction] : ''
  }

  const memberByIdMap = computed<Record<string, TeamMember>>(() =>
    Object.fromEntries(teamMembers.value.map((m) => [m.id, m])),
  )

  // ── Sprint Tickets: tracker tasks to create per stage ─────────────────────
  const sprintTickets = computed<SprintTicket[]>(() => {
    const result = allocationResult.value
    if (!result) return []

    // Group sprint-only slots by stageId
    const sprintSlotsByStageId = new Map<string, ScheduledSlot[]>()
    for (const slot of result.slots) {
      if (!sprintWorkingDateSet.value.has(slot.date)) continue
      const existing = sprintSlotsByStageId.get(slot.stageId) ?? []
      sprintSlotsByStageId.set(slot.stageId, [...existing, slot])
    }

    const tickets: SprintTicket[] = []
    for (const [stageId, stageSlots] of sprintSlotsByStageId) {
      const stage = stageById.value[stageId]
      if (!stage) continue
      const workItem = workItemById.value[stage.workItemId]
      if (!workItem) continue

      const totalMinutes = stageSlots.reduce((sum, slot) => sum + slot.minutes, 0)
      const assigneeId = stageSlots[0]?.assigneeId ?? ''
      const assigneeName = memberByIdMap.value[assigneeId]?.name ?? assigneeId
      const epicTitle = stage.epicId ? epicById.value[stage.epicId]?.title : undefined

      // QA tasks are not split — one ticket per full estimate.
      // All other tasks are split to max 1 work day (WORK_DAY_MINUTES) each.
      const isQaStage = QA_STAGE_TYPES.has(stage.type)
      const tasks: { estimateMinutes: number }[] = []
      if (isQaStage) {
        tasks.push({ estimateMinutes: totalMinutes })
      } else {
        let remaining = totalMinutes
        while (remaining > 0) {
          const estimate = Math.min(remaining, WORK_DAY_MINUTES)
          tasks.push({ estimateMinutes: estimate })
          remaining -= estimate
        }
      }

      tickets.push({
        stageId,
        workItemId: stage.workItemId,
        workItemTitle: workItem.title,
        epicId: stage.epicId,
        epicTitle,
        stageType: stage.type,
        direction: stage.direction,
        assigneeId,
        assigneeName,
        totalSprintMinutes: totalMinutes,
        tasks,
      })
    }

    tickets.sort((a, b) => {
      const pA = workItemById.value[a.workItemId]?.priority ?? 0
      const pB = workItemById.value[b.workItemId]?.priority ?? 0
      return pA - pB || a.workItemTitle.localeCompare(b.workItemTitle) || a.assigneeName.localeCompare(b.assigneeName)
    })
    return tickets
  })

  // ── Work Item Outcomes: sprint goal forecast ───────────────────────────────
  const workItemOutcomes = computed<WorkItemOutcomeGroup[]>(() => {
    const result = allocationResult.value
    if (!result) return []

    const overflowStageIds = new Set(result.overflow.map((slot) => slot.stageId))
    const sprintSlotStageIds = new Set(
      result.slots
        .filter((slot) => sprintWorkingDateSet.value.has(slot.date))
        .map((slot) => slot.stageId),
    )
    const stageCompletedInSprint = (stageId: string) =>
      sprintSlotStageIds.has(stageId) && !overflowStageIds.has(stageId)

    // Group all stages by workItemId
    const stagesByWorkItemId = new Map<string, PlanningStage[]>()
    for (const stage of result.stages) {
      const existing = stagesByWorkItemId.get(stage.workItemId) ?? []
      stagesByWorkItemId.set(stage.workItemId, [...existing, stage])
    }

    // Epic-level release stages by epicId
    const epicReleaseStagesByEpicId = new Map<string, PlanningStage[]>()
    for (const stage of result.stages) {
      if (stage.type === 'release-support' && stage.epicId) {
        const existing = epicReleaseStagesByEpicId.get(stage.epicId) ?? []
        epicReleaseStagesByEpicId.set(stage.epicId, [...existing, stage])
      }
    }

    const rows: WorkItemOutcomeRow[] = []
    for (const workItem of sprintWorkItems.value) {
      const stages = stagesByWorkItemId.get(workItem.id) ?? []
      if (!stages.length) continue

      const devStages = stages.filter((s) => DEV_STAGE_TYPES.has(s.type))
      const qaTestingStages = stages.filter((s) => s.type === 'qa-testing')
      const releaseStages: PlanningStage[] = workItem.epicId
        ? (epicReleaseStagesByEpicId.get(workItem.epicId) ?? [])
        : stages.filter((s) => s.type === 'release-support')

      const releaseCompleted =
        releaseStages.length > 0 && releaseStages.every((s) => stageCompletedInSprint(s.id))
      const qaCompleted =
        qaTestingStages.length > 0 && qaTestingStages.every((s) => stageCompletedInSprint(s.id))
      const devCompleted =
        devStages.length > 0 && devStages.every((s) => stageCompletedInSprint(s.id))

      let outcome: WorkItemOutcome
      if (releaseCompleted) {
        outcome = 'released'
      } else if (qaCompleted) {
        outcome = 'fully-tested'
      } else if (devCompleted) {
        outcome = 'dev-completed'
      } else {
        outcome = 'in-progress'
      }

      const epicTitle = workItem.epicId ? epicById.value[workItem.epicId]?.title : undefined
      rows.push({
        workItemId: workItem.id,
        workItemTitle: workItem.title,
        epicId: workItem.epicId,
        epicTitle,
        outcome,
        priority: workItem.priority,
      })
    }

    rows.sort((a, b) => a.priority - b.priority || a.workItemTitle.localeCompare(b.workItemTitle))

    const groups: WorkItemOutcomeGroup[] = [
      {
        outcome: 'released',
        label: 'Релиз',
        description: 'Завершат разработку, тестирование и выйдут в релиз в этом спринте',
        items: [],
      },
      {
        outcome: 'fully-tested',
        label: 'Полное тестирование',
        description: 'Разработка и тестирование завершатся, но релиза не будет',
        items: [],
      },
      {
        outcome: 'dev-completed',
        label: 'Завершение разработки',
        description: 'Разработка завершится в этом спринте, тестирование — позже',
        items: [],
      },
      {
        outcome: 'in-progress',
        label: 'В работе',
        description: 'Частично выполнятся или разработка не завершится в этом спринте',
        items: [],
      },
    ]

    for (const row of rows) {
      groups.find((g) => g.outcome === row.outcome)?.items.push(row)
    }

    return groups.filter((g) => g.items.length > 0)
  })

  const navItems = computed<WorkItemNavItem[]>(() =>
    sprintWorkItems.value
      .slice()
      .sort((a, b) => a.priority - b.priority)
      .map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        priority: item.priority,
        epicId: item.epicId,
        epicTitle: item.epicId ? epicById.value[item.epicId]?.title : undefined,
      })),
  )

  const timelineRows = computed<AllocationTimelineRow[]>(() => {    const dates = displayDates.value
    const dayCount = Math.max(dates.length, 1)

    return scheduleRows.value.map((row) => {
      const barsWithoutLanes = (allocationResult.value?.slots ?? [])
        .filter((slot) => slot.assigneeId === row.member.id)
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) || left.startsAtMinute - right.startsAtMinute,
        )
        .flatMap((slot) => {
          const dateIndex = dates.indexOf(slot.date)

          if (dateIndex === -1) {
            return []
          }

          const stage = getSlotStage(slot)
          const startInDay = Math.max(0, Math.min(1, slot.startsAtMinute / WORK_DAY_MINUTES))
          const widthInDay = Math.max(0, Math.min(1 - startInDay, slot.minutes / WORK_DAY_MINUTES))
          const dayLeftPercent = (dateIndex / dayCount) * 100
          const dayWidthPercent = 100 / dayCount

          return [
            {
              slot,
              title: slotTitle(slot),
              directionLabel: slotDirectionLabel(slot),
              toneClass: getSlotToneClass(stage),
              isOverflow: !sprintWorkingDateSet.value.has(slot.date),
              leftPercent: ((dateIndex + startInDay) / dayCount) * 100,
              widthPercent: (widthInDay / dayCount) * 100,
              labelLeftPercent: dayLeftPercent,
              labelWidthPercent: dayWidthPercent,
              laneIndex: 0,
              epicId: stage?.epicId,
            },
          ]
        })

      const laneRightEdges: number[] = []
      const bars = barsWithoutLanes.map((bar) => {
        const labelRightPercent = bar.labelLeftPercent + bar.labelWidthPercent
        const laneIndex = laneRightEdges.findIndex((rightEdge) => rightEdge <= bar.labelLeftPercent)
        const nextLaneIndex = laneIndex === -1 ? laneRightEdges.length : laneIndex

        laneRightEdges[nextLaneIndex] = labelRightPercent

        return {
          ...bar,
          laneIndex: nextLaneIndex,
        }
      })

      return {
        member: row.member,
        isExternal: row.isExternal,
        assignedMinutes: row.assignedMinutes,
        capacityMinutes: row.capacityMinutes,
        bars,
        laneCount: Math.max(laneRightEdges.length, 1),
      }
    })
  })

  return {
    allocationResult,
    selectedTeam,
    teamMembers,
    sprintWorkItems,
    workItemById,
    epicById,
    stageById,
    sprintWorkingDates,
    sprintWorkingDateSet,
    displayDates,
    slotsByMemberDate,
    memberRows,
    scheduleRows,
    summary,
    warningGroups,
    assignmentRecommendations,
    timelineRows,
    vacationDatesByMemberId,
    sprintTickets,
    workItemOutcomes,
    navItems,
    getSlots,
    getSlotStage,
    getSlotWorkItem,
    slotTitle,
    slotDirectionLabel,
    formatMinutes,
    formatDateLabel,
    stageToneByDirection,
    stageToneByType,
    getSlotToneClass,
    severityClasses,
  }
}
