export const WORK_DAY_HOURS = 6
export const WORK_DAY_MINUTES = WORK_DAY_HOURS * 60
export const CALENDAR_WORK_DAY_HOURS = 8
export const CALENDAR_WORK_DAY_MINUTES = CALENDAR_WORK_DAY_HOURS * 60
export const CALENDAR_MEETING_BUFFER_MINUTES = (CALENDAR_WORK_DAY_HOURS - WORK_DAY_HOURS) * 60
export const EXTERNAL_DESIGNER_ID = 'external-designer'
export const EXTERNAL_DESIGNER_NAME = 'Дизайнер'

export const WORKING_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const

export type Weekday = (typeof WORKING_DAYS)[number]

export const NON_RELEASE_DAYS: Weekday[] = ['friday']
export const SPRINT_DURATIONS_WEEKS = [1, 2] as const

export type SprintDurationWeeks = (typeof SPRINT_DURATIONS_WEEKS)[number]

export type Role = 'frontend' | 'backend' | 'tech-lead' | 'qa' | 'ios' | 'android'

export type DevelopmentDiscipline = 'backend' | 'frontend' | 'ios' | 'android'
export type WorkDirection = DevelopmentDiscipline | 'qa'

export type WorkItemType = 'story' | 'prod-bug'
export type WorkItemPriority = 'critical' | 'high' | 'medium' | 'low'
export type PlanningStageType =
  | 'analysis'
  | 'backend-development'
  | 'documentation'
  | 'frontend-development'
  | 'ios-development'
  | 'android-development'
  | 'design-review'
  | 'qa-test-case-writing'
  | 'qa-testing'
  | 'release-support'

export interface MeetingLoadByWeekday {
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
}

export interface TeamMember {
  id: string
  teamId: string
  name: string
  role: Role
  availableMinutesPerDay: number
  meetingLoadByWeekday: MeetingLoadByWeekday
}

export interface Team {
  id: string
  name: string
  memberIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Sprint {
  id: string
  teamId: string
  name: string
  startsOn: string
  durationWeeks: SprintDurationWeeks
  createdAt: string
  updatedAt: string
  lastDataChangedAt?: string
}

export interface WorkEstimates {
  backend: number
  documentation: number
  frontend: number
  ios: number
  android: number
  qaTestCaseWriting: number
  qaTesting: number
}

export interface ReleaseSupportEstimates {
  backend: number
  frontend: number
  qa: number
  ios: number
  android: number
}

export type WorkAssignments = Partial<Record<WorkDirection, string>>

export interface DevelopmentFlow {
  backendFrontendParallel: boolean
  mobileParallelWithBackend: boolean
}

export interface WorkItem {
  id: string
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
  requiresDesignReview?: boolean
  designReviewEstimateMinutes?: number
  requiresReleaseSupport: boolean
  releaseSupport: ReleaseSupportEstimates
  createdAt: string
  updatedAt: string
}

export interface Epic {
  id: string
  sprintId: string
  title: string
  workItemIds: string[]
  releaseSupport: ReleaseSupportEstimates
  createdAt: string
  updatedAt: string
}

export interface PlanningStage {
  id: string
  workItemId: string
  epicId?: string
  type: PlanningStageType
  direction: WorkDirection
  assigneeId?: string
  estimateMinutes: number
  dependsOnStageIds: string[]
}

export interface ScheduledSlot {
  id: string
  sprintId: string
  stageId: string
  workItemId: string
  assigneeId: string
  date: string
  minutes: number
  startsAtMinute: number
  endsAtMinute: number
}

export interface PlanningWarning {
  id: string
  severity: 'info' | 'warning' | 'error'
  message: string
  workItemId?: string
  assigneeId?: string
}

export type SchedulingPolicyPreset = 'release-first' | 'balanced' | 'critical-path' | 'no-overflow'

export interface SchedulingPolicy {
  id: SchedulingPolicyPreset
  label: string
  beamWidth: number
  readyBranchLimit: number
  releaseStageScoreBonus: number
  releaseWorkScoreBonus: number
  priorityScoreStep: number
  earlyPositionScorePenalty: number
  documentationDeprioritizePenalty: number
  criticalPathScoreFactor: number
  downstreamFanScorePerStage: number
  targetLoadPercent: number
  minRecommendationGainMinutes: number
  minRecommendationGainPercent: number
  maxAssignmentRecommendations: number
}

export interface AssignmentReplacementRecommendation {
  id: string
  stageId: string
  workItemId: string
  fromAssigneeId: string
  toAssigneeId: string
  estimatedGainMinutes: number
  impact: string
}

export interface AllocationResult {
  sprintId: string
  generatedAt: string
  stages: PlanningStage[]
  slots: ScheduledSlot[]
  warnings: PlanningWarning[]
  overflow: ScheduledSlot[]
  policy?: SchedulingPolicy
  assignmentRecommendations?: AssignmentReplacementRecommendation[]
}

export interface VacationPeriod {
  id: string
  memberId: string
  startDate: string
  endDate: string
}

export interface PlanningState {
  teams: Team[]
  members: TeamMember[]
  sprints: Sprint[]
  workItems: WorkItem[]
  epics: Epic[]
  allocationResults: AllocationResult[]
  vacations: VacationPeriod[]
}

export interface TeamExportData {
  team: Team
  members: TeamMember[]
  vacations: VacationPeriod[]
}

export type ExportEnvelopeType = 'full' | 'team' | 'sprint' | 'allocation'

export interface ExportEnvelope<T = unknown> {
  type: ExportEnvelopeType
  version: '1'
  exportedAt: string
  data: T
}

/** Maps a numeric priority (1 = highest) to a WorkItemPriority label. */
export const priorityLabelByOrder = (priority: number): WorkItemPriority => {
  if (priority <= 1) return 'critical'
  if (priority === 2) return 'high'
  if (priority === 3) return 'medium'
  return 'low'
}

/** Formats ISO date string (YYYY-MM-DD) using the browser's locale. */
export const formatDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString()
}

export const formatDuration = (minutes: number): string => {
  const safeMinutes = Math.max(0, Math.round(minutes))
  const days = Math.floor(safeMinutes / WORK_DAY_MINUTES)
  const afterDaysMinutes = safeMinutes % WORK_DAY_MINUTES
  const hours = Math.floor(afterDaysMinutes / 60)
  const restMinutes = afterDaysMinutes % 60
  const parts: string[] = []

  if (days) parts.push(`${days} д`)
  if (hours) parts.push(`${hours} ч`)
  if (restMinutes || !parts.length) parts.push(`${restMinutes} мин`)

  return parts.join(' ')
}

export const emptyMeetingLoadByWeekday = (): MeetingLoadByWeekday => ({
  monday: 0,
  tuesday: 0,
  wednesday: 0,
  thursday: 0,
  friday: 0,
})

export const emptyWorkEstimates = (): WorkEstimates => ({
  backend: 0,
  documentation: 0,
  frontend: 0,
  ios: 0,
  android: 0,
  qaTestCaseWriting: 0,
  qaTesting: 0,
})

export const emptyReleaseSupportEstimates = (): ReleaseSupportEstimates => ({
  backend: 0,
  frontend: 0,
  qa: 0,
  ios: 0,
  android: 0,
})

export const defaultDevelopmentFlow = (): DevelopmentFlow => ({
  backendFrontendParallel: false,
  mobileParallelWithBackend: false,
})
