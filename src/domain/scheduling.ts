import {
  CALENDAR_MEETING_BUFFER_MINUTES,
  EXTERNAL_DESIGNER_ID,
  EXTERNAL_DESIGNER_NAME,
  NON_RELEASE_DAYS,
  WORK_DAY_MINUTES,
  WORKING_DAYS,
  formatDate,
  formatDuration,
  type AllocationResult,
  type AssignmentReplacementRecommendation,
  type Epic,
  type PlanningStage,
  type PlanningStageType,
  type PlanningState,
  type PlanningWarning,
  type ReleaseSupportEstimates,
  type ScheduledSlot,
  type SchedulingPolicy,
  type Sprint,
  type TeamMember,
  type Weekday,
  type WorkDirection,
  type WorkItem,
} from './planning'

interface ScheduleMarker {
  date: string
  minute: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKING_DAY_SET = new Set<string>(WORKING_DAYS)
const NON_RELEASE_DAY_SET = new Set<string>(NON_RELEASE_DAYS)
const WEEKDAYS_BY_DATE_DAY: (Weekday | undefined)[] = [
  undefined,
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  undefined,
]

const releaseSupportDirections: [keyof ReleaseSupportEstimates, WorkDirection][] = [
  ['backend', 'backend'],
  ['frontend', 'frontend'],
  ['qa', 'qa'],
  ['ios', 'ios'],
  ['android', 'android'],
]

const stageLabels: Record<PlanningStageType, string> = {
  analysis: 'анализ',
  'backend-development': 'backend-разработка',
  documentation: 'документация',
  'frontend-development': 'frontend-разработка',
  'ios-development': 'iOS-разработка',
  'android-development': 'Android-разработка',
  'design-review': 'design review',
  'qa-test-case-writing': 'написание QA test cases',
  'qa-testing': 'QA testing',
  'release-support': 'release support',
}

const directionLabels: Record<WorkDirection, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  ios: 'iOS',
  android: 'Android',
  qa: 'QA',
}

const overlapSensitiveStageTypes = new Set<PlanningStageType>(['qa-testing', 'release-support'])

const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)

  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

const formatIsoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)

const addDays = (date: string, days: number) =>
  formatIsoDate(parseIsoDate(date) + days * MS_PER_DAY)

const getWeekday = (date: string) => WEEKDAYS_BY_DATE_DAY[new Date(parseIsoDate(date)).getUTCDay()]

const isWorkingDate = (date: string) => {
  const weekday = getWeekday(date)

  return Boolean(weekday && WORKING_DAY_SET.has(weekday))
}

const isSchedulableDate = (date: string, stageType: PlanningStageType) => {
  const weekday = getWeekday(date)

  if (!weekday || !WORKING_DAY_SET.has(weekday)) {
    return false
  }

  return stageType !== 'release-support' || !NON_RELEASE_DAY_SET.has(weekday)
}

const findNextSchedulableDate = (date: string, stageType: PlanningStageType) => {
  let candidate = date

  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    if (isSchedulableDate(candidate, stageType)) {
      return candidate
    }

    candidate = addDays(candidate, 1)
  }

  return date
}

const compareMarkers = (left: ScheduleMarker, right: ScheduleMarker) => {
  const dateComparison = left.date.localeCompare(right.date)

  if (dateComparison !== 0) {
    return dateComparison
  }

  return left.minute - right.minute
}

const maxMarker = (markers: ScheduleMarker[]) =>
  markers.reduce((latest, marker) => (compareMarkers(marker, latest) > 0 ? marker : latest))

export const getSprintWorkingDates = (sprint: Sprint) => {
  const dates: string[] = []

  for (let dayOffset = 0; dayOffset < sprint.durationWeeks * 7; dayOffset += 1) {
    const date = addDays(sprint.startsOn, dayOffset)

    if (isWorkingDate(date)) {
      dates.push(date)
    }
  }

  return dates
}

const getOrderedWorkItems = (
  workItems: WorkItem[],
  addWarning: (
    severity: PlanningWarning['severity'],
    message: string,
    details?: Pick<PlanningWarning, 'workItemId' | 'assigneeId'>,
  ) => void,
) => {
  const workItemById = new Map(workItems.map((workItem) => [workItem.id, workItem]))
  const orderedCandidates = [...workItems].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  )
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const ordered: WorkItem[] = []

  const visit = (workItem: WorkItem) => {
    if (visited.has(workItem.id)) {
      return
    }

    if (visiting.has(workItem.id)) {
      addWarning('error', `Обнаружена циклическая зависимость для "${workItem.title}".`, {
        workItemId: workItem.id,
      })
      return
    }

    visiting.add(workItem.id)

    workItem.dependencyIds.forEach((dependencyId) => {
      const dependency = workItemById.get(dependencyId)

      if (!dependency) {
        addWarning('warning', `Зависимость для "${workItem.title}" не найдена в этом спринте.`, {
          workItemId: workItem.id,
        })
        return
      }

      visit(dependency)
    })

    visiting.delete(workItem.id)
    visited.add(workItem.id)
    ordered.push(workItem)
  }

  orderedCandidates.forEach(visit)

  return ordered
}

const getStageTerminals = (stages: PlanningStage[]) => {
  const dependencyIds = new Set(stages.flatMap((stage) => stage.dependsOnStageIds))

  return stages.filter((stage) => !dependencyIds.has(stage.id)).map((stage) => stage.id)
}

const getEffectiveDailyCapacity = (member: TeamMember, date: string) => {
  const weekday = getWeekday(date)
  const meetingLoad = weekday ? (member.meetingLoadByWeekday?.[weekday] ?? 0) : 0
  const meetingOverload = Math.max(0, Math.round(meetingLoad) - CALENDAR_MEETING_BUFFER_MINUTES)

  return Math.max(0, Math.round(member.availableMinutesPerDay) - meetingOverload)
}

const getMaxEffectiveDailyCapacity = (member: TeamMember, stageType: PlanningStageType) =>
  Math.max(
    0,
    ...WORKING_DAYS.filter(
      (weekday) => stageType !== 'release-support' || !NON_RELEASE_DAY_SET.has(weekday),
    ).map((weekday) =>
      Math.max(
        0,
        Math.round(member.availableMinutesPerDay) -
          Math.max(
            0,
            Math.round(member.meetingLoadByWeekday?.[weekday] ?? 0) -
              CALENDAR_MEETING_BUFFER_MINUTES,
          ),
      ),
    ),
  )

const roleMatchesDirection = (member: TeamMember, direction: WorkDirection) => {
  if (direction === 'backend') {
    return member.role === 'backend' || member.role === 'tech-lead'
  }

  return member.role === direction
}

const hasTimeOverlap = (left: ScheduledSlot, right: ScheduledSlot) =>
  left.startsAtMinute < right.endsAtMinute && right.startsAtMinute < left.endsAtMinute

const formatShortList = (items: string[], limit = 3) => {
  const uniqueItems = [...new Set(items)]
  const visibleItems = uniqueItems.slice(0, limit)
  const remainingCount = uniqueItems.length - visibleItems.length

  return remainingCount > 0
    ? `${visibleItems.join(', ')} +${remainingCount}`
    : visibleItems.join(', ')
}

const getStageDirectionLabel = (stage: PlanningStage) =>
  stage.type === 'design-review' ? 'Review' : directionLabels[stage.direction]

const stageTypeScheduleWeight: Record<PlanningStageType, number> = {
  analysis: 10,
  'backend-development': 20,
  'frontend-development': 30,
  'ios-development': 30,
  'android-development': 30,
  'design-review': 40,
  'qa-test-case-writing': 25,
  'qa-testing': 50,
  // Documentation is deprioritized: scheduled last among dev/QA units, but before release.
  documentation: 55,
  'release-support': 60,
}

interface ScheduleOrderUnit {
  id: string
  stageIds: string[]
  dependencyStageIds: string[]
}

/** Pre-computed per-unit properties that are invariant across beam candidates. */
interface UnitStaticProps {
  highestPriority: number
  isReleaseUnit: boolean
  isReleaseWork: boolean
  /** First stage by stageIds order - used for compareUnits. */
  firstStage: PlanningStage | undefined
  /** Minimum stage by fallbackCompareStages - used for stageTypeScore. */
  representativeStage: PlanningStage | undefined
  stageTypeScore: number
  priorityScore: number
  releaseScore: number
  isDocumentationUnit: boolean
  /** Max critical path remaining minutes: stage.estimateMinutes + max(criticalPath(downstream)). */
  criticalPathMinutes: number
  /** Stages directly unblocked once this unit completes - high value means more parallel work starts. */
  downstreamFanOut: number
}

interface ScheduleOrderCandidate {
  orderedUnitIds: string[]
  /** Mirror of orderedUnitIds as a Set for O(1) membership test. */
  orderedUnitIdSet: Set<string>
  scheduledStageIds: Set<string>
  score: number
  /** Stable serial number assigned at creation - used as a cheap tiebreaker. */
  serial: number
}

export const schedulingPolicies: Record<SchedulingPolicy['id'], SchedulingPolicy> = {
  'release-first': {
    id: 'release-first',
    label: 'Release first',
    beamWidth: 8,
    readyBranchLimit: 10,
    releaseStageScoreBonus: 150,
    releaseWorkScoreBonus: 45,
    priorityScoreStep: 18,
    earlyPositionScorePenalty: 2,
    documentationDeprioritizePenalty: 40,
    criticalPathScoreFactor: 0.1,
    downstreamFanScorePerStage: 6,
    targetLoadPercent: 80,
    minRecommendationGainMinutes: 120,
    minRecommendationGainPercent: 5,
    maxAssignmentRecommendations: 5,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    beamWidth: 8,
    readyBranchLimit: 10,
    releaseStageScoreBonus: 120,
    releaseWorkScoreBonus: 35,
    priorityScoreStep: 18,
    earlyPositionScorePenalty: 2,
    documentationDeprioritizePenalty: 40,
    criticalPathScoreFactor: 0.1,
    downstreamFanScorePerStage: 6,
    targetLoadPercent: 80,
    minRecommendationGainMinutes: 120,
    minRecommendationGainPercent: 5,
    maxAssignmentRecommendations: 5,
  },
  'critical-path': {
    id: 'critical-path',
    label: 'Critical path',
    beamWidth: 8,
    readyBranchLimit: 10,
    releaseStageScoreBonus: 105,
    releaseWorkScoreBonus: 30,
    priorityScoreStep: 18,
    earlyPositionScorePenalty: 2,
    documentationDeprioritizePenalty: 40,
    criticalPathScoreFactor: 0.16,
    downstreamFanScorePerStage: 9,
    targetLoadPercent: 80,
    minRecommendationGainMinutes: 120,
    minRecommendationGainPercent: 5,
    maxAssignmentRecommendations: 5,
  },
  'no-overflow': {
    id: 'no-overflow',
    label: 'No overflow',
    beamWidth: 10,
    readyBranchLimit: 12,
    releaseStageScoreBonus: 110,
    releaseWorkScoreBonus: 30,
    priorityScoreStep: 16,
    earlyPositionScorePenalty: 1,
    documentationDeprioritizePenalty: 35,
    criticalPathScoreFactor: 0.12,
    downstreamFanScorePerStage: 7,
    targetLoadPercent: 80,
    minRecommendationGainMinutes: 120,
    minRecommendationGainPercent: 5,
    maxAssignmentRecommendations: 5,
  },
}

const DEFAULT_SCHEDULING_POLICY = schedulingPolicies.balanced

export function scheduleSprint(
  state: PlanningState,
  sprintId: string,
  generatedAt = new Date().toISOString(),
  policy: SchedulingPolicy = DEFAULT_SCHEDULING_POLICY,
): AllocationResult | undefined {
  const sprint = state.sprints.find((candidate) => candidate.id === sprintId)

  if (!sprint) {
    return undefined
  }

  const warnings: PlanningWarning[] = []
  const addWarning = (
    severity: PlanningWarning['severity'],
    message: string,
    details: Pick<PlanningWarning, 'workItemId' | 'assigneeId'> = {},
  ) => {
    warnings.push({
      id: `warning-${warnings.length + 1}`,
      severity,
      message,
      ...details,
    })
  }

  const sprintDates = getSprintWorkingDates(sprint)
  const sprintDateSet = new Set(sprintDates)
  const sprintStart: ScheduleMarker = {
    date: sprintDates[0] ?? sprint.startsOn,
    minute: 0,
  }

  if (!sprintDates.length) {
    addWarning('error', `В спринте "${sprint.name}" нет рабочих дней для распределения.`)
  }

  const teamMembers = state.members.filter((member) => member.teamId === sprint.teamId)

  // Vacation dates per member (only sprint working dates)
  const memberVacationDates = new Map<string, Set<string>>()
  const vacations = state.vacations ?? []
  teamMembers.forEach((member) => {
    const memberVacations = vacations.filter((v) => v.memberId === member.id)
    if (!memberVacations.length) return
    const vacationDates = new Set<string>()
    sprintDates.forEach((date) => {
      if (memberVacations.some((v) => date >= v.startDate && date <= v.endDate)) {
        vacationDates.add(date)
      }
    })
    if (vacationDates.size > 0) {
      memberVacationDates.set(member.id, vacationDates)
    }
  })

  const getMemberDailyCapacity = (member: TeamMember, date: string) => {
    if (memberVacationDates.get(member.id)?.has(date)) {
      return 0
    }
    return getEffectiveDailyCapacity(member, date)
  }
  const externalDesigner: TeamMember = {
    id: EXTERNAL_DESIGNER_ID,
    teamId: sprint.teamId,
    name: EXTERNAL_DESIGNER_NAME,
    role: 'frontend',
    availableMinutesPerDay: WORK_DAY_MINUTES,
    meetingLoadByWeekday: {
      monday: 0,
      tuesday: 0,
      wednesday: 0,
      thursday: 0,
      friday: 0,
    },
  }
  const memberById = new Map(
    [...teamMembers, externalDesigner].map((member) => [member.id, member]),
  )
  teamMembers.forEach((member) => {
    const sprintMeetingOverloadMinutes = sprintDates.reduce((total, date) => {
      const weekday = getWeekday(date)

      return (
        total +
        (weekday
          ? Math.max(
              0,
              Math.round(member.meetingLoadByWeekday?.[weekday] ?? 0) -
                CALENDAR_MEETING_BUFFER_MINUTES,
            )
          : 0)
      )
    }, 0)

    if (sprintMeetingOverloadMinutes > 0) {
      addWarning(
        'info',
        `${member.name}: календарь сверх 2 ч/день уменьшает доступность в спринте на ${formatDuration(sprintMeetingOverloadMinutes)}.`,
        {
          assigneeId: member.id,
        },
      )
    }

    const vacationDates = memberVacationDates.get(member.id)
    if (vacationDates && vacationDates.size > 0) {
      if (vacationDates.size === sprintDates.length) {
        addWarning('info', `${member.name} в отпуске весь спринт и исключён из автоназначения.`, {
          assigneeId: member.id,
        })
      } else {
        addWarning(
          'info',
          `${member.name}: ${vacationDates.size} раб. дн. в отпуске — доступность в спринте уменьшена.`,
          { assigneeId: member.id },
        )
      }
    }
  })
  const workItems = state.workItems.filter((workItem) => workItem.sprintId === sprintId)
  const orderedWorkItems = getOrderedWorkItems(workItems, addWarning)
  const workItemById = new Map(workItems.map((workItem) => [workItem.id, workItem]))
  const epics = state.epics.filter((epic) => epic.sprintId === sprintId)
  const epicById = new Map(epics.map((epic) => [epic.id, epic]))
  const epicWorkItemIds = new Set(epics.flatMap((epic) => epic.workItemIds))
  const stages: PlanningStage[] = []
  const stagesByWorkItemId = new Map<string, PlanningStage[]>()
  const terminalStageIdsByWorkItemId = new Map<string, string[]>()
  const releaseDependencyStageIdsByWorkItemId = new Map<string, string[]>()
  const schedulePriorityByStageId = new Map<string, number>()
  const releaseGroupKeyByStageId = new Map<string, string>()
  const releaseGroupStageIdsByKey = new Map<string, string[]>()

  const addReleaseStageToGroup = (stage: PlanningStage, groupKey: string) => {
    releaseGroupKeyByStageId.set(stage.id, groupKey)
    const groupIds = releaseGroupStageIdsByKey.get(groupKey)
    if (groupIds) {
      groupIds.push(stage.id)
    } else {
      releaseGroupStageIdsByKey.set(groupKey, [stage.id])
    }
  }

  const getStageAssigneeCandidates = (stage: PlanningStage) =>
    teamMembers.filter((member) => {
      if (stage.type === 'design-review') {
        return false
      }

      return roleMatchesDirection(member, stage.direction)
    })

  const addWorkItemInputHints = (workItem: WorkItem) => {
    const developmentMinutes =
      workItem.estimates.backend +
      workItem.estimates.documentation +
      workItem.estimates.frontend +
      workItem.estimates.ios +
      workItem.estimates.android
    const releaseMinutes = workItem.requiresReleaseSupport
      ? releaseSupportDirections.reduce(
          (total, [estimateKey]) => total + workItem.releaseSupport[estimateKey],
          0,
        )
      : 0
    const designReviewMinutes = workItem.requiresDesignReview
      ? Math.max(0, Math.round(workItem.designReviewEstimateMinutes ?? 0))
      : 0

    if (developmentMinutes > 0 && workItem.estimates.qaTesting <= 0) {
      addWarning(
        'info',
        `"${workItem.title}" не имеет оценки QA testing; тестирование не будет запланировано.`,
        {
          workItemId: workItem.id,
        },
      )
    }

    if (workItem.estimates.qaTesting > 0 && developmentMinutes <= 0) {
      addWarning('info', `"${workItem.title}" имеет QA testing без dev-оценок.`, {
        workItemId: workItem.id,
      })
    }

    if (workItem.requiresReleaseSupport && !workItem.epicId && releaseMinutes <= 0) {
      addWarning(
        'warning',
        `"${workItem.title}" помечена для релиза, но минуты сопровождения не заполнены.`,
        {
          workItemId: workItem.id,
        },
      )
    }

    if (workItem.requiresDesignReview && designReviewMinutes <= 0) {
      addWarning(
        'warning',
        `"${workItem.title}" требует design review, но оценка review не заполнена.`,
        {
          workItemId: workItem.id,
        },
      )
    }
  }

  const addStage = (stage: PlanningStage) => {
    stages.push(stage)
    schedulePriorityByStageId.set(stage.id, workItemById.get(stage.workItemId)?.priority ?? 0)
    const existingWorkItemStages = stagesByWorkItemId.get(stage.workItemId)
    if (existingWorkItemStages) {
      existingWorkItemStages.push(stage)
    } else {
      stagesByWorkItemId.set(stage.workItemId, [stage])
    }
  }

  orderedWorkItems.forEach((workItem) => {
    addWorkItemInputHints(workItem)

    const workItemStages: PlanningStage[] = []

    const addWorkItemStage = (
      type: PlanningStageType,
      direction: WorkDirection,
      estimateMinutes: number,
      dependsOnStageIds: string[] = [],
      assigneeId = workItem.assignments[direction],
    ) => {
      if (estimateMinutes <= 0) {
        return undefined
      }

      const stage: PlanningStage = {
        id: `stage-${workItem.id}-${type}`,
        workItemId: workItem.id,
        epicId: workItem.epicId,
        type,
        direction,
        assigneeId,
        estimateMinutes,
        dependsOnStageIds,
      }

      workItemStages.push(stage)
      addStage(stage)

      return stage
    }

    const backendStage = addWorkItemStage(
      'backend-development',
      'backend',
      workItem.estimates.backend,
    )
    // Documentation: depends on backend, does NOT block QA testing.
    // It becomes a terminal stage → getStageTerminals() picks it up into releaseDependencyStageIds,
    // so release support cannot start until documentation is done.
    addWorkItemStage(
      'documentation',
      'backend',
      workItem.estimates.documentation,
      backendStage ? [backendStage.id] : [],
      workItem.assignments.backend,
    )
    const qaTestCaseStage = addWorkItemStage(
      'qa-test-case-writing',
      'qa',
      workItem.estimates.qaTestCaseWriting,
    )
    const frontendStage = addWorkItemStage(
      'frontend-development',
      'frontend',
      workItem.estimates.frontend,
      !workItem.developmentFlow.backendFrontendParallel && backendStage ? [backendStage.id] : [],
    )
    const iosStage = addWorkItemStage(
      'ios-development',
      'ios',
      workItem.estimates.ios,
      !workItem.developmentFlow.mobileParallelWithBackend && backendStage ? [backendStage.id] : [],
    )
    const androidStage = addWorkItemStage(
      'android-development',
      'android',
      workItem.estimates.android,
      !workItem.developmentFlow.mobileParallelWithBackend && backendStage ? [backendStage.id] : [],
    )
    // developmentStageIds intentionally excludes documentationStage:
    // documentation does not block QA testing; it becomes a terminal stage and thus
    // automatically appears in releaseDependencyStageIds (blocking release support).
    const developmentStageIds = [
      backendStage?.id,
      frontendStage?.id,
      iosStage?.id,
      androidStage?.id,
    ].filter((stageId): stageId is string => Boolean(stageId))
    const designReviewEstimateMinutes = workItem.requiresDesignReview
      ? Math.max(0, Math.round(workItem.designReviewEstimateMinutes ?? 0))
      : 0
    const designReviewStage = addWorkItemStage(
      'design-review',
      'frontend',
      designReviewEstimateMinutes,
      developmentStageIds,
      EXTERNAL_DESIGNER_ID,
    )

    addWorkItemStage(
      'qa-testing',
      'qa',
      workItem.estimates.qaTesting,
      [...developmentStageIds, qaTestCaseStage?.id].filter((stageId): stageId is string =>
        Boolean(stageId),
      ),
    )

    const terminalStageIds = getStageTerminals(
      workItemStages.filter((stage) => stage.type !== 'design-review'),
    )
    const releaseDependencyStageIds = [...terminalStageIds, designReviewStage?.id].filter(
      (stageId): stageId is string => Boolean(stageId),
    )
    releaseDependencyStageIdsByWorkItemId.set(workItem.id, releaseDependencyStageIds)

    if (!workItem.epicId && workItem.requiresReleaseSupport) {
      const releaseStages = releaseSupportDirections.flatMap(([estimateKey, direction]) => {
        const estimateMinutes = workItem.releaseSupport[estimateKey]

        if (estimateMinutes <= 0) {
          return []
        }

        const stage: PlanningStage = {
          id: `stage-${workItem.id}-release-support-${direction}`,
          workItemId: workItem.id,
          type: 'release-support',
          direction,
          assigneeId: workItem.assignments[direction],
          estimateMinutes,
          dependsOnStageIds: releaseDependencyStageIds,
        }

        addStage(stage)
        addReleaseStageToGroup(stage, `work-item:${workItem.id}`)

        return [stage]
      })

      terminalStageIdsByWorkItemId.set(
        workItem.id,
        releaseStages.length ? releaseStages.map((stage) => stage.id) : terminalStageIds,
      )
      return
    }

    terminalStageIdsByWorkItemId.set(workItem.id, terminalStageIds)
  })

  epics.forEach((epic: Epic) => {
    const epicWorkItems = epic.workItemIds
      .map((workItemId) => workItemById.get(workItemId))
      .filter((workItem): workItem is WorkItem => Boolean(workItem))
      .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))

    if (!epicWorkItems.length) {
      return
    }

    const fallbackWorkItem = epicWorkItems[0]

    if (!fallbackWorkItem) {
      return
    }

    const epicSchedulePriority = Math.min(...epicWorkItems.map((workItem) => workItem.priority))
    const releaseDependencyIds = epicWorkItems.flatMap(
      (workItem) => releaseDependencyStageIdsByWorkItemId.get(workItem.id) ?? [],
    )
    const releaseStages = releaseSupportDirections.flatMap(([estimateKey, direction]) => {
      const estimateMinutes = epic.releaseSupport[estimateKey]

      if (estimateMinutes <= 0) {
        return []
      }

      const assigneeId = epicWorkItems.find((workItem) => workItem.assignments[direction])
        ?.assignments[direction]

      const stage: PlanningStage = {
        id: `stage-${epic.id}-release-support-${direction}`,
        workItemId: fallbackWorkItem.id,
        epicId: epic.id,
        type: 'release-support',
        direction,
        assigneeId,
        estimateMinutes,
        dependsOnStageIds: releaseDependencyIds,
      }

      addStage(stage)
      schedulePriorityByStageId.set(stage.id, epicSchedulePriority)
      addReleaseStageToGroup(stage, `epic:${epic.id}`)

      return [stage]
    })

    if (!releaseStages.length) {
      return
    }

    epicWorkItems.forEach((workItem) => {
      terminalStageIdsByWorkItemId.set(
        workItem.id,
        releaseStages.map((stage) => stage.id),
      )
    })
  })

  orderedWorkItems.forEach((workItem) => {
    const dependencyTerminalStageIds = workItem.dependencyIds.flatMap(
      (dependencyId) => terminalStageIdsByWorkItemId.get(dependencyId) ?? [],
    )

    if (!dependencyTerminalStageIds.length) {
      return
    }

    const workItemStages = stagesByWorkItemId.get(workItem.id) ?? []

    workItemStages
      .filter((stage) => !stage.dependsOnStageIds.length)
      .forEach((stage) => {
        stage.dependsOnStageIds = [
          ...new Set([...dependencyTerminalStageIds, ...stage.dependsOnStageIds]),
        ]
      })
  })

  const sprintCapacityByMemberId = new Map(
    teamMembers.map((member) => [
      member.id,
      sprintDates.reduce((total, date) => total + getMemberDailyCapacity(member, date), 0),
    ]),
  )
  const manualAssigneeIdByStageId = new Map(
    stages
      .filter((stage) => stage.assigneeId && stage.assigneeId !== EXTERNAL_DESIGNER_ID)
      .map((stage) => [stage.id, stage.assigneeId as string]),
  )
  stages.forEach((stage) => {
    if (stage.assigneeId) {
      const assignee = memberById.get(stage.assigneeId)

      if (
        assignee &&
        stage.type !== 'design-review' &&
        !roleMatchesDirection(assignee, stage.direction)
      ) {
        addWarning(
          'warning',
          `${assignee.name} назначен на ${stageLabels[stage.type]}, но роль не совпадает с направлением ${getStageDirectionLabel(stage)}.`,
          {
            workItemId: stage.workItemId,
            assigneeId: assignee.id,
          },
        )
      }

      return
    }
  })

  const stageById = new Map(stages.map((stage) => [stage.id, stage]))
  const completionByStageId = new Map<string, ScheduleMarker>()
  const visitingStageIds = new Set<string>()

  const getQaTestCaseStage = (stage: PlanningStage) =>
    stage.type === 'qa-testing'
      ? stagesByWorkItemId
          .get(stage.workItemId)
          ?.find((candidate) => candidate.type === 'qa-test-case-writing')
      : undefined

  const inheritQaTestingAssigneeFromTestCases = (stage: PlanningStage) => {
    if (stage.assigneeId) {
      return
    }

    const testCaseStage = getQaTestCaseStage(stage)

    if (testCaseStage?.assigneeId) {
      stage.assigneeId = testCaseStage.assigneeId
    }
  }
  const slots: ScheduledSlot[] = []
  const occupiedSlotsByMemberDate = new Map<string, ScheduledSlot[]>()

  const getOccupiedSlots = (memberId: string, date: string) =>
    (occupiedSlotsByMemberDate.get(`${memberId}:${date}`) ?? []).sort(
      (left, right) => left.startsAtMinute - right.startsAtMinute,
    )

  const addOccupiedSlot = (slot: ScheduledSlot) => {
    const key = `${slot.assigneeId}:${slot.date}`
    const existing = occupiedSlotsByMemberDate.get(key)
    if (existing) {
      existing.push(slot)
    } else {
      occupiedSlotsByMemberDate.set(key, [slot])
    }
  }

  const findAvailableSegment = (
    stage: PlanningStage,
    assignee: TeamMember,
    date: string,
    requestedMinute: number,
  ) => {
    if (!isSchedulableDate(date, stage.type)) {
      return undefined
    }

    const dailyCapacity = getMemberDailyCapacity(assignee, date)
    let cursor = Math.max(0, Math.round(requestedMinute))

    if (cursor >= dailyCapacity) {
      return undefined
    }

    for (const occupiedSlot of getOccupiedSlots(assignee.id, date)) {
      if (occupiedSlot.endsAtMinute <= cursor) {
        continue
      }

      if (occupiedSlot.startsAtMinute > cursor) {
        return {
          startsAtMinute: cursor,
          availableMinutes: occupiedSlot.startsAtMinute - cursor,
        }
      }

      cursor = Math.max(cursor, occupiedSlot.endsAtMinute)

      if (cursor >= dailyCapacity) {
        return undefined
      }
    }

    return {
      startsAtMinute: cursor,
      availableMinutes: dailyCapacity - cursor,
    }
  }

  const getAvailableStartMinute = (
    stage: PlanningStage,
    assignee: TeamMember,
    date: string,
    requestedMinute: number,
  ) => {
    const availableSegment = findAvailableSegment(stage, assignee, date, requestedMinute)

    return availableSegment?.startsAtMinute
  }

  const previewStageCompletion = (
    stage: PlanningStage,
    assignee: TeamMember,
    earliestStart: ScheduleMarker,
  ) => {
    const maxDailyCapacity = getMaxEffectiveDailyCapacity(assignee, stage.type)
    let remainingMinutes = Math.max(0, Math.round(stage.estimateMinutes))
    let date = findNextSchedulableDate(earliestStart.date, stage.type)
    let minute = date === earliestStart.date ? earliestStart.minute : 0
    let completion = { date, minute }

    if (maxDailyCapacity <= 0) {
      return undefined
    }

    for (let guard = 0; remainingMinutes > 0 && guard < 740; guard += 1) {
      if (!isSchedulableDate(date, stage.type)) {
        date = findNextSchedulableDate(addDays(date, 1), stage.type)
        minute = 0
        continue
      }

      const availableSegment = findAvailableSegment(stage, assignee, date, minute)

      if (!availableSegment || availableSegment.availableMinutes <= 0) {
        date = findNextSchedulableDate(addDays(date, 1), stage.type)
        minute = 0
        continue
      }

      const startsAtMinute = availableSegment.startsAtMinute
      const slotMinutes = Math.min(
        remainingMinutes,
        availableSegment.availableMinutes,
        WORK_DAY_MINUTES,
      )
      const endsAtMinute = startsAtMinute + slotMinutes

      remainingMinutes -= slotMinutes
      completion = {
        date,
        minute: endsAtMinute,
      }

      if (remainingMinutes > 0) {
        const dailyCapacity = getMemberDailyCapacity(assignee, date)

        if (endsAtMinute < dailyCapacity) {
          minute = endsAtMinute
        } else {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
        }
      }
    }

    return remainingMinutes > 0 ? undefined : completion
  }

  const getAssignedSprintMinutes = (memberId: string) =>
    slots
      .filter((slot) => slot.assigneeId === memberId && sprintDateSet.has(slot.date))
      .reduce((total, slot) => total + slot.minutes, 0)

  const selectEarliestCompletionAssignee = (
    stage: PlanningStage,
    earliestStart: ScheduleMarker,
  ) => {
    const candidates = getStageAssigneeCandidates(stage).filter(
      (member) =>
        getMaxEffectiveDailyCapacity(member, stage.type) > 0 &&
        (sprintCapacityByMemberId.get(member.id) ?? 0) > 0,
    )

    return candidates
      .map((candidate) => ({
        candidate,
        completion: previewStageCompletion(stage, candidate, earliestStart),
        load:
          getAssignedSprintMinutes(candidate.id) /
          Math.max(sprintCapacityByMemberId.get(candidate.id) ?? 0, 1),
        reserve: sprintCapacityByMemberId.get(candidate.id) ?? 0,
      }))
      .filter(
        (
          item,
        ): item is {
          candidate: TeamMember
          completion: ScheduleMarker
          load: number
          reserve: number
        } => Boolean(item.completion),
      )
      .sort((left, right) => {
        const completionComparison = compareMarkers(left.completion, right.completion)

        if (completionComparison !== 0) {
          return completionComparison
        }

        if (left.load !== right.load) {
          return left.load - right.load
        }

        return right.reserve - left.reserve
      })[0]?.candidate
  }

  const allocateStage = (
    stage: PlanningStage,
    assignee: TeamMember,
    earliestStart: ScheduleMarker,
  ) => {
    const stageSlots: ScheduledSlot[] = []
    const maxDailyCapacity = getMaxEffectiveDailyCapacity(assignee, stage.type)
    let remainingMinutes = Math.max(0, Math.round(stage.estimateMinutes))
    let date = findNextSchedulableDate(earliestStart.date, stage.type)
    let minute = date === earliestStart.date ? earliestStart.minute : 0
    let completion = { date, minute }

    if (maxDailyCapacity <= 0) {
      addWarning(
        'error',
        `${assignee.name} не имеет доступного времени для этапа с учетом календаря.`,
        {
          workItemId: stage.workItemId,
          assigneeId: assignee.id,
        },
      )
      return { completion, stageSlots }
    }

    for (let guard = 0; remainingMinutes > 0 && guard < 740; guard += 1) {
      if (!isSchedulableDate(date, stage.type)) {
        date = findNextSchedulableDate(addDays(date, 1), stage.type)
        minute = 0
        continue
      }

      const availableSegment = findAvailableSegment(stage, assignee, date, minute)

      if (!availableSegment || availableSegment.availableMinutes <= 0) {
        date = findNextSchedulableDate(addDays(date, 1), stage.type)
        minute = 0
        continue
      }

      const startsAtMinute = availableSegment.startsAtMinute
      const slotMinutes = Math.min(
        remainingMinutes,
        availableSegment.availableMinutes,
        WORK_DAY_MINUTES,
      )
      const endsAtMinute = startsAtMinute + slotMinutes
      const slot: ScheduledSlot = {
        id: `slot-${stage.id}-${date}-${stageSlots.length + 1}`,
        sprintId,
        stageId: stage.id,
        workItemId: stage.workItemId,
        assigneeId: assignee.id,
        date,
        minutes: slotMinutes,
        startsAtMinute,
        endsAtMinute,
      }

      stageSlots.push(slot)
      addOccupiedSlot(slot)
      remainingMinutes -= slotMinutes
      completion = {
        date,
        minute: endsAtMinute,
      }

      if (remainingMinutes > 0) {
        const dailyCapacity = getMemberDailyCapacity(assignee, date)

        if (endsAtMinute < dailyCapacity) {
          minute = endsAtMinute
        } else {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
        }
      }
    }

    if (remainingMinutes > 0) {
      addWarning(
        'error',
        'Этап не удалось полностью распределить в пределах расчетного горизонта.',
        {
          workItemId: stage.workItemId,
          assigneeId: assignee.id,
        },
      )
    }

    return { completion, stageSlots }
  }

  const scheduleStage = (stage: PlanningStage): ScheduleMarker => {
    const scheduledCompletion = completionByStageId.get(stage.id)

    if (scheduledCompletion) {
      return scheduledCompletion
    }

    if (visitingStageIds.has(stage.id)) {
      addWarning('error', 'Обнаружена циклическая зависимость между этапами.', {
        workItemId: stage.workItemId,
      })
      completionByStageId.set(stage.id, sprintStart)
      return sprintStart
    }

    const releaseGroupKey = releaseGroupKeyByStageId.get(stage.id)

    if (releaseGroupKey) {
      return scheduleReleaseGroup(releaseGroupKey, stage.id)
    }

    visitingStageIds.add(stage.id)

    const dependencyMarkers = stage.dependsOnStageIds.map((dependencyStageId) => {
      const dependencyStage = stageById.get(dependencyStageId)

      if (!dependencyStage) {
        addWarning('warning', 'Зависимость этапа не найдена и будет пропущена.', {
          workItemId: stage.workItemId,
        })
        return sprintStart
      }

      return scheduleStage(dependencyStage)
    })
    const earliestStart = dependencyMarkers.length
      ? maxMarker([sprintStart, ...dependencyMarkers])
      : sprintStart

    visitingStageIds.delete(stage.id)
    inheritQaTestingAssigneeFromTestCases(stage)

    if (!stage.assigneeId) {
      const selectedCandidate = selectEarliestCompletionAssignee(stage, earliestStart)

      if (!selectedCandidate) {
        addWarning('error', `Для этапа ${stage.type} не назначен исполнитель.`, {
          workItemId: stage.workItemId,
        })
        completionByStageId.set(stage.id, earliestStart)
        return earliestStart
      }

      stage.assigneeId = selectedCandidate.id
      addWarning(
        'info',
        `${selectedCandidate.name} автоназначен на ${stageLabels[stage.type]} (${getStageDirectionLabel(stage)}), потому что завершит этап раньше доступных кандидатов.`,
        {
          workItemId: stage.workItemId,
          assigneeId: selectedCandidate.id,
        },
      )
    }

    const assignee = memberById.get(stage.assigneeId)

    if (!assignee) {
      addWarning('error', `Исполнитель этапа ${stage.type} не найден в команде спринта.`, {
        workItemId: stage.workItemId,
        assigneeId: stage.assigneeId,
      })
      completionByStageId.set(stage.id, earliestStart)
      return earliestStart
    }

    const { completion, stageSlots } = allocateStage(stage, assignee, earliestStart)


    slots.push(...stageSlots)
    completionByStageId.set(stage.id, completion)

    return completion
  }

  const scheduleReleaseGroup = (groupKey: string, requestedStageId: string): ScheduleMarker => {
    const requestedScheduledCompletion = completionByStageId.get(requestedStageId)

    if (requestedScheduledCompletion) {
      return requestedScheduledCompletion
    }

    const groupStages = (releaseGroupStageIdsByKey.get(groupKey) ?? [])
      .map((stageId) => stageById.get(stageId))
      .filter((stage): stage is PlanningStage => Boolean(stage))

    if (!groupStages.length) {
      return sprintStart
    }

    const dependencyMarkers = groupStages.flatMap((groupStage) =>
      groupStage.dependsOnStageIds.map((dependencyStageId) => {
        const dependencyStage = stageById.get(dependencyStageId)

        if (!dependencyStage) {
          addWarning('warning', 'Зависимость этапа не найдена и будет пропущена.', {
            workItemId: groupStage.workItemId,
          })
          return sprintStart
        }

        return scheduleStage(dependencyStage)
      }),
    )
    const earliestStart = dependencyMarkers.length
      ? maxMarker([sprintStart, ...dependencyMarkers])
      : sprintStart

    groupStages.forEach((groupStage) => {
      if (groupStage.assigneeId) {
        return
      }

      const selectedCandidate = selectEarliestCompletionAssignee(groupStage, earliestStart)

      if (!selectedCandidate) {
        return
      }

      groupStage.assigneeId = selectedCandidate.id
      addWarning(
        'info',
        `${selectedCandidate.name} автоназначен на release support (${getStageDirectionLabel(groupStage)}), потому что завершит этап раньше доступных кандидатов.`,
        {
          workItemId: groupStage.workItemId,
          assigneeId: selectedCandidate.id,
        },
      )
    })

    const releaseAssignees = groupStages.map((groupStage) => ({
      stage: groupStage,
      assignee: groupStage.assigneeId ? memberById.get(groupStage.assigneeId) : undefined,
    }))
    const missingAssignee = releaseAssignees.find(({ stage, assignee }) => {
      if (assignee) {
        return false
      }

      addWarning(
        'error',
        stage.assigneeId
          ? `Исполнитель этапа ${stage.type} не найден в команде спринта.`
          : `Для этапа ${stage.type} не назначен исполнитель.`,
        {
          workItemId: stage.workItemId,
          assigneeId: stage.assigneeId,
        },
      )
        completionByStageId.set(stage.id, earliestStart)

      return true
    })

    if (missingAssignee) {
      return completionByStageId.get(requestedStageId) ?? earliestStart
    }

    let alignedStart = {
      date: findNextSchedulableDate(earliestStart.date, 'release-support'),
      minute: 0,
    }

    if (alignedStart.date === earliestStart.date) {
      alignedStart.minute = earliestStart.minute
    }

    for (let guard = 0; guard < 740; guard += 1) {
      const startMinutes = releaseAssignees.map(({ stage, assignee }) =>
        getAvailableStartMinute(
          stage,
          assignee as TeamMember,
          alignedStart.date,
          alignedStart.minute,
        ),
      )

      if (startMinutes.every((minute): minute is number => typeof minute === 'number')) {
        const commonStartMinute = Math.max(...startMinutes)
        const startMinutesAtCommonStart = releaseAssignees.map(({ stage, assignee }) =>
          getAvailableStartMinute(
            stage,
            assignee as TeamMember,
            alignedStart.date,
            commonStartMinute,
          ),
        )
        const canStartTogether = startMinutesAtCommonStart.every(
          (minute) => minute === commonStartMinute,
        )

        if (canStartTogether) {
          alignedStart = {
            date: alignedStart.date,
            minute: commonStartMinute,
          }
          break
        }

        const nextSameDayMinute = Math.min(
          ...startMinutesAtCommonStart.filter(
            (minute): minute is number => typeof minute === 'number' && minute > commonStartMinute,
          ),
        )

        if (Number.isFinite(nextSameDayMinute)) {
          alignedStart = {
            date: alignedStart.date,
            minute: nextSameDayMinute,
          }
          continue
        }
      }

      alignedStart = {
        date: findNextSchedulableDate(addDays(alignedStart.date, 1), 'release-support'),
        minute: 0,
      }
    }

    groupStages.forEach((groupStage) => {
      if (completionByStageId.has(groupStage.id)) {
        return
      }

      const assignee = memberById.get(groupStage.assigneeId ?? '')

      if (!assignee) {
        completionByStageId.set(groupStage.id, alignedStart)
        return
      }

      const { completion, stageSlots } = allocateStage(groupStage, assignee, alignedStart)


      slots.push(...stageSlots)
      completionByStageId.set(groupStage.id, completion)
    })

    return completionByStageId.get(requestedStageId) ?? alignedStart
  }

  const getMarkerOrdinal = (marker: ScheduleMarker) =>
    Math.max(0, Math.round((parseIsoDate(marker.date) - parseIsoDate(sprintStart.date)) / MS_PER_DAY)) *
      WORK_DAY_MINUTES +
    marker.minute

  const simulateStageOrder = (
    orderedStages: PlanningStage[],
    assigneeOverrides = new Map<string, string>(),
  ) => {
    const simulatedCompletionByStageId = new Map<string, ScheduleMarker>()
    const simulatedVisitingStageIds = new Set<string>()
    const simulatedSlots: ScheduledSlot[] = []
    const simulatedOccupiedSlotsByMemberDate = new Map<string, ScheduledSlot[]>()

    const getSimulatedQaTestCaseAssigneeId = (stage: PlanningStage) => {
      const testCaseStage = getQaTestCaseStage(stage)

      if (!testCaseStage) {
        return undefined
      }

      return (
        assigneeOverrides.get(testCaseStage.id) ??
        testCaseStage.assigneeId ??
        simulatedSlots.find((slot) => slot.stageId === testCaseStage.id)?.assigneeId
      )
    }

    const getSimulatedOccupiedSlots = (memberId: string, date: string) =>
      (simulatedOccupiedSlotsByMemberDate.get(`${memberId}:${date}`) ?? []).sort(
        (left, right) => left.startsAtMinute - right.startsAtMinute,
      )

    const addSimulatedOccupiedSlot = (slot: ScheduledSlot) => {
      const key = `${slot.assigneeId}:${slot.date}`
      const existing = simulatedOccupiedSlotsByMemberDate.get(key)
      if (existing) {
        existing.push(slot)
      } else {
        simulatedOccupiedSlotsByMemberDate.set(key, [slot])
      }
    }

    const findSimulatedAvailableSegment = (
      stage: PlanningStage,
      assignee: TeamMember,
      date: string,
      requestedMinute: number,
    ) => {
      if (!isSchedulableDate(date, stage.type)) {
        return undefined
      }

      const dailyCapacity = getMemberDailyCapacity(assignee, date)
      let cursor = Math.max(0, Math.round(requestedMinute))

      if (cursor >= dailyCapacity) {
        return undefined
      }

      for (const occupiedSlot of getSimulatedOccupiedSlots(assignee.id, date)) {
        if (occupiedSlot.endsAtMinute <= cursor) {
          continue
        }

        if (occupiedSlot.startsAtMinute > cursor) {
          return {
            startsAtMinute: cursor,
            availableMinutes: occupiedSlot.startsAtMinute - cursor,
          }
        }

        cursor = Math.max(cursor, occupiedSlot.endsAtMinute)

        if (cursor >= dailyCapacity) {
          return undefined
        }
      }

      return {
        startsAtMinute: cursor,
        availableMinutes: dailyCapacity - cursor,
      }
    }

    const getSimulatedAvailableStartMinute = (
      stage: PlanningStage,
      assignee: TeamMember,
      date: string,
      requestedMinute: number,
    ) => findSimulatedAvailableSegment(stage, assignee, date, requestedMinute)?.startsAtMinute

    const previewSimulatedCompletion = (
      stage: PlanningStage,
      assignee: TeamMember,
      earliestStart: ScheduleMarker,
    ) => {
      const maxDailyCapacity = getMaxEffectiveDailyCapacity(assignee, stage.type)
      let remainingMinutes = Math.max(0, Math.round(stage.estimateMinutes))
      let date = findNextSchedulableDate(earliestStart.date, stage.type)
      let minute = date === earliestStart.date ? earliestStart.minute : 0
      let completion = { date, minute }

      if (maxDailyCapacity <= 0) {
        return undefined
      }

      for (let guard = 0; remainingMinutes > 0 && guard < 740; guard += 1) {
        if (!isSchedulableDate(date, stage.type)) {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
          continue
        }

        const availableSegment = findSimulatedAvailableSegment(stage, assignee, date, minute)

        if (!availableSegment || availableSegment.availableMinutes <= 0) {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
          continue
        }

        const startsAtMinute = availableSegment.startsAtMinute
        const slotMinutes = Math.min(
          remainingMinutes,
          availableSegment.availableMinutes,
          WORK_DAY_MINUTES,
        )
        const endsAtMinute = startsAtMinute + slotMinutes

        remainingMinutes -= slotMinutes
        completion = {
          date,
          minute: endsAtMinute,
        }

        if (remainingMinutes > 0) {
          const dailyCapacity = getMemberDailyCapacity(assignee, date)

          if (endsAtMinute < dailyCapacity) {
            minute = endsAtMinute
          } else {
            date = findNextSchedulableDate(addDays(date, 1), stage.type)
            minute = 0
          }
        }
      }

      return remainingMinutes > 0 ? undefined : completion
    }

    const getSimulatedAssignedSprintMinutes = (memberId: string) =>
      simulatedSlots
        .filter((slot) => slot.assigneeId === memberId && sprintDateSet.has(slot.date))
        .reduce((total, slot) => total + slot.minutes, 0)

    const resolveSimulatedAssignee = (stage: PlanningStage, earliestStart: ScheduleMarker) => {
      const overrideAssigneeId = assigneeOverrides.get(stage.id)
      const explicitAssigneeId = overrideAssigneeId ?? stage.assigneeId

      if (explicitAssigneeId) {
        return memberById.get(explicitAssigneeId)
      }

      const inheritedQaAssigneeId = getSimulatedQaTestCaseAssigneeId(stage)

      if (inheritedQaAssigneeId) {
        return memberById.get(inheritedQaAssigneeId)
      }

      return getStageAssigneeCandidates(stage)
        .filter(
          (member) =>
            getMaxEffectiveDailyCapacity(member, stage.type) > 0 &&
            (sprintCapacityByMemberId.get(member.id) ?? 0) > 0,
        )
        .map((candidate) => ({
          candidate,
          completion: previewSimulatedCompletion(stage, candidate, earliestStart),
          load:
            getSimulatedAssignedSprintMinutes(candidate.id) /
            Math.max(sprintCapacityByMemberId.get(candidate.id) ?? 0, 1),
          reserve: sprintCapacityByMemberId.get(candidate.id) ?? 0,
        }))
        .filter(
          (
            item,
          ): item is {
            candidate: TeamMember
            completion: ScheduleMarker
            load: number
            reserve: number
          } => Boolean(item.completion),
        )
        .sort((left, right) => {
          const completionComparison = compareMarkers(left.completion, right.completion)

          if (completionComparison !== 0) {
            return completionComparison
          }

          if (left.load !== right.load) {
            return left.load - right.load
          }

          return right.reserve - left.reserve
        })[0]?.candidate
    }

    const allocateSimulatedStage = (
      stage: PlanningStage,
      assignee: TeamMember,
      earliestStart: ScheduleMarker,
    ) => {
      const stageSlots: ScheduledSlot[] = []
      const maxDailyCapacity = getMaxEffectiveDailyCapacity(assignee, stage.type)
      let remainingMinutes = Math.max(0, Math.round(stage.estimateMinutes))
      let date = findNextSchedulableDate(earliestStart.date, stage.type)
      let minute = date === earliestStart.date ? earliestStart.minute : 0
      let completion = { date, minute }

      if (maxDailyCapacity <= 0) {
        return { completion, stageSlots }
      }

      for (let guard = 0; remainingMinutes > 0 && guard < 740; guard += 1) {
        if (!isSchedulableDate(date, stage.type)) {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
          continue
        }

        const availableSegment = findSimulatedAvailableSegment(stage, assignee, date, minute)

        if (!availableSegment || availableSegment.availableMinutes <= 0) {
          date = findNextSchedulableDate(addDays(date, 1), stage.type)
          minute = 0
          continue
        }

        const startsAtMinute = availableSegment.startsAtMinute
        const slotMinutes = Math.min(
          remainingMinutes,
          availableSegment.availableMinutes,
          WORK_DAY_MINUTES,
        )
        const endsAtMinute = startsAtMinute + slotMinutes
        const slot: ScheduledSlot = {
          id: `sim-slot-${stage.id}-${date}-${stageSlots.length + 1}`,
          sprintId,
          stageId: stage.id,
          workItemId: stage.workItemId,
          assigneeId: assignee.id,
          date,
          minutes: slotMinutes,
          startsAtMinute,
          endsAtMinute,
        }

        stageSlots.push(slot)
        simulatedSlots.push(slot)
        addSimulatedOccupiedSlot(slot)
        remainingMinutes -= slotMinutes
        completion = {
          date,
          minute: endsAtMinute,
        }

        if (remainingMinutes > 0) {
          const dailyCapacity = getMemberDailyCapacity(assignee, date)

          if (endsAtMinute < dailyCapacity) {
            minute = endsAtMinute
          } else {
            date = findNextSchedulableDate(addDays(date, 1), stage.type)
            minute = 0
          }
        }
      }

      return { completion, stageSlots }
    }

    const scheduleSimulatedStage = (stage: PlanningStage): ScheduleMarker => {
      const scheduledCompletion = simulatedCompletionByStageId.get(stage.id)

      if (scheduledCompletion) {
        return scheduledCompletion
      }

      if (simulatedVisitingStageIds.has(stage.id)) {
        simulatedCompletionByStageId.set(stage.id, sprintStart)
        return sprintStart
      }

      const releaseGroupKey = releaseGroupKeyByStageId.get(stage.id)

      if (releaseGroupKey) {
        return scheduleSimulatedReleaseGroup(releaseGroupKey, stage.id)
      }

      simulatedVisitingStageIds.add(stage.id)

      const dependencyMarkers = stage.dependsOnStageIds.map((dependencyStageId) => {
        const dependencyStage = stageById.get(dependencyStageId)

        return dependencyStage ? scheduleSimulatedStage(dependencyStage) : sprintStart
      })
      const earliestStart = dependencyMarkers.length
        ? maxMarker([sprintStart, ...dependencyMarkers])
        : sprintStart

      simulatedVisitingStageIds.delete(stage.id)

      const assignee = resolveSimulatedAssignee(stage, earliestStart)

      if (!assignee) {
        simulatedCompletionByStageId.set(stage.id, earliestStart)
        return earliestStart
      }

      const { completion } = allocateSimulatedStage(stage, assignee, earliestStart)

      simulatedCompletionByStageId.set(stage.id, completion)

      return completion
    }

    const scheduleSimulatedReleaseGroup = (
      groupKey: string,
      requestedStageId: string,
    ): ScheduleMarker => {
      const requestedScheduledCompletion = simulatedCompletionByStageId.get(requestedStageId)

      if (requestedScheduledCompletion) {
        return requestedScheduledCompletion
      }

      const groupStages = (releaseGroupStageIdsByKey.get(groupKey) ?? [])
        .map((stageId) => stageById.get(stageId))
        .filter((stage): stage is PlanningStage => Boolean(stage))

      if (!groupStages.length) {
        return sprintStart
      }

      const dependencyMarkers = groupStages.flatMap((groupStage) =>
        groupStage.dependsOnStageIds.map((dependencyStageId) => {
          const dependencyStage = stageById.get(dependencyStageId)

          return dependencyStage ? scheduleSimulatedStage(dependencyStage) : sprintStart
        }),
      )
      const earliestStart = dependencyMarkers.length
        ? maxMarker([sprintStart, ...dependencyMarkers])
        : sprintStart
      const releaseAssignees = groupStages.map((groupStage) => ({
        stage: groupStage,
        assignee: resolveSimulatedAssignee(groupStage, earliestStart),
      }))

      if (releaseAssignees.some(({ assignee }) => !assignee)) {
        groupStages.forEach((groupStage) =>
          simulatedCompletionByStageId.set(groupStage.id, earliestStart),
        )
        return simulatedCompletionByStageId.get(requestedStageId) ?? earliestStart
      }

      let alignedStart = {
        date: findNextSchedulableDate(earliestStart.date, 'release-support'),
        minute: 0,
      }

      if (alignedStart.date === earliestStart.date) {
        alignedStart.minute = earliestStart.minute
      }

      for (let guard = 0; guard < 740; guard += 1) {
        const startMinutes = releaseAssignees.map(({ stage, assignee }) =>
          getSimulatedAvailableStartMinute(
            stage,
            assignee as TeamMember,
            alignedStart.date,
            alignedStart.minute,
          ),
        )

        if (startMinutes.every((minute): minute is number => typeof minute === 'number')) {
          const commonStartMinute = Math.max(...startMinutes)
          const startMinutesAtCommonStart = releaseAssignees.map(({ stage, assignee }) =>
            getSimulatedAvailableStartMinute(
              stage,
              assignee as TeamMember,
              alignedStart.date,
              commonStartMinute,
            ),
          )
          const canStartTogether = startMinutesAtCommonStart.every(
            (minute) => minute === commonStartMinute,
          )

          if (canStartTogether) {
            alignedStart = {
              date: alignedStart.date,
              minute: commonStartMinute,
            }
            break
          }

          const nextSameDayMinute = Math.min(
            ...startMinutesAtCommonStart.filter(
              (minute): minute is number =>
                typeof minute === 'number' && minute > commonStartMinute,
            ),
          )

          if (Number.isFinite(nextSameDayMinute)) {
            alignedStart = {
              date: alignedStart.date,
              minute: nextSameDayMinute,
            }
            continue
          }
        }

        alignedStart = {
          date: findNextSchedulableDate(addDays(alignedStart.date, 1), 'release-support'),
          minute: 0,
        }
      }

      releaseAssignees.forEach(({ stage, assignee }) => {
        if (simulatedCompletionByStageId.has(stage.id) || !assignee) {
          return
        }

        const { completion } = allocateSimulatedStage(stage, assignee, alignedStart)

        simulatedCompletionByStageId.set(stage.id, completion)
      })

      return simulatedCompletionByStageId.get(requestedStageId) ?? alignedStart
    }

    orderedStages.forEach(scheduleSimulatedStage)

    const overflowMinutes = simulatedSlots
      .filter((slot) => !sprintDateSet.has(slot.date))
      .reduce((total, slot) => total + slot.minutes, 0)
    const releaseFinishOrdinal = Math.max(
      0,
      ...stages
        .filter((stage) => stage.type === 'release-support')
        .map((stage) => simulatedCompletionByStageId.get(stage.id))
        .filter((marker): marker is ScheduleMarker => Boolean(marker))
        .map(getMarkerOrdinal),
    )
    const makespanOrdinal = Math.max(
      0,
      ...[...simulatedCompletionByStageId.values()].map(getMarkerOrdinal),
    )
    const assignedMinutesByMemberId = new Map(teamMembers.map((member) => [member.id, 0]))

    simulatedSlots.forEach((slot) => {
      if (!sprintDateSet.has(slot.date)) {
        return
      }

      assignedMinutesByMemberId.set(
        slot.assigneeId,
        (assignedMinutesByMemberId.get(slot.assigneeId) ?? 0) + slot.minutes,
      )
    })

    const underloadGapMinutes = teamMembers.reduce((total, member) => {
      const capacityMinutes = sprintCapacityByMemberId.get(member.id) ?? 0
      const assignedMinutes = assignedMinutesByMemberId.get(member.id) ?? 0
      const targetMinutes = Math.ceil((capacityMinutes * policy.targetLoadPercent) / 100)

      return total + Math.max(0, targetMinutes - assignedMinutes)
    }, 0)
    const sensitiveOverlapMinutes = [...new Set(simulatedSlots.map((slot) => slot.date))].reduce(
      (total, date) => {
        const dateSlots = simulatedSlots.filter((slot) => {
          const stage = stageById.get(slot.stageId)

          return slot.date === date && stage && overlapSensitiveStageTypes.has(stage.type)
        })

        let overlapMinutes = 0

        for (let leftIndex = 0; leftIndex < dateSlots.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < dateSlots.length; rightIndex += 1) {
            const leftSlot = dateSlots[leftIndex]
            const rightSlot = dateSlots[rightIndex]
            const leftStage = leftSlot ? stageById.get(leftSlot.stageId) : undefined
            const rightStage = rightSlot ? stageById.get(rightSlot.stageId) : undefined
            const sameReleaseGroup =
              leftStage?.type === 'release-support' &&
              rightStage?.type === 'release-support' &&
              releaseGroupKeyByStageId.get(leftStage.id) === releaseGroupKeyByStageId.get(rightStage.id)

            if (
              leftSlot &&
              rightSlot &&
              leftSlot.assigneeId !== rightSlot.assigneeId &&
              hasTimeOverlap(leftSlot, rightSlot) &&
              !sameReleaseGroup
            ) {
              overlapMinutes +=
                Math.min(leftSlot.endsAtMinute, rightSlot.endsAtMinute) -
                Math.max(leftSlot.startsAtMinute, rightSlot.startsAtMinute)
            }
          }
        }

        return total + overlapMinutes
      },
      0,
    )
    const lateHighPriorityMinutes = stages.reduce((total, stage) => {
      const priority = schedulePriorityByStageId.get(stage.id) ?? 0
      const completion = simulatedCompletionByStageId.get(stage.id)

      if (!completion || priority > 2 || sprintDateSet.has(completion.date)) {
        return total
      }

      return total + Math.max(0, Math.round(stage.estimateMinutes)) * Math.max(1, 3 - priority)
    }, 0)
    const objectiveScore =
      overflowMinutes * 100_000 +
      lateHighPriorityMinutes * 25_000 +
      sensitiveOverlapMinutes * 2_000 +
      releaseFinishOrdinal * 10 +
      makespanOrdinal * 6 +
      underloadGapMinutes

    return {
      slots: simulatedSlots,
      completionByStageId: simulatedCompletionByStageId,
      overflowMinutes,
      releaseFinishOrdinal,
      makespanOrdinal,
      underloadGapMinutes,
      sensitiveOverlapMinutes,
      lateHighPriorityMinutes,
      objectiveScore,
    }
  }

  const fallbackCompareStages = (left: PlanningStage, right: PlanningStage) => {
    const priorityComparison =
      (schedulePriorityByStageId.get(left.id) ?? 0) - (schedulePriorityByStageId.get(right.id) ?? 0)

    if (priorityComparison !== 0) {
      return priorityComparison
    }

    const typeComparison = stageTypeScheduleWeight[left.type] - stageTypeScheduleWeight[right.type]

    if (typeComparison !== 0) {
      return typeComparison
    }

    return left.id.localeCompare(right.id)
  }

  const getOptimizedStageOrder = () => {
    const releaseWorkItemIds = new Set(
      workItems
        .filter(
          (workItem) =>
            workItem.requiresReleaseSupport ||
            (workItem.epicId && epicWorkItemIds.has(workItem.id)),
        )
        .map((workItem) => workItem.id),
    )
    const releaseStageIds = new Set(releaseGroupKeyByStageId.keys())
    const releaseGroupKeys = new Set(releaseGroupKeyByStageId.values())
    const units: ScheduleOrderUnit[] = []
    const unitById = new Map<string, ScheduleOrderUnit>()
    const stageIdsInReleaseUnits = new Set<string>()

    releaseGroupKeys.forEach((groupKey) => {
      const groupStageIds = releaseGroupStageIdsByKey.get(groupKey) ?? []

      if (!groupStageIds.length) {
        return
      }

      const stageIdSet = new Set(groupStageIds)
      const sortedGroupStageIds = [...groupStageIds].sort((left, right) => {
        const leftStage = stageById.get(left)
        const rightStage = stageById.get(right)

        if (!leftStage || !rightStage) {
          return left.localeCompare(right)
        }

        return fallbackCompareStages(leftStage, rightStage)
      })
      const unit: ScheduleOrderUnit = {
        id: `release-group:${groupKey}`,
        stageIds: sortedGroupStageIds,
        dependencyStageIds: [
          ...new Set(
            groupStageIds.flatMap((stageId) =>
              (stageById.get(stageId)?.dependsOnStageIds ?? []).filter(
                (dependencyStageId) => !stageIdSet.has(dependencyStageId),
              ),
            ),
          ),
        ],
      }

      units.push(unit)
      unitById.set(unit.id, unit)
      groupStageIds.forEach((stageId) => stageIdsInReleaseUnits.add(stageId))
    })

    stages
      .filter((stage) => !stageIdsInReleaseUnits.has(stage.id))
      .forEach((stage) => {
        const unit: ScheduleOrderUnit = {
          id: `stage:${stage.id}`,
          stageIds: [stage.id],
          dependencyStageIds: stage.dependsOnStageIds,
        }

        units.push(unit)
        unitById.set(unit.id, unit)
      })

    const remainingUnitIds = new Set(units.map((unit) => unit.id))

    // ─── Critical path & downstream fan-out ───────────────────────────────────
    // Build a reverse dependency map: for each stage, which stages depend on it.
    // Then compute criticalPath(stage) = estimateMinutes + max(criticalPath(dependent)).
    // This tells the scorer how much downstream work will be delayed if a stage waits.
    const dependentsByStageId = new Map<string, string[]>()
    stages.forEach((stage) => {
      stage.dependsOnStageIds.forEach((depId) => {
        const existing = dependentsByStageId.get(depId)
        if (existing) {
          existing.push(stage.id)
        } else {
          dependentsByStageId.set(depId, [stage.id])
        }
      })
    })

    const criticalPathMinutesById = new Map<string, number>()
    const computeCriticalPath = (stageId: string): number => {
      const cached = criticalPathMinutesById.get(stageId)
      if (cached !== undefined) {
        return cached
      }

      const stage = stageById.get(stageId)
      if (!stage) {
        return 0
      }

      // Cycle guard: set a sentinel before recursing to prevent infinite loops.
      criticalPathMinutesById.set(stageId, 0)

      const dependentIds = dependentsByStageId.get(stageId) ?? []
      const maxDownstream = dependentIds.length > 0
        ? Math.max(...dependentIds.map(computeCriticalPath))
        : 0

      const result = Math.max(0, Math.round(stage.estimateMinutes)) + maxDownstream
      criticalPathMinutesById.set(stageId, result)
      return result
    }
    stages.forEach((stage) => computeCriticalPath(stage.id))
    // ─────────────────────────────────────────────────────────────────────────


    // This avoids repeating map/filter/sort inside scoreUnit and compareUnits on every
    // comparison call during readyUnits.sort(), which runs O(n log n) times per beam step.
    const unitStaticPropsById = new Map<string, UnitStaticProps>()
    units.forEach((unit) => {
      const unitStages = unit.stageIds
        .map((stageId) => stageById.get(stageId))
        .filter((stage): stage is PlanningStage => Boolean(stage))
      const priorities = unitStages.map((stage) => schedulePriorityByStageId.get(stage.id) ?? 0)
      const highestPriority = priorities.length ? Math.min(...priorities) : 0
      const isReleaseUnit = unitStages.some((stage) => releaseStageIds.has(stage.id))
      const isReleaseWork = unitStages.some((stage) => releaseWorkItemIds.has(stage.workItemId))
      const firstStage = unitStages[0]
      const representativeStage = unitStages.length > 1
        ? [...unitStages].sort(fallbackCompareStages)[0]
        : firstStage
      const stageTypeScore = representativeStage
        ? 100 - stageTypeScheduleWeight[representativeStage.type]
        : 0
      const priorityScore = Math.max(0, 12 - highestPriority) * policy.priorityScoreStep
      // Documentation units are intentionally deprioritized: they fill idle slots after
      // more important dev/QA work has been placed.
      const isDocumentationUnit =
        unitStages.length > 0 && unitStages.every((stage) => stage.type === 'documentation')
      const releaseScore = isReleaseUnit
        ? policy.releaseStageScoreBonus + Math.max(0, 4 - highestPriority) * 25
        : isReleaseWork
          ? policy.releaseWorkScoreBonus
          : 0

      // Critical path: maximum "remaining chain" in minutes across all stages in this unit.
      // criticalPath(stage) = estimateMinutes + max(criticalPath(stage that depends on me))
      // A higher value means more downstream work is waiting — schedule this unit earlier.
      const criticalPathMinutes = unit.stageIds.length > 0
        ? Math.max(...unit.stageIds.map((id) => criticalPathMinutesById.get(id) ?? 0))
        : 0

      // Downstream fan-out: how many stages from OTHER units are directly unblocked
      // once all stages in this unit complete.  High fan-out → more parallel work unlocked.
      const unitStageIdSet = new Set(unit.stageIds)
      const downstreamFanOut = unit.stageIds.reduce((count, stageId) => {
        const dependents = dependentsByStageId.get(stageId) ?? []
        return count + dependents.filter((depId) => !unitStageIdSet.has(depId)).length
      }, 0)

      unitStaticPropsById.set(unit.id, {
        highestPriority,
        isReleaseUnit,
        isReleaseWork,
        firstStage,
        representativeStage,
        stageTypeScore,
        priorityScore,
        releaseScore,
        isDocumentationUnit,
        criticalPathMinutes,
        downstreamFanOut,
      })
    })

    const compareUnits = (left: ScheduleOrderUnit, right: ScheduleOrderUnit) => {
      const leftStage = unitStaticPropsById.get(left.id)?.firstStage
      const rightStage = unitStaticPropsById.get(right.id)?.firstStage

      if (!leftStage || !rightStage) {
        return left.id.localeCompare(right.id)
      }

      return fallbackCompareStages(leftStage, rightStage)
    }

    const scoreUnit = (
      unit: ScheduleOrderUnit,
      _candidate: ScheduleOrderCandidate,
      position: number,
    ) => {
      // Scoring is based purely on objective metrics: priority, release urgency, critical path,
      // stage type, and downstream fan-out.  Context-dependent bonuses (same-work-item,
      // same-assignee, context-switch penalty) were removed: algebraically, every ordering
      // of the same unit set produces the same cumulative score, so context bonuses only
      // distort the ordering by favouring "batch same work item together" over "start the
      // longest critical chain first", which hurts makespan when there is resource contention.
      const props = unitStaticPropsById.get(unit.id)!
      const earlyReleaseScore = props.releaseScore * Math.max(1, units.length - position)
      const documentationPenalty = props.isDocumentationUnit
        ? policy.documentationDeprioritizePenalty
        : 0
      const criticalPathScore = props.criticalPathMinutes * policy.criticalPathScoreFactor
      const downstreamFanScore = props.downstreamFanOut * policy.downstreamFanScorePerStage

      return (
        props.priorityScore +
        props.releaseScore +
        earlyReleaseScore +
        props.stageTypeScore +
        criticalPathScore +
        downstreamFanScore -
        documentationPenalty -
        position * policy.earlyPositionScorePenalty
      )
    }

    let candidateSerial = 0
    let beam: ScheduleOrderCandidate[] = [
      {
        orderedUnitIds: [],
        orderedUnitIdSet: new Set(),
        scheduledStageIds: new Set(),
        score: 0,
        serial: candidateSerial,
      },
    ]

    for (let position = 0; position < units.length; position += 1) {
      const nextBeam: ScheduleOrderCandidate[] = []

      beam.forEach((candidate) => {
        // Pre-compute scores for all units once per candidate so the .sort() comparator
        // does not call scoreUnit O(n log n) times redundantly.
        const unitScores = new Map<string, number>()
        const readyUnits = [...remainingUnitIds]
          // O(1) Set lookup instead of O(n) Array.includes
          .filter((unitId) => !candidate.orderedUnitIdSet.has(unitId))
          .map((unitId) => unitById.get(unitId))
          .filter((unit): unit is ScheduleOrderUnit => Boolean(unit))
          .filter((unit) =>
            unit.dependencyStageIds.every(
              (dependencyStageId) =>
                !stageById.has(dependencyStageId) ||
                candidate.scheduledStageIds.has(dependencyStageId),
            ),
          )
          .sort((left, right) => {
            // Cache scores to avoid duplicate computation inside sort comparisons.
            if (!unitScores.has(left.id)) {
              unitScores.set(left.id, scoreUnit(left, candidate, position))
            }
            if (!unitScores.has(right.id)) {
              unitScores.set(right.id, scoreUnit(right, candidate, position))
            }
            const scoreComparison = (unitScores.get(right.id) ?? 0) - (unitScores.get(left.id) ?? 0)

            if (scoreComparison !== 0) {
              return scoreComparison
            }

            return compareUnits(left, right)
          })
          .slice(0, policy.readyBranchLimit)

        if (!readyUnits.length) {
          return
        }

        readyUnits.forEach((unit) => {
          const scheduledStageIds = new Set(candidate.scheduledStageIds)
          unit.stageIds.forEach((stageId) => scheduledStageIds.add(stageId))

          const newOrderedUnitIdSet = new Set(candidate.orderedUnitIdSet)
          newOrderedUnitIdSet.add(unit.id)

          candidateSerial += 1
          nextBeam.push({
            orderedUnitIds: [...candidate.orderedUnitIds, unit.id],
            orderedUnitIdSet: newOrderedUnitIdSet,
            scheduledStageIds,
            score: candidate.score + (unitScores.get(unit.id) ?? scoreUnit(unit, candidate, position)),
            serial: candidateSerial,
          })
        })
      })

      if (!nextBeam.length) {
        break
      }

      beam = nextBeam
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score
          }
          // Use stable integer serial as a cheap tiebreaker instead of building
          // a long joined string from orderedUnitIds.
          return left.serial - right.serial
        })
        .slice(0, policy.beamWidth)
    }

    const completeCandidates = beam.filter((candidate) => candidate.orderedUnitIds.length === units.length)
    const bestCandidate =
      completeCandidates
        .map((candidate) => {
          const orderedStages = candidate.orderedUnitIds
            .flatMap((unitId) => unitById.get(unitId)?.stageIds ?? [])
            .map((stageId) => stageById.get(stageId))
            .filter((stage): stage is PlanningStage => Boolean(stage))

          return {
            candidate,
            objectiveScore: simulateStageOrder(orderedStages).objectiveScore,
          }
        })
        .sort((left, right) => {
          if (left.objectiveScore !== right.objectiveScore) {
            return left.objectiveScore - right.objectiveScore
          }

          if (right.candidate.score !== left.candidate.score) {
            return right.candidate.score - left.candidate.score
          }

          return left.candidate.serial - right.candidate.serial
        })[0]?.candidate ?? beam[0]

    if (!bestCandidate || bestCandidate.orderedUnitIds.length !== units.length) {
      return [...stages].sort(fallbackCompareStages)
    }

    return bestCandidate.orderedUnitIds
      .flatMap((unitId) => unitById.get(unitId)?.stageIds ?? [])
      .map((stageId) => stageById.get(stageId))
      .filter((stage): stage is PlanningStage => Boolean(stage))
  }

  const stagesInScheduleOrder = getOptimizedStageOrder()

  stagesInScheduleOrder.forEach(scheduleStage)

  const overflow = slots.filter((slot) => !sprintDateSet.has(slot.date))

  if (overflow.length) {
    addWarning('info', 'Часть нагрузки прогнозно уходит за рабочие дни спринта.')
  }

  const addCoordinationOverlapWarnings = () => {
    const slotsByDate = new Map<string, ScheduledSlot[]>()

    slots.forEach((slot) => {
      const stage = stageById.get(slot.stageId)

      if (!stage || !overlapSensitiveStageTypes.has(stage.type)) {
        return
      }

      const existingDateSlots = slotsByDate.get(slot.date)
      if (existingDateSlots) {
        existingDateSlots.push(slot)
      } else {
        slotsByDate.set(slot.date, [slot])
      }
    })

    slotsByDate.forEach((dateSlots, date) => {
      const involvedSlotIds = new Set<string>()

      for (let leftIndex = 0; leftIndex < dateSlots.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < dateSlots.length; rightIndex += 1) {
          const leftSlot = dateSlots[leftIndex]
          const rightSlot = dateSlots[rightIndex]

          const leftStage = leftSlot ? stageById.get(leftSlot.stageId) : undefined
          const rightStage = rightSlot ? stageById.get(rightSlot.stageId) : undefined
          const sameReleaseGroup =
            leftStage?.type === 'release-support' &&
            rightStage?.type === 'release-support' &&
            releaseGroupKeyByStageId.get(leftStage.id) ===
              releaseGroupKeyByStageId.get(rightStage.id)

          if (
            leftSlot &&
            rightSlot &&
            leftSlot.assigneeId !== rightSlot.assigneeId &&
            hasTimeOverlap(leftSlot, rightSlot) &&
            !sameReleaseGroup
          ) {
            involvedSlotIds.add(leftSlot.id)
            involvedSlotIds.add(rightSlot.id)
          }
        }
      }

      if (!involvedSlotIds.size) {
        return
      }

      const involvedSlots = dateSlots.filter((slot) => involvedSlotIds.has(slot.id))
      const involvedStages = involvedSlots
        .map((slot) => stageById.get(slot.stageId))
        .filter((stage): stage is PlanningStage => Boolean(stage))
      const involvedAssignees = involvedSlots
        .map((slot) => memberById.get(slot.assigneeId)?.name)
        .filter((name): name is string => Boolean(name))
      const involvedWorkItems = involvedSlots
        .map((slot) => workItemById.get(slot.workItemId)?.title)
        .filter((title): title is string => Boolean(title))
      const stageTypeLabels = involvedStages.map((stage) => stageLabels[stage.type])
      const hasQaTesting = involvedStages.some((stage) => stage.type === 'qa-testing')
      const hasRelease = involvedStages.some((stage) => stage.type === 'release-support')
      const advice =
        hasRelease && hasQaTesting
          ? 'Проверьте разграничение тестовых окружений, handoff и релизное окно.'
          : hasRelease
            ? 'Проверьте окружения, handoff и релизное окно.'
            : 'Проверьте разграничение тестовых окружений и приоритизацию тестов.'
      addWarning(
        'warning',
        `На ${formatDate(date)} пересекаются ${formatShortList(stageTypeLabels)} у нескольких сотрудников: ${formatShortList(involvedAssignees)}. Задачи: ${formatShortList(involvedWorkItems)}. ${advice}`,
        {
          workItemId: involvedSlots[0]?.workItemId,
        },
      )
    })
  }

  const addUnderloadWarnings = () => {
    const assignedMinutesByMemberId = new Map(teamMembers.map((member) => [member.id, 0]))

    slots.forEach((slot) => {
      if (!sprintDateSet.has(slot.date)) {
        return
      }

      assignedMinutesByMemberId.set(
        slot.assigneeId,
        (assignedMinutesByMemberId.get(slot.assigneeId) ?? 0) + slot.minutes,
      )
    })

    teamMembers.forEach((member) => {
      const capacityMinutes = sprintCapacityByMemberId.get(member.id) ?? 0
      const assignedMinutes = assignedMinutesByMemberId.get(member.id) ?? 0
      const targetMinutes = Math.ceil((capacityMinutes * policy.targetLoadPercent) / 100)
      const underloadMinutes = targetMinutes - assignedMinutes

      if (capacityMinutes <= 0 || underloadMinutes <= 0) {
        return
      }

      addWarning(
        'warning',
        `${member.name}: загрузка ${Math.round(
          (assignedMinutes / capacityMinutes) * 100,
        )}% ниже целевых ${policy.targetLoadPercent}%. До целевой загрузки не хватает ${formatDuration(underloadMinutes)}.`,
        {
          assigneeId: member.id,
        },
      )
    })
  }

  const buildAssignmentRecommendations = (): AssignmentReplacementRecommendation[] => {
    const baseline = simulateStageOrder(stagesInScheduleOrder)
    const baselineScore = Math.max(baseline.objectiveScore, 1)

    return stagesInScheduleOrder
      .flatMap((stage) => {
        const fromAssigneeId = manualAssigneeIdByStageId.get(stage.id)
        const fromAssignee = fromAssigneeId ? memberById.get(fromAssigneeId) : undefined

        if (!fromAssigneeId || !fromAssignee || stage.type === 'design-review') {
          return []
        }

        return getStageAssigneeCandidates(stage)
          .filter(
            (candidate) =>
              candidate.id !== fromAssigneeId &&
              getMaxEffectiveDailyCapacity(candidate, stage.type) > 0 &&
              (sprintCapacityByMemberId.get(candidate.id) ?? 0) > 0,
          )
          .flatMap((candidate) => {
            const candidateResult = simulateStageOrder(
              stagesInScheduleOrder,
              new Map([[stage.id, candidate.id]]),
            )
            const objectiveGain = baseline.objectiveScore - candidateResult.objectiveScore
            const gainPercent = (objectiveGain / baselineScore) * 100
            const overflowGain = baseline.overflowMinutes - candidateResult.overflowMinutes
            const releaseGain = baseline.releaseFinishOrdinal - candidateResult.releaseFinishOrdinal
            const makespanGain = baseline.makespanOrdinal - candidateResult.makespanOrdinal
            const underloadGain = baseline.underloadGapMinutes - candidateResult.underloadGapMinutes
            const sensitiveOverlapGain =
              baseline.sensitiveOverlapMinutes - candidateResult.sensitiveOverlapMinutes
            const latePriorityGain =
              baseline.lateHighPriorityMinutes - candidateResult.lateHighPriorityMinutes
            const estimatedGainMinutes = Math.max(
              0,
              overflowGain,
              releaseGain,
              makespanGain,
              underloadGain,
              sensitiveOverlapGain,
              latePriorityGain,
            )

            if (
              objectiveGain <= 0 ||
              (estimatedGainMinutes < policy.minRecommendationGainMinutes &&
                gainPercent < policy.minRecommendationGainPercent)
            ) {
              return []
            }

            const workItemTitle = workItemById.get(stage.workItemId)?.title ?? 'задачи'
            const impactParts = [
              overflowGain > 0 ? `overflow меньше на ${formatDuration(overflowGain)}` : undefined,
              releaseGain > 0 ? `release раньше на ${formatDuration(releaseGain)}` : undefined,
              makespanGain > 0 ? `завершение раньше на ${formatDuration(makespanGain)}` : undefined,
              underloadGain > 0
                ? `разрыв до целевой загрузки меньше на ${formatDuration(underloadGain)}`
                : undefined,
              sensitiveOverlapGain > 0
                ? `пересечения QA/release меньше на ${formatDuration(sensitiveOverlapGain)}`
                : undefined,
              latePriorityGain > 0
                ? `high/critical за спринтом меньше на ${formatDuration(latePriorityGain)}`
                : undefined,
            ].filter((part): part is string => Boolean(part))
            const impact = impactParts.length
              ? impactParts.join(', ')
              : `objective-score лучше на ${Math.round(gainPercent)}%`

            return [
              {
                id: `assignment-recommendation-${stage.id}-${candidate.id}`,
                stageId: stage.id,
                workItemId: stage.workItemId,
                fromAssigneeId,
                toAssigneeId: candidate.id,
                estimatedGainMinutes,
                impact: `Переназначить ${stageLabels[stage.type]} "${workItemTitle}" с ${fromAssignee.name} на ${candidate.name}: ${impact}.`,
                objectiveGain,
              },
            ]
          })
      })
      .sort((left, right) => {
        if (right.objectiveGain !== left.objectiveGain) {
          return right.objectiveGain - left.objectiveGain
        }

        return right.estimatedGainMinutes - left.estimatedGainMinutes
      })
      .slice(0, policy.maxAssignmentRecommendations)
      .map(({ objectiveGain: _objectiveGain, ...recommendation }) => recommendation)
  }

  addCoordinationOverlapWarnings()
  addUnderloadWarnings()

  const assignmentRecommendations = buildAssignmentRecommendations()

  if (
    workItems.some(
      (workItem) => epicWorkItemIds.has(workItem.id) && !epicById.has(workItem.epicId ?? ''),
    )
  ) {
    addWarning('warning', 'Найдена задача с некорректной привязкой к epic.')
  }

  return {
    sprintId,
    generatedAt,
    stages,
    slots,
    warnings,
    overflow,
    policy,
    assignmentRecommendations,
  }
}
