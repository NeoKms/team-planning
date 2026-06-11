import { computed, ref } from 'vue'
import { defineStore, type Pinia } from 'pinia'

import {
  emptyReleaseSupportEstimates,
  emptyWorkEstimates,
  priorityLabelByOrder,
  type MeetingLoadByWeekday,
  type PlanningState,
  type ReleaseSupportEstimates,
  type Role,
  type Sprint,
  type SprintDurationWeeks,
  type Team,
  type TeamExportData,
  type TeamMember,
  type VacationPeriod,
  type WorkEstimates,
  type WorkAssignments,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemType,
  type DevelopmentFlow,
  type Epic,
  type AllocationResult,
} from '@/domain/planning'
import { scheduleSprint } from '@/domain/scheduling'
import { createSeedState } from './planning.seed'

const STORAGE_KEY = 'team-planning:v1'
const MS_PER_DAY = 24 * 60 * 60 * 1000
const ALLOCATION_ARCHIVE_TTL_DAYS = 14

const isoNow = () => new Date().toISOString()

const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)

  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

const sprintEndTimestamp = (sprint: Sprint) =>
  parseIsoDate(sprint.startsOn) + sprint.durationWeeks * 7 * MS_PER_DAY - MS_PER_DAY

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

const createUniqueName = (baseName: string, existingNames: string[]) => {
  const normalizedExistingNames = new Set(existingNames.map(normalizeName))

  if (!normalizedExistingNames.has(normalizeName(baseName))) {
    return baseName
  }

  const importName = `${baseName} (импорт)`
  if (!normalizedExistingNames.has(normalizeName(importName))) {
    return importName
  }

  let suffix = 2
  let candidate = `${baseName} (импорт ${suffix})`

  while (normalizedExistingNames.has(normalizeName(candidate))) {
    suffix += 1
    candidate = `${baseName} (импорт ${suffix})`
  }

  return candidate
}

interface TeamInput {
  name: string
}

interface TeamMemberInput {
  teamId: string
  name: string
  role: Role
  availableMinutesPerDay: number
  meetingLoadByWeekday: MeetingLoadByWeekday
}

interface SprintInput {
  teamId: string
  name: string
  startsOn: string
  durationWeeks: SprintDurationWeeks
}

interface WorkItemInput {
  sprintId: string
  epicId?: string
  type: WorkItemType
  title: string
  priority: number
  priorityLabel: WorkItemPriority
  estimates: WorkEstimates
  assignments: WorkAssignments
  developmentFlow: DevelopmentFlow
  dependencyIds: string[]
  requiresDesignReview: boolean
  designReviewEstimateMinutes: number
  requiresReleaseSupport: boolean
  releaseSupport: ReleaseSupportEstimates
}

interface EpicInput {
  sprintId: string
  title: string
  workItemIds: string[]
  releaseSupport: ReleaseSupportEstimates
}


const isPlanningState = (value: unknown): value is PlanningState => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<Record<keyof PlanningState, unknown>>

  return (
    Array.isArray(candidate.teams) &&
    Array.isArray(candidate.members) &&
    Array.isArray(candidate.sprints) &&
    Array.isArray(candidate.workItems) &&
    Array.isArray(candidate.epics) &&
    Array.isArray(candidate.allocationResults)
  )
}

const pruneArchivedAllocationResults = (
  allocationResults: AllocationResult[],
  sprints: Sprint[],
  now = Date.now(),
) => {
  const sprintById = new Map(sprints.map((sprint) => [sprint.id, sprint]))
  const archiveCutoff = now - ALLOCATION_ARCHIVE_TTL_DAYS * MS_PER_DAY

  return allocationResults.filter((result) => {
    const sprint = sprintById.get(result.sprintId)

    if (!sprint) {
      return false
    }

    return sprintEndTimestamp(sprint) >= archiveCutoff
  })
}

const migrateState = (state: PlanningState): PlanningState => {
  const workItems = state.workItems.map((workItem) => ({
    ...workItem,
    estimates: {
      ...emptyWorkEstimates(),
      ...workItem.estimates,
    },
    releaseSupport: {
      ...emptyReleaseSupportEstimates(),
      ...workItem.releaseSupport,
    },
  }))
  const epics = state.epics.map((epic) => ({
    ...epic,
    releaseSupport: {
      ...emptyReleaseSupportEstimates(),
      ...epic.releaseSupport,
    },
  }))

  return {
    ...state,
    workItems,
    epics,
    allocationResults: pruneArchivedAllocationResults(state.allocationResults, state.sprints),
    vacations: state.vacations ?? [],
  }
}

const loadState = (): PlanningState => {
  if (typeof window === 'undefined') {
    return createSeedState()
  }

  const persistedState = window.localStorage.getItem(STORAGE_KEY)

  if (!persistedState) {
    return {
      teams: [],
      members: [],
      sprints: [],
      workItems: [],
      epics: [],
      allocationResults: [],
      vacations: [],
    }
  }

  try {
    const parsedState: unknown = JSON.parse(persistedState)

    if (isPlanningState(parsedState)) {
      return migrateState(parsedState)
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
  }

  return createSeedState()
}

export const usePlanningStore = defineStore('planning', () => {
  const state = ref<PlanningState>(loadState())

  const teams = computed(() => state.value.teams)
  const members = computed(() => state.value.members)
  const sprints = computed(() => state.value.sprints)
  const workItems = computed(() => state.value.workItems)
  const epics = computed(() => state.value.epics)
  const allocationResults = computed(() => state.value.allocationResults)
  const vacations = computed(() => state.value.vacations)

  const hasData = computed(
    () =>
      state.value.teams.length > 0 ||
      state.value.members.length > 0 ||
      state.value.sprints.length > 0 ||
      state.value.workItems.length > 0,
  )

  function replaceState(nextState: PlanningState) {
    state.value = nextState
  }

  function importState(candidateState: unknown) {
    if (!isPlanningState(candidateState)) {
      return false
    }

    state.value = migrateState(candidateState)

    return true
  }

  function createSprintSnapshot(sprintId: string): PlanningState | undefined {
    const sprint = state.value.sprints.find((candidate) => candidate.id === sprintId)

    if (!sprint) {
      return undefined
    }

    const team = state.value.teams.find((candidate) => candidate.id === sprint.teamId)
    const members = state.value.members.filter((member) => member.teamId === sprint.teamId)
    const memberIdSet = new Set(members.map((m) => m.id))

    return {
      teams: team ? [team] : [],
      members,
      sprints: [sprint],
      workItems: state.value.workItems.filter((workItem) => workItem.sprintId === sprintId),
      epics: state.value.epics.filter((epic) => epic.sprintId === sprintId),
      allocationResults: state.value.allocationResults.filter(
        (result) => result.sprintId === sprintId,
      ),
      vacations: state.value.vacations.filter((v) => memberIdSet.has(v.memberId)),
    }
  }

  function createTeamSnapshot(teamId: string): TeamExportData | undefined {
    const team = state.value.teams.find((candidate) => candidate.id === teamId)

    if (!team) {
      return undefined
    }

    const members = state.value.members.filter((member) => member.teamId === teamId)
    const memberIdSet = new Set(members.map((m) => m.id))
    const vacations = state.value.vacations.filter((v) => memberIdSet.has(v.memberId))

    return { team, members, vacations }
  }

  function appendTeamSnapshot(data: TeamExportData, options: { forceClone?: boolean } = {}) {
    const { team, members, vacations } = data
    const existingTeamNames = state.value.teams.map((candidate) => candidate.name)
    const hasTeamIdConflict = state.value.teams.some((candidate) => candidate.id === team.id)
    const hasTeamNameConflict = state.value.teams.some(
      (candidate) => normalizeName(candidate.name) === normalizeName(team.name),
    )
    const shouldCloneTeam = Boolean(options.forceClone || hasTeamIdConflict || hasTeamNameConflict)
    const teamId = shouldCloneTeam ? createId('team') : team.id
    const memberIdMap = new Map<string, string>()

    const nextMembers = members.map((member) => {
      const hasMemberIdConflict = state.value.members.some(
        (candidate) => candidate.id === member.id,
      )
      const memberId = shouldCloneTeam || hasMemberIdConflict ? createId('member') : member.id
      memberIdMap.set(member.id, memberId)

      return {
        ...member,
        id: memberId,
        teamId,
      }
    })

    const nextTeam: Team = {
      ...team,
      id: teamId,
      name: shouldCloneTeam ? createUniqueName(team.name, existingTeamNames) : team.name,
      memberIds: nextMembers.map((member) => member.id),
      updatedAt: shouldCloneTeam ? isoNow() : team.updatedAt,
    }

    const existingVacationIds = new Set(state.value.vacations.map((vacation) => vacation.id))
    const nextVacations = vacations.map((vacation) => {
      const memberId = memberIdMap.get(vacation.memberId) ?? vacation.memberId
      const vacationId =
        existingVacationIds.has(vacation.id) || memberId !== vacation.memberId
          ? createId('vacation')
          : vacation.id

      return {
        ...vacation,
        id: vacationId,
        memberId,
      }
    })

    state.value.teams = [...state.value.teams, nextTeam]
    state.value.members = [...state.value.members, ...nextMembers]
    state.value.vacations = [...state.value.vacations, ...nextVacations]

    return {
      teamIdMap: new Map([[team.id, teamId]]),
      memberIdMap,
    }
  }

  function mergeTeamSnapshot(data: TeamExportData) {
    appendTeamSnapshot(data)
  }

  function mergeSprintSnapshot(snapshot: PlanningState) {
    const normalizedSnapshot = migrateState(snapshot)
    const sprint = normalizedSnapshot.sprints[0]
    if (!sprint) return

    const importedTeam = normalizedSnapshot.teams[0]
    const teamIdMap = new Map<string, string>()
    const memberIdMap = new Map<string, string>()

    if (importedTeam) {
      const importedTeamMembers = normalizedSnapshot.members.filter(
        (member) => member.teamId === importedTeam.id,
      )
      const importedMemberIds = new Set(importedTeamMembers.map((member) => member.id))
      const importedVacations = normalizedSnapshot.vacations.filter((vacation) =>
        importedMemberIds.has(vacation.memberId),
      )
      const importedTeamSnapshot = {
        team: importedTeam,
        members: importedTeamMembers,
        vacations: importedVacations,
      }
      const importedTeamResult = appendTeamSnapshot(importedTeamSnapshot)

      importedTeamResult.teamIdMap.forEach((value, key) => teamIdMap.set(key, value))
      importedTeamResult.memberIdMap.forEach((value, key) => memberIdMap.set(key, value))
    }

    const existingSprintNames = state.value.sprints.map((candidate) => candidate.name)
    const hasSprintIdConflict = state.value.sprints.some((candidate) => candidate.id === sprint.id)
    const hasSprintNameConflict = state.value.sprints.some(
      (candidate) => normalizeName(candidate.name) === normalizeName(sprint.name),
    )
    const shouldCloneSprint = hasSprintIdConflict || hasSprintNameConflict
    const sprintId = shouldCloneSprint ? createId('sprint') : sprint.id
    const sprintWorkItems = normalizedSnapshot.workItems.filter(
      (workItem) => workItem.sprintId === sprint.id,
    )
    const sprintEpics = normalizedSnapshot.epics.filter((epic) => epic.sprintId === sprint.id)
    const workItemIdMap = new Map<string, string>()
    const epicIdMap = new Map<string, string>()
    const now = isoNow()

    for (const workItem of sprintWorkItems) {
      const hasWorkItemIdConflict = state.value.workItems.some(
        (candidate) => candidate.id === workItem.id,
      )
      workItemIdMap.set(
        workItem.id,
        shouldCloneSprint || hasWorkItemIdConflict ? createId('work-item') : workItem.id,
      )
    }

    for (const epic of sprintEpics) {
      const hasEpicIdConflict = state.value.epics.some((candidate) => candidate.id === epic.id)
      epicIdMap.set(epic.id, shouldCloneSprint || hasEpicIdConflict ? createId('epic') : epic.id)
    }

    const nextSprint: Sprint = {
      ...sprint,
      id: sprintId,
      teamId: teamIdMap.get(sprint.teamId) ?? sprint.teamId,
      name: shouldCloneSprint ? createUniqueName(sprint.name, existingSprintNames) : sprint.name,
      updatedAt: shouldCloneSprint ? now : sprint.updatedAt,
    }

    const nextWorkItems = sprintWorkItems.map((workItem) => ({
      ...workItem,
      id: workItemIdMap.get(workItem.id) ?? workItem.id,
      sprintId,
      epicId: workItem.epicId ? (epicIdMap.get(workItem.epicId) ?? workItem.epicId) : undefined,
      assignments: Object.fromEntries(
        Object.entries(workItem.assignments).map(([direction, assigneeId]) => [
          direction,
          assigneeId ? (memberIdMap.get(assigneeId) ?? assigneeId) : assigneeId,
        ]),
      ) as WorkAssignments,
      dependencyIds: workItem.dependencyIds.map(
        (dependencyId) => workItemIdMap.get(dependencyId) ?? dependencyId,
      ),
      updatedAt: shouldCloneSprint ? now : workItem.updatedAt,
    }))

    const nextEpics = sprintEpics.map((epic) => ({
      ...epic,
      id: epicIdMap.get(epic.id) ?? epic.id,
      sprintId,
      workItemIds: epic.workItemIds.map((workItemId) => workItemIdMap.get(workItemId) ?? workItemId),
      updatedAt: shouldCloneSprint ? now : epic.updatedAt,
    }))

    const nextAllocationResults = normalizedSnapshot.allocationResults
      .filter((result) => result.sprintId === sprint.id)
      .map((result) => {
        const stageIdMap = new Map(
          result.stages.map((stage) => [stage.id, createId('stage')] as const),
        )
        const mapStageId = (stageId: string) => stageIdMap.get(stageId) ?? stageId
        const mapWorkItemId = (workItemId: string) => workItemIdMap.get(workItemId) ?? workItemId
        const mapEpicId = (epicId: string | undefined) =>
          epicId ? (epicIdMap.get(epicId) ?? epicId) : undefined
        const mapAssigneeId = (assigneeId: string | undefined) =>
          assigneeId ? (memberIdMap.get(assigneeId) ?? assigneeId) : undefined
        const mapSlot = (slot: AllocationResult['slots'][number]) => ({
          ...slot,
          id: createId('slot'),
          sprintId,
          stageId: mapStageId(slot.stageId),
          workItemId: mapWorkItemId(slot.workItemId),
          assigneeId: mapAssigneeId(slot.assigneeId) ?? slot.assigneeId,
        })

        return {
          ...result,
          sprintId,
          stages: result.stages.map((stage) => ({
            ...stage,
            id: mapStageId(stage.id),
            workItemId: mapWorkItemId(stage.workItemId),
            epicId: mapEpicId(stage.epicId),
            assigneeId: mapAssigneeId(stage.assigneeId),
            dependsOnStageIds: stage.dependsOnStageIds.map(mapStageId),
          })),
          slots: result.slots.map(mapSlot),
          overflow: result.overflow.map(mapSlot),
          warnings: result.warnings.map((warning) => ({
            ...warning,
            id: createId('warning'),
            workItemId: warning.workItemId ? mapWorkItemId(warning.workItemId) : undefined,
            assigneeId: mapAssigneeId(warning.assigneeId),
          })),
          assignmentRecommendations: result.assignmentRecommendations?.map((recommendation) => ({
            ...recommendation,
            id: createId('recommendation'),
            stageId: mapStageId(recommendation.stageId),
            workItemId: mapWorkItemId(recommendation.workItemId),
            fromAssigneeId:
              mapAssigneeId(recommendation.fromAssigneeId) ?? recommendation.fromAssigneeId,
            toAssigneeId: mapAssigneeId(recommendation.toAssigneeId) ?? recommendation.toAssigneeId,
          })),
        }
      })

    state.value.sprints = [...state.value.sprints, nextSprint]
    state.value.workItems = [...state.value.workItems, ...nextWorkItems]
    state.value.epics = [...state.value.epics, ...nextEpics]
    state.value.allocationResults = [...state.value.allocationResults, ...nextAllocationResults]
  }

  function resetToSeedState() {
    state.value = createSeedState()
  }

  function clearState() {
    state.value = {
      teams: [],
      members: [],
      sprints: [],
      workItems: [],
      epics: [],
      allocationResults: [],
      vacations: [],
    }
  }

  function clearAllocationForSprint(sprintId: string) {
    state.value.allocationResults = state.value.allocationResults.filter(
      (result) => result.sprintId !== sprintId,
    )
  }

  /** Marks a sprint as having data changes after the last allocation calculation.
   *  Does NOT clear the allocation result — the stale result stays visible with a warning banner. */
  function markSprintDataChanged(sprintId: string) {
    const now = isoNow()
    state.value.sprints = state.value.sprints.map((sprint) =>
      sprint.id === sprintId ? { ...sprint, lastDataChangedAt: now } : sprint,
    )
  }

  /** Returns true when sprint data was changed after the last allocation calculation. */
  function isSprintAllocationStale(sprintId: string): boolean {
    const sprint = state.value.sprints.find((s) => s.id === sprintId)
    if (!sprint?.lastDataChangedAt) return false
    const allocation = state.value.allocationResults.find((r) => r.sprintId === sprintId)
    if (!allocation) return false
    return sprint.lastDataChangedAt > allocation.generatedAt
  }

  function sanitizeAssignments(assignments: WorkAssignments): WorkAssignments {
    return Object.fromEntries(
      Object.entries(assignments).filter(([, assigneeId]) => Boolean(assigneeId)),
    ) as WorkAssignments
  }

  function sanitizeDependencyIds(dependencyIds: string[], workItemId?: string) {
    return [...new Set(dependencyIds.filter((dependencyId) => dependencyId !== workItemId))]
  }

  function sanitizeEpicId(sprintId: string, epicId?: string) {
    if (!epicId) {
      return undefined
    }

    return state.value.epics.some((epic) => epic.id === epicId && epic.sprintId === sprintId)
      ? epicId
      : undefined
  }

  function sanitizeEpicWorkItemIds(sprintId: string, workItemIds: string[]) {
    const sprintWorkItemIds = new Set(
      state.value.workItems
        .filter((workItem) => workItem.sprintId === sprintId)
        .map((workItem) => workItem.id),
    )

    return [...new Set(workItemIds.filter((workItemId) => sprintWorkItemIds.has(workItemId)))]
  }

  function sanitizeReleaseSupport(
    releaseSupport: ReleaseSupportEstimates,
  ): ReleaseSupportEstimates {
    return {
      backend: Math.max(0, Math.round(releaseSupport.backend)),
      frontend: Math.max(0, Math.round(releaseSupport.frontend)),
      qa: Math.max(0, Math.round(releaseSupport.qa)),
      ios: Math.max(0, Math.round(releaseSupport.ios)),
      android: Math.max(0, Math.round(releaseSupport.android)),
    }
  }

  function syncEpicMembership(
    workItemId: string,
    sprintId: string,
    nextEpicId: string | undefined,
    now = isoNow(),
  ) {
    state.value.epics = state.value.epics.map((epic) => {
      if (epic.sprintId !== sprintId) {
        return epic
      }

      if (epic.id === nextEpicId) {
        return {
          ...epic,
          workItemIds: [...new Set([...epic.workItemIds, workItemId])],
          updatedAt: now,
        }
      }

      if (epic.workItemIds.includes(workItemId)) {
        return {
          ...epic,
          workItemIds: epic.workItemIds.filter((candidateId) => candidateId !== workItemId),
          updatedAt: now,
        }
      }

      return epic
    })
  }

  function replaceEpicMembership(
    epicId: string,
    sprintId: string,
    workItemIds: string[],
    now = isoNow(),
  ) {
    const nextWorkItemIds = sanitizeEpicWorkItemIds(sprintId, workItemIds)
    const nextWorkItemIdSet = new Set(nextWorkItemIds)

    state.value.epics = state.value.epics.map((epic) => {
      if (epic.sprintId !== sprintId) {
        return epic
      }

      if (epic.id === epicId) {
        return {
          ...epic,
          workItemIds: nextWorkItemIds,
          updatedAt: now,
        }
      }

      return {
        ...epic,
        workItemIds: epic.workItemIds.filter((workItemId) => !nextWorkItemIdSet.has(workItemId)),
        updatedAt: epic.workItemIds.some((workItemId) => nextWorkItemIdSet.has(workItemId))
          ? now
          : epic.updatedAt,
      }
    })

    state.value.workItems = state.value.workItems.map((workItem) => {
      if (workItem.sprintId !== sprintId) {
        return workItem
      }

      if (nextWorkItemIdSet.has(workItem.id)) {
        return {
          ...workItem,
          epicId,
          updatedAt: now,
        }
      }

      if (workItem.epicId === epicId) {
        const { epicId: _removedEpicId, ...workItemWithoutEpic } = workItem

        return {
          ...workItemWithoutEpic,
          updatedAt: now,
        }
      }

      return workItem
    })
  }

  function normalizeWorkItemOrder(
    sprintId: string,
    movedWorkItemId?: string,
    requestedPriority?: number,
    updatedAt = isoNow(),
  ) {
    const sprintWorkItems = state.value.workItems
      .filter((workItem) => workItem.sprintId === sprintId)
      .sort(
        (left, right) =>
          left.priority - right.priority || left.createdAt.localeCompare(right.createdAt),
      )

    if (!sprintWorkItems.length) {
      return
    }

    let orderedWorkItems = sprintWorkItems

    if (movedWorkItemId) {
      const movedWorkItem = sprintWorkItems.find((workItem) => workItem.id === movedWorkItemId)

      if (movedWorkItem) {
        const remainingWorkItems = sprintWorkItems.filter(
          (workItem) => workItem.id !== movedWorkItemId,
        )
        const targetIndex = Math.min(
          Math.max(0, Math.round(requestedPriority ?? movedWorkItem.priority) - 1),
          remainingWorkItems.length,
        )

        orderedWorkItems = [
          ...remainingWorkItems.slice(0, targetIndex),
          movedWorkItem,
          ...remainingWorkItems.slice(targetIndex),
        ]
      }
    }

    const priorityByWorkItemId = new Map(
      orderedWorkItems.map((workItem, index) => [workItem.id, index + 1]),
    )

    state.value.workItems = state.value.workItems.map((workItem) => {
      if (workItem.sprintId !== sprintId) {
        return workItem
      }

      const priority = priorityByWorkItemId.get(workItem.id)

      if (!priority) {
        return workItem
      }

      const priorityLabel = priorityLabelByOrder(priority)

      if (workItem.priority === priority && workItem.priorityLabel === priorityLabel) {
        return workItem
      }

      return {
        ...workItem,
        priority,
        priorityLabel,
        updatedAt,
      }
    })
  }

  function createTeam(input: TeamInput): Team {
    const now = isoNow()
    const team: Team = {
      id: createId('team'),
      name: input.name,
      memberIds: [],
      createdAt: now,
      updatedAt: now,
    }

    state.value.teams = [...state.value.teams, team]

    return team
  }

  function updateTeam(teamId: string, input: TeamInput) {
    const now = isoNow()

    state.value.teams = state.value.teams.map((team) =>
      team.id === teamId
        ? {
            ...team,
            name: input.name,
            updatedAt: now,
          }
        : team,
    )
  }

  function deleteTeam(teamId: string) {
    const sprintIds = new Set(
      state.value.sprints.filter((sprint) => sprint.teamId === teamId).map((sprint) => sprint.id),
    )
    const memberIds = new Set(
      state.value.members.filter((member) => member.teamId === teamId).map((member) => member.id),
    )

    state.value = {
      teams: state.value.teams.filter((team) => team.id !== teamId),
      members: state.value.members.filter((member) => member.teamId !== teamId),
      sprints: state.value.sprints.filter((sprint) => sprint.teamId !== teamId),
      workItems: state.value.workItems.filter((workItem) => !sprintIds.has(workItem.sprintId)),
      epics: state.value.epics.filter((epic) => !sprintIds.has(epic.sprintId)),
      allocationResults: state.value.allocationResults.filter(
        (result) => !sprintIds.has(result.sprintId),
      ),
      vacations: state.value.vacations.filter((v) => !memberIds.has(v.memberId)),
    }
  }

  function createTeamMember(input: TeamMemberInput): TeamMember {
    const member: TeamMember = {
      id: createId('member'),
      ...input,
    }

    state.value.members = [...state.value.members, member]
    state.value.teams = state.value.teams.map((team) =>
      team.id === input.teamId
        ? {
            ...team,
            memberIds: [...new Set([...team.memberIds, member.id])],
            updatedAt: isoNow(),
          }
        : team,
    )

    return member
  }

  function updateTeamMember(memberId: string, input: TeamMemberInput) {
    const previousMember = state.value.members.find((member) => member.id === memberId)

    if (!previousMember) {
      return
    }

    state.value.members = state.value.members.map((member) =>
      member.id === memberId
        ? {
            id: member.id,
            ...input,
          }
        : member,
    )

    const now = isoNow()

    state.value.teams = state.value.teams.map((team) => {
      if (team.id === previousMember.teamId && team.id !== input.teamId) {
        return {
          ...team,
          memberIds: team.memberIds.filter((candidateId) => candidateId !== memberId),
          updatedAt: now,
        }
      }

      if (team.id === input.teamId) {
        return {
          ...team,
          memberIds: [...new Set([...team.memberIds, memberId])],
          updatedAt: now,
        }
      }

      return team
    })

    if (previousMember.teamId !== input.teamId) {
      const previousTeamSprintIds = new Set(
        state.value.sprints
          .filter((sprint) => sprint.teamId === previousMember.teamId)
          .map((sprint) => sprint.id),
      )

      state.value.workItems = state.value.workItems.map((workItem) => {
        if (!previousTeamSprintIds.has(workItem.sprintId)) {
          return workItem
        }

        const assignments = Object.fromEntries(
          Object.entries(workItem.assignments).filter(([, assigneeId]) => assigneeId !== memberId),
        ) as WorkAssignments

        return {
          ...workItem,
          assignments,
          updatedAt: now,
        }
      })
      state.value.allocationResults = state.value.allocationResults.map((result) => {
        if (!previousTeamSprintIds.has(result.sprintId)) {
          return result
        }

        return {
          ...result,
          slots: result.slots.filter((slot) => slot.assigneeId !== memberId),
          overflow: result.overflow.filter((slot) => slot.assigneeId !== memberId),
          warnings: result.warnings.filter((warning) => warning.assigneeId !== memberId),
        }
      })
      // Mark previous team's sprints as stale (member removed from their allocations)
      ;[...previousTeamSprintIds].forEach(markSprintDataChanged)
    } else {
      // Same team: profile change (availability, meetings) affects scheduling
      getAffectedSprintIdsForMember(memberId).forEach(markSprintDataChanged)
    }
  }

  function deleteTeamMember(memberId: string) {
    state.value.members = state.value.members.filter((member) => member.id !== memberId)
    state.value.teams = state.value.teams.map((team) => ({
      ...team,
      memberIds: team.memberIds.filter((candidateId) => candidateId !== memberId),
    }))
    state.value.workItems = state.value.workItems.map((workItem) => {
      const assignments = Object.fromEntries(
        Object.entries(workItem.assignments).filter(([, assigneeId]) => assigneeId !== memberId),
      ) as WorkAssignments

      return {
        ...workItem,
        assignments,
        updatedAt: isoNow(),
      }
    })
    state.value.allocationResults = state.value.allocationResults.map((result) => ({
      ...result,
      slots: result.slots.filter((slot) => slot.assigneeId !== memberId),
      overflow: result.overflow.filter((slot) => slot.assigneeId !== memberId),
      warnings: result.warnings.filter((warning) => warning.assigneeId !== memberId),
    }))
    state.value.vacations = state.value.vacations.filter((v) => v.memberId !== memberId)
  }

  function createSprint(input: SprintInput): Sprint {
    const now = isoNow()
    const sprint: Sprint = {
      id: createId('sprint'),
      ...input,
      createdAt: now,
      updatedAt: now,
    }

    state.value.sprints = [...state.value.sprints, sprint]

    return sprint
  }

  function updateSprint(sprintId: string, input: SprintInput) {
    const previousSprint = state.value.sprints.find((sprint) => sprint.id === sprintId)

    if (!previousSprint) {
      return
    }

    const now = isoNow()

    state.value.sprints = state.value.sprints.map((sprint) =>
      sprint.id === sprintId
        ? {
            ...sprint,
            ...input,
            updatedAt: now,
          }
        : sprint,
    )

    const baseChanged =
      previousSprint.teamId !== input.teamId ||
      previousSprint.startsOn !== input.startsOn ||
      previousSprint.durationWeeks !== input.durationWeeks

    if (!baseChanged) {
      return
    }

    clearAllocationForSprint(sprintId)

    if (previousSprint.teamId === input.teamId) {
      return
    }

    const nextTeamMemberIds = new Set(
      state.value.members
        .filter((member) => member.teamId === input.teamId)
        .map((member) => member.id),
    )

    state.value.workItems = state.value.workItems.map((workItem) => {
      if (workItem.sprintId !== sprintId) {
        return workItem
      }

      const assignments = Object.fromEntries(
        Object.entries(workItem.assignments).filter(([, assigneeId]) =>
          nextTeamMemberIds.has(assigneeId),
        ),
      ) as WorkAssignments

      return {
        ...workItem,
        assignments,
        updatedAt: now,
      }
    })
  }

  function deleteSprint(sprintId: string) {
    state.value = {
      ...state.value,
      sprints: state.value.sprints.filter((sprint) => sprint.id !== sprintId),
      workItems: state.value.workItems.filter((workItem) => workItem.sprintId !== sprintId),
      epics: state.value.epics.filter((epic) => epic.sprintId !== sprintId),
      allocationResults: state.value.allocationResults.filter(
        (result) => result.sprintId !== sprintId,
      ),
    }
  }

  function cloneSprintWithWorkItems(sourceSprintId: string, input: SprintInput): Sprint | undefined {
    const sourceSprint = state.value.sprints.find((s) => s.id === sourceSprintId)
    if (!sourceSprint) return undefined

    const now = isoNow()
    const newSprintId = createId('sprint')
    const newSprint: Sprint = {
      id: newSprintId,
      ...input,
      createdAt: now,
      updatedAt: now,
    }

    const sourceWorkItems = state.value.workItems.filter((wi) => wi.sprintId === sourceSprintId)
    const sourceEpics = state.value.epics.filter((e) => e.sprintId === sourceSprintId)

    const workItemIdMap = new Map(sourceWorkItems.map((wi) => [wi.id, createId('work-item')]))
    const epicIdMap = new Map(sourceEpics.map((e) => [e.id, createId('epic')]))

    const newWorkItems = sourceWorkItems.map((wi) => ({
      ...wi,
      id: workItemIdMap.get(wi.id) ?? createId('work-item'),
      sprintId: newSprintId,
      epicId: wi.epicId ? epicIdMap.get(wi.epicId) : undefined,
      dependencyIds: wi.dependencyIds
        .map((depId) => workItemIdMap.get(depId))
        .filter((id): id is string => Boolean(id)),
      createdAt: now,
      updatedAt: now,
    }))

    const newEpics = sourceEpics.map((e) => ({
      ...e,
      id: epicIdMap.get(e.id) ?? createId('epic'),
      sprintId: newSprintId,
      workItemIds: e.workItemIds
        .map((wiId) => workItemIdMap.get(wiId))
        .filter((id): id is string => Boolean(id)),
      createdAt: now,
      updatedAt: now,
    }))

    state.value.sprints = [...state.value.sprints, newSprint]
    state.value.workItems = [...state.value.workItems, ...newWorkItems]
    state.value.epics = [...state.value.epics, ...newEpics]

    return newSprint
  }

  function createWorkItem(input: WorkItemInput): WorkItem {
    const now = isoNow()
    const epicId = sanitizeEpicId(input.sprintId, input.epicId)
    const workItem: WorkItem = {
      id: createId('work-item'),
      ...input,
      epicId,
      assignments: sanitizeAssignments(input.assignments),
      dependencyIds: sanitizeDependencyIds(input.dependencyIds),
      requiresDesignReview: input.requiresDesignReview,
      designReviewEstimateMinutes: Math.max(0, Math.round(input.designReviewEstimateMinutes)),
      createdAt: now,
      updatedAt: now,
    }

    state.value.workItems = [...state.value.workItems, workItem]
    syncEpicMembership(workItem.id, input.sprintId, epicId, now)
    normalizeWorkItemOrder(input.sprintId, workItem.id, input.priority, now)
    markSprintDataChanged(input.sprintId)

    return state.value.workItems.find((candidate) => candidate.id === workItem.id) ?? workItem
  }

  function updateWorkItem(workItemId: string, input: WorkItemInput) {
    const previousWorkItem = state.value.workItems.find((workItem) => workItem.id === workItemId)

    if (!previousWorkItem) {
      return
    }

    const now = isoNow()
    const epicId = sanitizeEpicId(input.sprintId, input.epicId)

    state.value.workItems = state.value.workItems.map((workItem) =>
      workItem.id === workItemId
        ? {
            ...workItem,
            ...input,
            epicId,
            assignments: sanitizeAssignments(input.assignments),
            dependencyIds: sanitizeDependencyIds(input.dependencyIds, workItemId),
            requiresDesignReview: input.requiresDesignReview,
            designReviewEstimateMinutes: Math.max(0, Math.round(input.designReviewEstimateMinutes)),
            updatedAt: now,
          }
        : workItem,
    )

    if (previousWorkItem.sprintId !== input.sprintId || previousWorkItem.epicId !== epicId) {
      syncEpicMembership(workItemId, previousWorkItem.sprintId, undefined, now)
      syncEpicMembership(workItemId, input.sprintId, epicId, now)
    }

    if (previousWorkItem.sprintId !== input.sprintId) {
      normalizeWorkItemOrder(previousWorkItem.sprintId, undefined, undefined, now)
    }

    normalizeWorkItemOrder(input.sprintId, workItemId, input.priority, now)
    markSprintDataChanged(previousWorkItem.sprintId)

    if (previousWorkItem.sprintId !== input.sprintId) {
      markSprintDataChanged(input.sprintId)
    }
  }

  function deleteWorkItem(workItemId: string) {
    const workItem = state.value.workItems.find((candidate) => candidate.id === workItemId)

    if (!workItem) {
      return
    }

    const now = isoNow()

    state.value.workItems = state.value.workItems
      .filter((candidate) => candidate.id !== workItemId)
      .map((candidate) =>
        candidate.dependencyIds.includes(workItemId)
          ? {
              ...candidate,
              dependencyIds: candidate.dependencyIds.filter(
                (dependencyId) => dependencyId !== workItemId,
              ),
              updatedAt: now,
            }
          : candidate,
      )

    state.value.epics = state.value.epics.map((epic) =>
      epic.sprintId === workItem.sprintId
        ? {
            ...epic,
            workItemIds: epic.workItemIds.filter((candidateId) => candidateId !== workItemId),
            updatedAt: now,
          }
        : epic,
    )

    normalizeWorkItemOrder(workItem.sprintId, undefined, undefined, now)
    markSprintDataChanged(workItem.sprintId)
  }

  function createEpic(input: EpicInput): Epic {
    const now = isoNow()
    const epic: Epic = {
      id: createId('epic'),
      sprintId: input.sprintId,
      title: input.title,
      workItemIds: [],
      releaseSupport: sanitizeReleaseSupport(input.releaseSupport),
      createdAt: now,
      updatedAt: now,
    }

    state.value.epics = [...state.value.epics, epic]
    replaceEpicMembership(epic.id, input.sprintId, input.workItemIds, now)
    markSprintDataChanged(input.sprintId)

    return {
      ...epic,
      workItemIds: sanitizeEpicWorkItemIds(input.sprintId, input.workItemIds),
    }
  }

  function updateEpic(epicId: string, input: EpicInput) {
    const previousEpic = state.value.epics.find((epic) => epic.id === epicId)

    if (!previousEpic) {
      return
    }

    const now = isoNow()

    state.value.epics = state.value.epics.map((epic) =>
      epic.id === epicId
        ? {
            ...epic,
            sprintId: input.sprintId,
            title: input.title,
            releaseSupport: sanitizeReleaseSupport(input.releaseSupport),
            updatedAt: now,
          }
        : epic,
    )

    if (previousEpic.sprintId !== input.sprintId) {
      replaceEpicMembership(epicId, previousEpic.sprintId, [], now)
    }

    replaceEpicMembership(epicId, input.sprintId, input.workItemIds, now)
    markSprintDataChanged(previousEpic.sprintId)

    if (previousEpic.sprintId !== input.sprintId) {
      markSprintDataChanged(input.sprintId)
    }
  }

  function deleteEpic(epicId: string) {
    const epic = state.value.epics.find((candidate) => candidate.id === epicId)

    if (!epic) {
      return
    }

    const now = isoNow()

    state.value.epics = state.value.epics.filter((candidate) => candidate.id !== epicId)
    state.value.workItems = state.value.workItems.map((workItem) => {
      if (workItem.epicId !== epicId) {
        return workItem
      }

      const { epicId: _removedEpicId, ...workItemWithoutEpic } = workItem

      return {
        ...workItemWithoutEpic,
        updatedAt: now,
      }
    })
    markSprintDataChanged(epic.sprintId)
  }

  function getAffectedSprintIdsForMember(memberId: string): string[] {
    const member = state.value.members.find((m) => m.id === memberId)
    if (!member) return []
    return state.value.sprints
      .filter((s) => s.teamId === member.teamId)
      .map((s) => s.id)
  }

  function createVacation(input: {
    memberId: string
    startDate: string
    endDate: string
  }): VacationPeriod {
    const vacation: VacationPeriod = {
      id: createId('vacation'),
      memberId: input.memberId,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    state.value.vacations = [...state.value.vacations, vacation]
    getAffectedSprintIdsForMember(input.memberId).forEach(markSprintDataChanged)
    return vacation
  }

  function updateVacation(
    vacationId: string,
    input: { memberId: string; startDate: string; endDate: string },
  ) {
    state.value.vacations = state.value.vacations.map((v) =>
      v.id === vacationId
        ? { ...v, memberId: input.memberId, startDate: input.startDate, endDate: input.endDate }
        : v,
    )
    getAffectedSprintIdsForMember(input.memberId).forEach(markSprintDataChanged)
  }

  function deleteVacation(vacationId: string) {
    const vacation = state.value.vacations.find((v) => v.id === vacationId)
    state.value.vacations = state.value.vacations.filter((v) => v.id !== vacationId)
    if (vacation) {
      getAffectedSprintIdsForMember(vacation.memberId).forEach(markSprintDataChanged)
    }
  }

  function calculateAllocationForSprint(sprintId: string): AllocationResult | undefined {
    const allocationResult = scheduleSprint(state.value, sprintId)

    if (!allocationResult) {
      return undefined
    }

    state.value.allocationResults = [
      ...state.value.allocationResults.filter((result) => result.sprintId !== sprintId),
      allocationResult,
    ]

    return allocationResult
  }

  return {
    state,
    teams,
    members,
    sprints,
    workItems,
    epics,
    allocationResults,
    vacations,
    hasData,
    replaceState,
    importState,
    createSprintSnapshot,
    createTeamSnapshot,
    mergeTeamSnapshot,
    mergeSprintSnapshot,
    resetToSeedState,
    clearState,
    createTeam,
    updateTeam,
    deleteTeam,
    createTeamMember,
    updateTeamMember,
    deleteTeamMember,
    createSprint,
    updateSprint,
    deleteSprint,
    cloneSprintWithWorkItems,
    createWorkItem,
    updateWorkItem,
    deleteWorkItem,
    createEpic,
    updateEpic,
    deleteEpic,
    createVacation,
    updateVacation,
    deleteVacation,
    calculateAllocationForSprint,
    isSprintAllocationStale,
  }
})

export function installPlanningPersistence(pinia: Pinia) {
  if (typeof window === 'undefined') {
    return
  }

  const planningStore = usePlanningStore(pinia)

  planningStore.$subscribe(
    (_mutation, currentState) => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState.state))
    },
    { deep: true },
  )
}
