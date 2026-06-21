<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AppModal from '@/components/AppModal.vue'
import {
  WORK_DAY_MINUTES,
  defaultDevelopmentFlow,
  emptyReleaseSupportEstimates,
  emptyWorkEstimates,
  formatDate,
  formatDuration,
  type DevelopmentDiscipline,
  type Epic,
  type ReleaseSupportEstimates,
  type Role,
  type TeamMember,
  type WorkAssignments,
  type WorkDirection,
  type WorkEstimates,
  type WorkItem,
  type WorkItemPriority,
  type WorkItemType,
} from '@/domain/planning'
import { getSprintWorkingDates } from '@/domain/scheduling'
import { useAnalytics } from '@/composables/useAnalytics'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useDataExchange } from '@/composables/useDataExchange'
import { usePlanningStore } from '@/stores/planning'

const props = defineProps<{
  sprintId: string
}>()

const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()
const { track } = useAnalytics()
const router = useRouter()
const { status: exportStatus, exportSprint } = useDataExchange()

const typeOptions: Array<{ value: WorkItemType; label: string }> = [
  { value: 'story', label: 'Story' },
  { value: 'prod-bug', label: 'Prod bug' },
]

const typeLabels = Object.fromEntries(
  typeOptions.map((type) => [type.value, type.label]),
) as Record<WorkItemType, string>

const roleLabels: Record<Role, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  'tech-lead': 'Tech lead',
  qa: 'QA',
  ios: 'iOS',
  android: 'Android',
}

const directionLabels: Record<WorkDirection, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  ios: 'iOS',
  android: 'Android',
  qa: 'QA',
}

const estimateFields: Array<{
  key: keyof WorkEstimates
  label: string
  mobile?: DevelopmentDiscipline
}> = [
  { key: 'backend', label: 'Backend' },
  { key: 'documentation', label: 'Документация' },
  { key: 'frontend', label: 'Frontend' },
  { key: 'ios', label: 'iOS', mobile: 'ios' },
  { key: 'android', label: 'Android', mobile: 'android' },
  { key: 'qaTestCaseWriting', label: 'QA test case writing' },
  { key: 'qaTesting', label: 'QA testing' },
]

const assignmentDirections: WorkDirection[] = ['backend', 'frontend', 'ios', 'android', 'qa']

const releaseSupportFields: Array<{
  key: keyof ReleaseSupportEstimates
  label: string
  mobile?: DevelopmentDiscipline
}> = [
  { key: 'backend', label: 'Backend' },
  { key: 'frontend', label: 'Frontend' },
  { key: 'ios', label: 'iOS', mobile: 'ios' },
  { key: 'android', label: 'Android', mobile: 'android' },
  { key: 'qa', label: 'QA' },
]

type WorkItemFormAssignments = Record<WorkDirection, string>

interface WorkItemForm {
  epicId: string
  type: WorkItemType
  title: string
  priority: number
  estimates: WorkEstimates
  assignments: WorkItemFormAssignments
  developmentFlow: {
    backendFrontendParallel: boolean
    mobileParallelWithBackend: boolean
  }
  dependencyIds: string[]
  requiresDesignReview: boolean
  designReviewEstimateMinutes: number
  requiresReleaseSupport: boolean
  releaseSupport: ReleaseSupportEstimates
}

interface EpicForm {
  title: string
  workItemIds: string[]
  releaseSupport: ReleaseSupportEstimates
}

const sprint = computed(() =>
  planningStore.sprints.find((candidate) => candidate.id === props.sprintId),
)

const team = computed(() =>
  planningStore.teams.find((candidate) => candidate.id === sprint.value?.teamId),
)

const teamMembers = computed(() =>
  planningStore.members.filter((member) => member.teamId === team.value?.id),
)

const workItems = computed<WorkItem[]>(() =>
  [...planningStore.workItems]
    .filter((workItem: WorkItem) => workItem.sprintId === props.sprintId)
    .sort(
      (left: WorkItem, right: WorkItem) =>
        left.priority - right.priority || left.createdAt.localeCompare(right.createdAt),
    ),
)

const epics = computed<Epic[]>(() =>
  [...planningStore.epics]
    .filter((epic: Epic) => epic.sprintId === props.sprintId)
    .sort((left: Epic, right: Epic) => left.createdAt.localeCompare(right.createdAt)),
)

const ungroupedWorkItems = computed(() => workItems.value.filter((workItem) => !workItem.epicId))

const memberNameById = computed(() =>
  Object.fromEntries(teamMembers.value.map((member) => [member.id, member.name])),
)

const hasIosMember = computed(() => teamMembers.value.some((member) => member.role === 'ios'))
const hasAndroidMember = computed(() =>
  teamMembers.value.some((member) => member.role === 'android'),
)

const nextPriority = computed(() => {
  const maxPriority = workItems.value.reduce(
    (currentMax, workItem) => Math.max(currentMax, workItem.priority),
    0,
  )

  return maxPriority + 1
})

const emptyAssignments = (): WorkItemFormAssignments => ({
  backend: '',
  frontend: '',
  ios: '',
  android: '',
  qa: '',
})

const createWorkItemForm = (): WorkItemForm => ({
  epicId: '',
  type: 'story',
  title: '',
  priority: nextPriority.value,
  estimates: emptyWorkEstimates(),
  assignments: emptyAssignments(),
  developmentFlow: defaultDevelopmentFlow(),
  dependencyIds: [],
  requiresDesignReview: false,
  designReviewEstimateMinutes: 0,
  requiresReleaseSupport: false,
  releaseSupport: emptyReleaseSupportEstimates(),
})

const createEpicForm = (): EpicForm => ({
  title: '',
  workItemIds: [],
  releaseSupport: emptyReleaseSupportEstimates(),
})

const form = reactive<WorkItemForm>(createWorkItemForm())
const epicForm = reactive<EpicForm>(createEpicForm())
const durationDrafts = reactive<Record<string, string>>({})
const editingWorkItemId = ref<string | null>(null)
const editingEpicId = ref<string | null>(null)
const workItemFormSnapshot = ref('')
const epicFormSnapshot = ref('')
const dependencyToAddId = ref('')
const showEpicForm = ref(false)
const showWorkItemForm = ref(false)

const availableEstimateFields = computed(() =>
  estimateFields.filter(
    (field) =>
      !field.mobile ||
      (field.mobile === 'ios' && hasIosMember.value) ||
      (field.mobile === 'android' && hasAndroidMember.value),
  ),
)

const availableAssignmentDirections = computed(() =>
  assignmentDirections.filter(
    (direction) =>
      (direction !== 'ios' || hasIosMember.value) &&
      (direction !== 'android' || hasAndroidMember.value),
  ),
)

const availableReleaseSupportFields = computed(() =>
  releaseSupportFields.filter(
    (field) =>
      !field.mobile ||
      (field.mobile === 'ios' && hasIosMember.value) ||
      (field.mobile === 'android' && hasAndroidMember.value),
  ),
)

const dependencyOptions = computed(() =>
  workItems.value.filter((workItem) => workItem.id !== editingWorkItemId.value),
)

const availableDependencyOptions = computed(() =>
  dependencyOptions.value.filter((workItem) => !form.dependencyIds.includes(workItem.id)),
)

const asNumber = (value: number, fallback = 0) => {
  if (Number.isFinite(value)) {
    return value
  }

  return fallback
}

const sanitizeMinutes = (value: number) => Math.max(0, Math.round(asNumber(value)))

const clearDurationDrafts = () => {
  Object.keys(durationDrafts).forEach((key) => {
    delete durationDrafts[key]
  })
}

const estimateDraftKey = (key: keyof WorkEstimates) => `estimate:${String(key)}`
const releaseSupportDraftKey = (key: keyof ReleaseSupportEstimates) =>
  `release-support:${String(key)}`
const epicReleaseSupportDraftKey = (key: keyof ReleaseSupportEstimates) =>
  `epic-release-support:${String(key)}`
const designReviewDraftKey = 'design-review'

const durationInputValue = (draftKey: string, minutes: number) =>
  durationDrafts[draftKey] ?? formatDuration(minutes)

const updateDurationDraft = (draftKey: string, event: Event) => {
  durationDrafts[draftKey] = (event.target as HTMLInputElement).value
}

const parseDurationText = (value: string, fallbackMinutes: number) => {
  const normalizedValue = value.trim().toLowerCase().replace(',', '.')

  if (!normalizedValue) {
    return 0
  }

  const matches = normalizedValue.matchAll(
    /(\d+(?:\.\d+)?)\s*(д|d|day|days|ч|h|час|часа|часов|м|m|мин|minute|minutes)?/g,
  )
  let totalMinutes = 0
  let hasMatches = false

  for (const match of matches) {
    hasMatches = true
    const amount = Number(match[1])
    const unit = match[2]

    if (!Number.isFinite(amount)) {
      continue
    }

    if (unit === 'д' || unit === 'd' || unit === 'day' || unit === 'days') {
      totalMinutes += amount * WORK_DAY_MINUTES
    } else if (
      unit === 'ч' ||
      unit === 'h' ||
      unit === 'час' ||
      unit === 'часа' ||
      unit === 'часов'
    ) {
      totalMinutes += amount * 60
    } else {
      totalMinutes += amount
    }
  }

  return hasMatches ? sanitizeMinutes(totalMinutes) : fallbackMinutes
}

const durationSnapshotValue = (draftKey: string, minutes: number) =>
  draftKey in durationDrafts ? parseDurationText(durationDrafts[draftKey] ?? '', minutes) : minutes

const clearZeroDurationOnFocus = (draftKey: string, minutes: number, event: Event) => {
  if (sanitizeMinutes(minutes) !== 0) {
    return
  }

  durationDrafts[draftKey] = ''
  const input = event.target as HTMLInputElement
  input.value = ''
}

const setEstimateDurationFromText = (key: keyof WorkEstimates, event: Event) => {
  const draftKey = estimateDraftKey(key)
  const input = event.target as HTMLInputElement
  form.estimates[key] = parseDurationText(input.value, form.estimates[key])
  durationDrafts[draftKey] = formatDuration(form.estimates[key])
  input.value = durationDrafts[draftKey]
}

const setReleaseSupportDurationFromText = (key: keyof ReleaseSupportEstimates, event: Event) => {
  const draftKey = releaseSupportDraftKey(key)
  const input = event.target as HTMLInputElement
  form.releaseSupport[key] = parseDurationText(input.value, form.releaseSupport[key])
  durationDrafts[draftKey] = formatDuration(form.releaseSupport[key])
  input.value = durationDrafts[draftKey]
}

const setEpicReleaseSupportDurationFromText = (
  key: keyof ReleaseSupportEstimates,
  event: Event,
) => {
  const draftKey = epicReleaseSupportDraftKey(key)
  const input = event.target as HTMLInputElement
  epicForm.releaseSupport[key] = parseDurationText(input.value, epicForm.releaseSupport[key])
  durationDrafts[draftKey] = formatDuration(epicForm.releaseSupport[key])
  input.value = durationDrafts[draftKey]
}

const setDesignReviewDurationFromText = (event: Event) => {
  const input = event.target as HTMLInputElement
  form.designReviewEstimateMinutes = parseDurationText(
    input.value,
    form.designReviewEstimateMinutes,
  )
  durationDrafts[designReviewDraftKey] = formatDuration(form.designReviewEstimateMinutes)
  input.value = durationDrafts[designReviewDraftKey]
}

const formEstimateMinutes = computed(
  () =>
    sanitizeMinutes(form.estimates.backend) +
    sanitizeMinutes(form.estimates.documentation) +
    sanitizeMinutes(form.estimates.frontend) +
    sanitizeMinutes(form.estimates.ios) +
    sanitizeMinutes(form.estimates.android) +
    sanitizeMinutes(form.estimates.qaTestCaseWriting) +
    sanitizeMinutes(form.estimates.qaTesting),
)

const formDesignReviewMinutes = computed(() =>
  form.requiresDesignReview ? sanitizeMinutes(form.designReviewEstimateMinutes) : 0,
)

const formReleaseSupportMinutes = computed(() => {
  if (!form.requiresReleaseSupport) {
    return 0
  }

  return (
    sanitizeMinutes(form.releaseSupport.backend) +
    sanitizeMinutes(form.releaseSupport.frontend) +
    sanitizeMinutes(form.releaseSupport.ios) +
    sanitizeMinutes(form.releaseSupport.android) +
    sanitizeMinutes(form.releaseSupport.qa)
  )
})

const formReleaseSupportCountsInWorkItem = computed(
  () => !form.epicId && formReleaseSupportMinutes.value > 0,
)

const hasSchedulableWorkItemMinutes = computed(
  () =>
    formEstimateMinutes.value > 0 ||
    formDesignReviewMinutes.value > 0 ||
    formReleaseSupportCountsInWorkItem.value,
)

const canSubmitWorkItem = computed(
  () => Boolean(form.title.trim()) && hasSchedulableWorkItemMinutes.value,
)
const canSubmitEpic = computed(() => Boolean(epicForm.title.trim()))

const workItemFormStateForComparison = () => ({
  epicId: form.epicId,
  type: form.type,
  title: form.title,
  priority: form.priority,
  estimates: {
    backend: durationSnapshotValue(estimateDraftKey('backend'), form.estimates.backend),
    documentation: durationSnapshotValue(
      estimateDraftKey('documentation'),
      form.estimates.documentation,
    ),
    frontend: durationSnapshotValue(estimateDraftKey('frontend'), form.estimates.frontend),
    ios: durationSnapshotValue(estimateDraftKey('ios'), form.estimates.ios),
    android: durationSnapshotValue(estimateDraftKey('android'), form.estimates.android),
    qaTestCaseWriting: durationSnapshotValue(
      estimateDraftKey('qaTestCaseWriting'),
      form.estimates.qaTestCaseWriting,
    ),
    qaTesting: durationSnapshotValue(estimateDraftKey('qaTesting'), form.estimates.qaTesting),
  },
  assignments: { ...form.assignments },
  developmentFlow: { ...form.developmentFlow },
  dependencyIds: [...form.dependencyIds],
  requiresDesignReview: form.requiresDesignReview,
  designReviewEstimateMinutes: durationSnapshotValue(
    designReviewDraftKey,
    form.designReviewEstimateMinutes,
  ),
  requiresReleaseSupport: form.requiresReleaseSupport,
  releaseSupport: {
    backend: durationSnapshotValue(releaseSupportDraftKey('backend'), form.releaseSupport.backend),
    frontend: durationSnapshotValue(
      releaseSupportDraftKey('frontend'),
      form.releaseSupport.frontend,
    ),
    ios: durationSnapshotValue(releaseSupportDraftKey('ios'), form.releaseSupport.ios),
    android: durationSnapshotValue(releaseSupportDraftKey('android'), form.releaseSupport.android),
    qa: durationSnapshotValue(releaseSupportDraftKey('qa'), form.releaseSupport.qa),
  },
})

const epicFormStateForComparison = () => ({
  title: epicForm.title,
  workItemIds: [...epicForm.workItemIds],
  releaseSupport: {
    backend: durationSnapshotValue(
      epicReleaseSupportDraftKey('backend'),
      epicForm.releaseSupport.backend,
    ),
    frontend: durationSnapshotValue(
      epicReleaseSupportDraftKey('frontend'),
      epicForm.releaseSupport.frontend,
    ),
    ios: durationSnapshotValue(epicReleaseSupportDraftKey('ios'), epicForm.releaseSupport.ios),
    android: durationSnapshotValue(
      epicReleaseSupportDraftKey('android'),
      epicForm.releaseSupport.android,
    ),
    qa: durationSnapshotValue(epicReleaseSupportDraftKey('qa'), epicForm.releaseSupport.qa),
  },
})

const snapshotState = (state: unknown) => JSON.stringify(state)

const refreshWorkItemFormSnapshot = () => {
  workItemFormSnapshot.value = snapshotState(workItemFormStateForComparison())
}

const refreshEpicFormSnapshot = () => {
  epicFormSnapshot.value = snapshotState(epicFormStateForComparison())
}

const isWorkItemFormDirty = computed(
  () =>
    showWorkItemForm.value &&
    snapshotState(workItemFormStateForComparison()) !== workItemFormSnapshot.value,
)
const isEpicFormDirty = computed(
  () => showEpicForm.value && snapshotState(epicFormStateForComparison()) !== epicFormSnapshot.value,
)

watch(
  () => props.sprintId,
  () => {
    resetForm()
    resetEpicForm()
  },
)

watch([hasIosMember, hasAndroidMember], () => {
  if (!hasIosMember.value) {
    form.estimates.ios = 0
    form.releaseSupport.ios = 0
    form.assignments.ios = ''
    epicForm.releaseSupport.ios = 0
  }

  if (!hasAndroidMember.value) {
    form.estimates.android = 0
    form.releaseSupport.android = 0
    form.assignments.android = ''
    epicForm.releaseSupport.android = 0
  }
})

const releaseSupportMinutes = (releaseSupport: ReleaseSupportEstimates) =>
  releaseSupport.backend +
  releaseSupport.frontend +
  releaseSupport.ios +
  releaseSupport.android +
  releaseSupport.qa

const workItemEstimateMinutes = (workItem: WorkItem) =>
  workItem.estimates.backend +
  workItem.estimates.documentation +
  workItem.estimates.frontend +
  workItem.estimates.ios +
  workItem.estimates.android +
  workItem.estimates.qaTestCaseWriting +
  workItem.estimates.qaTesting

const epicReleaseSupportMinutes = (epic: Epic) => releaseSupportMinutes(epic.releaseSupport)

const workItemMinutes = (workItem: WorkItem) => {
  const estimateMinutes = workItemEstimateMinutes(workItem)
  const designReviewMinutes = workItem.requiresDesignReview
    ? (workItem.designReviewEstimateMinutes ?? 0)
    : 0
  const releaseMinutes = workItem.requiresReleaseSupport
    ? releaseSupportMinutes(workItem.releaseSupport)
    : 0

  return estimateMinutes + designReviewMinutes + (workItem.epicId ? 0 : releaseMinutes)
}

const epicWorkItems = (epic: Epic) => {
  const workItemIds = new Set(epic.workItemIds)

  return workItems.value.filter((workItem) => workItemIds.has(workItem.id))
}

const epicMinutes = (epic: Epic) =>
  epicWorkItems(epic).reduce((total, workItem) => total + workItemEstimateMinutes(workItem), 0) +
  epicReleaseSupportMinutes(epic)

const epicTitle = (epicId?: string) =>
  epics.value.find((epic) => epic.id === epicId)?.title ?? 'Epic не найден'

const roleMatchesDirection = (role: Role, direction: WorkDirection) => {
  if (direction === 'backend') {
    return role === 'backend' || role === 'tech-lead'
  }

  return role === direction
}

// Members on full-sprint vacation are excluded from responsibility assignment
const membersOnFullSprintVacation = computed(() => {
  if (!sprint.value) return new Set<string>()
  const sprintDates = getSprintWorkingDates(sprint.value)
  if (!sprintDates.length) return new Set<string>()
  const vacations = planningStore.vacations
  return new Set(
    teamMembers.value
      .filter((member) => {
        const memberVacations = vacations.filter((v) => v.memberId === member.id)
        if (!memberVacations.length) return false
        return sprintDates.every((date) =>
          memberVacations.some((v) => date >= v.startDate && date <= v.endDate),
        )
      })
      .map((m) => m.id),
  )
})

const candidateMembersForDirection = (direction: WorkDirection): TeamMember[] =>
  teamMembers.value.filter(
    (member) =>
      roleMatchesDirection(member.role, direction) &&
      !membersOnFullSprintVacation.value.has(member.id),
  )

const dependencyTitle = (dependencyId: string) =>
  workItems.value.find((workItem) => workItem.id === dependencyId)?.title ?? 'Удаленная задача'

const priorityLabelByOrder = (priority: number): WorkItemPriority => {
  if (priority <= 1) {
    return 'critical'
  }

  if (priority === 2) {
    return 'high'
  }

  if (priority === 3) {
    return 'medium'
  }

  return 'low'
}

const resetForm = () => {
  Object.assign(form, createWorkItemForm())
  editingWorkItemId.value = null
  dependencyToAddId.value = ''
  clearDurationDrafts()
  refreshWorkItemFormSnapshot()
  showWorkItemForm.value = false
}

const resetEpicForm = () => {
  Object.assign(epicForm, createEpicForm())
  editingEpicId.value = null
  clearDurationDrafts()
  refreshEpicFormSnapshot()
  showEpicForm.value = false
}

const requestCloseWorkItemForm = async () => {
  if (!isWorkItemFormDirty.value) {
    resetForm()
    return
  }

  const confirmed = await confirmDialog.confirm({
    title: 'Закрыть форму без сохранения?',
    message: 'В форме есть несохраненные изменения. Если закрыть ее сейчас, они будут потеряны.',
    confirmLabel: 'Закрыть без сохранения',
    cancelLabel: 'Вернуться к форме',
    tone: 'danger',
  })

  if (confirmed) {
    resetForm()
  }
}

const requestCloseEpicForm = async () => {
  if (!isEpicFormDirty.value) {
    resetEpicForm()
    return
  }

  const confirmed = await confirmDialog.confirm({
    title: 'Закрыть форму без сохранения?',
    message: 'В форме есть несохраненные изменения. Если закрыть ее сейчас, они будут потеряны.',
    confirmLabel: 'Закрыть без сохранения',
    cancelLabel: 'Вернуться к форме',
    tone: 'danger',
  })

  if (confirmed) {
    resetEpicForm()
  }
}

const workItemToForm = (workItem: WorkItem): WorkItemForm => ({
  epicId: workItem.epicId ?? '',
  type: workItem.type,
  title: workItem.title,
  priority: workItem.priority,
  estimates: {
    ...emptyWorkEstimates(),
    ...workItem.estimates,
  },
  assignments: {
    ...emptyAssignments(),
    ...workItem.assignments,
  },
  developmentFlow: {
    ...defaultDevelopmentFlow(),
    ...workItem.developmentFlow,
  },
  dependencyIds: [...workItem.dependencyIds],
  requiresDesignReview: Boolean(workItem.requiresDesignReview),
  designReviewEstimateMinutes: workItem.designReviewEstimateMinutes ?? 0,
  requiresReleaseSupport: workItem.requiresReleaseSupport,
  releaseSupport: {
    ...emptyReleaseSupportEstimates(),
    ...workItem.releaseSupport,
  },
})

const sanitizeEstimates = (estimates: WorkEstimates): WorkEstimates => ({
  backend: sanitizeMinutes(estimates.backend),
  documentation: sanitizeMinutes(estimates.documentation),
  frontend: sanitizeMinutes(estimates.frontend),
  ios: hasIosMember.value ? sanitizeMinutes(estimates.ios) : 0,
  android: hasAndroidMember.value ? sanitizeMinutes(estimates.android) : 0,
  qaTestCaseWriting: sanitizeMinutes(estimates.qaTestCaseWriting),
  qaTesting: sanitizeMinutes(estimates.qaTesting),
})

const sanitizeReleaseSupport = (
  releaseSupport: ReleaseSupportEstimates,
): ReleaseSupportEstimates => ({
  backend: sanitizeMinutes(releaseSupport.backend),
  frontend: sanitizeMinutes(releaseSupport.frontend),
  ios: hasIosMember.value ? sanitizeMinutes(releaseSupport.ios) : 0,
  android: hasAndroidMember.value ? sanitizeMinutes(releaseSupport.android) : 0,
  qa: sanitizeMinutes(releaseSupport.qa),
})

const sanitizeAssignments = (assignments: WorkItemFormAssignments): WorkAssignments => {
  const validMemberIds = new Set(teamMembers.value.map((member) => member.id))
  const nextAssignments: WorkAssignments = {}

  for (const direction of availableAssignmentDirections.value) {
    const assigneeId = assignments[direction]

    if (assigneeId && validMemberIds.has(assigneeId)) {
      nextAssignments[direction] = assigneeId
    }
  }

  return nextAssignments
}

const toWorkItemInput = () => ({
  sprintId: props.sprintId,
  epicId: form.epicId || undefined,
  type: form.type,
  title: form.title.trim(),
  priority: Math.max(1, Math.round(asNumber(form.priority, nextPriority.value))),
  priorityLabel: priorityLabelByOrder(
    Math.max(1, Math.round(asNumber(form.priority, nextPriority.value))),
  ),
  estimates: sanitizeEstimates(form.estimates),
  assignments: sanitizeAssignments(form.assignments),
  developmentFlow: {
    backendFrontendParallel: form.developmentFlow.backendFrontendParallel,
    mobileParallelWithBackend: form.developmentFlow.mobileParallelWithBackend,
  },
  dependencyIds: form.dependencyIds.filter((dependencyId) =>
    dependencyOptions.value.some((workItem) => workItem.id === dependencyId),
  ),
  requiresDesignReview: form.requiresDesignReview,
  designReviewEstimateMinutes: form.requiresDesignReview
    ? sanitizeMinutes(form.designReviewEstimateMinutes)
    : 0,
  requiresReleaseSupport: form.requiresReleaseSupport,
  releaseSupport: form.requiresReleaseSupport
    ? sanitizeReleaseSupport(form.releaseSupport)
    : emptyReleaseSupportEstimates(),
})

const toEpicInput = () => ({
  sprintId: props.sprintId,
  title: epicForm.title.trim(),
  workItemIds: epicForm.workItemIds.filter((workItemId) =>
    workItems.value.some((workItem) => workItem.id === workItemId),
  ),
  releaseSupport: sanitizeReleaseSupport(epicForm.releaseSupport),
})

const addDependency = () => {
  if (!dependencyToAddId.value || form.dependencyIds.includes(dependencyToAddId.value)) {
    return
  }

  form.dependencyIds = [...form.dependencyIds, dependencyToAddId.value]
  dependencyToAddId.value = ''
}

const removeDependency = (dependencyId: string) => {
  form.dependencyIds = form.dependencyIds.filter((candidateId) => candidateId !== dependencyId)
}

const submitWorkItem = () => {
  const input = toWorkItemInput()

  if (!sprint.value || !input.title || !hasSchedulableWorkItemMinutes.value) {
    return
  }

  if (editingWorkItemId.value) {
    planningStore.updateWorkItem(editingWorkItemId.value, input)
  } else {
    planningStore.createWorkItem(input)
  }

  resetForm()
}

const submitEpic = () => {
  const input = toEpicInput()

  if (!sprint.value || !input.title) {
    return
  }

  if (editingEpicId.value) {
    planningStore.updateEpic(editingEpicId.value, input)
  } else {
    planningStore.createEpic(input)
  }

  resetEpicForm()
}

const startWorkItemEdit = (workItem: WorkItem) => {
  clearDurationDrafts()
  showWorkItemForm.value = true
  editingWorkItemId.value = workItem.id
  Object.assign(form, workItemToForm(workItem))
  refreshWorkItemFormSnapshot()
}

const startEpicEdit = (epic: Epic) => {
  clearDurationDrafts()
  showEpicForm.value = true
  editingEpicId.value = epic.id
  Object.assign(epicForm, {
    title: epic.title,
    workItemIds: [...epic.workItemIds],
    releaseSupport: {
      ...emptyReleaseSupportEstimates(),
      ...epic.releaseSupport,
    },
  })
  refreshEpicFormSnapshot()
}

const deleteWorkItem = async (workItem: WorkItem) => {
  const confirmed = await confirmDialog.confirm({
    title: `Удалить задачу "${workItem.title}"?`,
    message: 'Задача будет удалена из спринта, а зависимости на нее будут очищены.',
    confirmLabel: 'Удалить задачу',
    tone: 'danger',
  })

  if (!confirmed) {
    return
  }

  planningStore.deleteWorkItem(workItem.id)

  if (editingWorkItemId.value === workItem.id) {
    resetForm()
  }
}

const deleteEpic = async (epic: Epic) => {
  const confirmed = await confirmDialog.confirm({
    title: `Удалить epic "${epic.title}"?`,
    message: 'Epic будет удален, а задачи останутся в спринте без группировки.',
    confirmLabel: 'Удалить epic',
    tone: 'danger',
  })

  if (!confirmed) {
    return
  }

  planningStore.deleteEpic(epic.id)

  if (editingEpicId.value === epic.id) {
    resetEpicForm()
  }
}

const hasAllocationResult = computed(() =>
  planningStore.allocationResults.some((r) => r.sprintId === props.sprintId),
)

const isAllocationStale = computed(() => planningStore.isSprintAllocationStale(props.sprintId))

const calculateAndOpenAllocation = () => {
  if (!sprint.value) {
    return
  }

  planningStore.calculateAllocationForSprint(sprint.value.id)
  track('allocation_calculated', {
    sprint_duration_weeks: sprint.value.durationWeeks,
    work_item_count: workItems.value.length,
  })
  router.push({ name: 'sprint-allocation', params: { sprintId: sprint.value.id } })
}

const exportSprintSnapshot = () => {
  if (!sprint.value) return
  exportSprint(sprint.value.id)
}

const openNewEpicForm = () => {
  resetEpicForm()
  showEpicForm.value = true
}

const openNewWorkItemForm = () => {
  resetForm()
  showWorkItemForm.value = true
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
    <template v-if="sprint">
      <header
        class="flex flex-col gap-4 border-b border-teal-100 pb-6 lg:flex-row lg:items-end lg:justify-between"
      >
        <div>
          <p class="text-sm font-bold text-teal-700 uppercase">Рабочее место спринта</p>
          <h1 class="mt-2 text-3xl font-bold text-slate-950">{{ sprint.name }}</h1>
          <p class="mt-3 max-w-2xl text-base text-slate-600">
            {{ team?.name ?? 'Команда не найдена' }} · старт {{ formatDate(sprint.startsOn) }} ·
            {{ sprint.durationWeeks }} нед.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="w-fit rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 transition hover:bg-indigo-100"
            @click="openNewEpicForm"
          >
            Новый epic
          </button>
          <button
            type="button"
            class="w-fit rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-800 transition hover:bg-sky-100"
            @click="openNewWorkItemForm"
          >
            Новая задача
          </button>
          <button
            v-if="!hasAllocationResult"
            type="button"
            class="primary-action w-fit rounded-lg px-3 py-2 text-sm font-medium transition"
            @click="calculateAndOpenAllocation"
          >
            Распределить нагрузку
          </button>
          <RouterLink
            :to="{ name: 'sprint-allocation', params: { sprintId: sprint.id } }"
            :class="
              hasAllocationResult
                ? 'primary-action w-fit rounded-lg px-3 py-2 text-sm font-medium transition'
                : 'w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100'
            "
          >
            Открыть расчет
            <span
              v-if="isAllocationStale"
              class="ml-1.5 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800"
            >
              Устарел
            </span>
          </RouterLink>
          <button
            type="button"
            class="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            @click="exportSprintSnapshot"
          >
            Экспорт
          </button>
        </div>
      </header>
      <p v-if="exportStatus" class="mt-3 text-sm font-medium text-slate-600">
        {{ exportStatus }}
      </p>

      <div
        v-if="isAllocationStale"
        class="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <span class="shrink-0 text-amber-600">⚠️</span>
        <div class="min-w-0 text-sm">
          <p class="font-semibold text-amber-900">Расчёт устарел</p>
          <p class="mt-0.5 text-amber-800">
            Данные спринта изменились после последнего расчёта нагрузки — пересчитайте
            распределение, чтобы результат был актуальным.
          </p>
        </div>
        <button
          type="button"
          class="ml-auto shrink-0 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
          @click="calculateAndOpenAllocation"
        >
          Пересчитать
        </button>
      </div>

      <section class="mt-6">
        <div class="grid gap-4">
          <section
            v-for="epic in epics"
            :key="epic.id"
            class="rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-5 shadow-sm shadow-indigo-100/80"
          >
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap gap-2">
                  <span
                    class="rounded-md bg-gradient-to-r from-indigo-700 to-fuchsia-600 px-2 py-1 text-xs font-semibold text-white shadow-sm shadow-indigo-700/20"
                  >
                    Epic
                  </span>
                  <span
                    class="rounded-md bg-white px-2 py-1 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200"
                  >
                    {{ epicWorkItems(epic).length }} задач
                  </span>
                  <span
                    class="rounded-md bg-white px-2 py-1 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200"
                  >
                    {{ formatDuration(epicMinutes(epic)) }}
                  </span>
                </div>
                <h2 class="mt-2 text-xl font-bold text-slate-950">{{ epic.title }}</h2>
                <p class="mt-1 text-sm text-indigo-900">
                  Релизное сопровождение на уровне epic:
                  {{ formatDuration(epicReleaseSupportMinutes(epic)) }}
                </p>
              </div>
              <div class="flex shrink-0 flex-wrap gap-2 md:justify-end">
                <button
                  type="button"
                  class="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-sm font-medium text-indigo-800 transition hover:bg-indigo-100"
                  @click="startEpicEdit(epic)"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
                  @click="deleteEpic(epic)"
                >
                  Удалить
                </button>
              </div>
            </div>

            <div v-if="epicWorkItems(epic).length" class="mt-4 grid gap-3">
              <article
                v-for="workItem in epicWorkItems(epic)"
                :key="workItem.id"
                class="group rounded-lg border border-indigo-100 bg-white/90 p-4 shadow-sm hover-card"
              >
                <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap gap-2">
                      <span
                        class="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white"
                      >
                        #{{ workItem.priority }}
                      </span>
                      <span
                        class="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        {{ typeLabels[workItem.type] }}
                      </span>
                      <span
                        class="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                      >
                        {{ formatDuration(workItemMinutes(workItem)) }}
                      </span>
                    </div>
                    <h3 class="mt-1 text-base font-semibold text-slate-950">
                      {{ workItem.title }}
                    </h3>
                  </div>
                  <div class="hover-actions flex shrink-0 flex-wrap gap-2 md:justify-end">
                    <button
                      type="button"
                      class="rounded-lg border border-teal-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
                      @click="startWorkItemEdit(workItem)"
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      class="rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                      @click="deleteWorkItem(workItem)"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
                <div class="mt-3 flex flex-wrap gap-2 text-sm">
                  <span
                    class="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                  >
                    Dev
                    {{
                      formatDuration(
                        workItem.estimates.backend +
                          workItem.estimates.frontend +
                          workItem.estimates.ios +
                          workItem.estimates.android,
                      )
                    }}
                  </span>
                  <span
                    class="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                  >
                    QA
                    {{
                      formatDuration(
                        workItem.estimates.qaTestCaseWriting + workItem.estimates.qaTesting,
                      )
                    }}
                  </span>
                  <span
                    v-if="workItem.estimates.documentation"
                    class="rounded-md bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-sky-200"
                  >
                    Документация {{ formatDuration(workItem.estimates.documentation) }}
                  </span>
                  <span
                    v-if="workItem.requiresReleaseSupport"
                    class="rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 ring-1 ring-amber-200"
                  >
                    Сопровождение учитывается в epic
                  </span>
                  <span
                    v-if="workItem.requiresDesignReview"
                    class="rounded-md bg-fuchsia-50 px-2.5 py-1 font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200"
                  >
                    Design review {{ formatDuration(workItem.designReviewEstimateMinutes ?? 0) }}
                  </span>
                </div>
              </article>
            </div>
            <p
              v-else
              class="mt-4 rounded-lg border border-dashed border-indigo-200 bg-white p-4 text-sm text-indigo-900"
            >
              В этом epic пока нет задач.
            </p>
          </section>

          <article
            v-for="workItem in ungroupedWorkItems"
            :key="workItem.id"
            class="group accent-strip surface-card rounded-lg border p-5 pl-6 hover-card"
          >
            <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap gap-2">
                  <span class="rounded-md bg-teal-700 px-2 py-1 text-xs font-semibold text-white">
                    #{{ workItem.priority }}
                  </span>
                  <span
                    class="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    {{ typeLabels[workItem.type] }}
                  </span>
                  <span
                    class="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    {{ formatDuration(workItemMinutes(workItem)) }}
                  </span>
                  <span
                    v-if="workItem.epicId"
                    class="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700"
                  >
                    {{ epicTitle(workItem.epicId) }}
                  </span>
                </div>
                <h2 class="mt-1 text-lg font-semibold text-slate-950">{{ workItem.title }}</h2>
              </div>
              <div class="hover-actions flex shrink-0 flex-wrap gap-2 md:justify-end">
                <button
                  type="button"
                  class="rounded-lg border border-teal-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
                  @click="startWorkItemEdit(workItem)"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  @click="deleteWorkItem(workItem)"
                >
                  Удалить
                </button>
              </div>
            </div>

            <div class="mt-4">
              <p class="text-xs font-semibold text-slate-500 uppercase">Назначения</p>
              <dl class="mt-2 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div
                  v-for="direction in availableAssignmentDirections"
                  :key="direction"
                  class="rounded-md bg-slate-50 px-3 py-2"
                >
                  <dt class="text-xs font-medium text-slate-500">
                    {{ directionLabels[direction] }}
                  </dt>
                  <dd class="mt-0.5 font-semibold text-slate-900">
                    {{ memberNameById[workItem.assignments[direction] ?? ''] ?? 'Не назначен' }}
                  </dd>
                </div>
              </dl>
            </div>

            <div class="mt-4 border-t border-slate-100 pt-3">
              <p class="text-xs font-semibold text-slate-500 uppercase">Планирование</p>
              <div class="mt-2 flex flex-wrap gap-2 text-sm">
                <span
                  class="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                >
                  Dev
                  {{
                    formatDuration(
                      workItem.estimates.backend +
                        workItem.estimates.frontend +
                        workItem.estimates.ios +
                        workItem.estimates.android,
                    )
                  }}
                </span>
                <span
                  class="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                >
                  QA
                  {{
                    formatDuration(
                      workItem.estimates.qaTestCaseWriting + workItem.estimates.qaTesting,
                    )
                  }}
                </span>
                <span
                  v-if="workItem.estimates.documentation"
                  class="rounded-md bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 ring-1 ring-sky-200"
                >
                  Документация {{ formatDuration(workItem.estimates.documentation) }}
                </span>
                <span
                  v-if="workItem.dependencyIds.length"
                  class="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-slate-200"
                >
                  Зависимости: {{ workItem.dependencyIds.length }}
                </span>
                <span
                  v-if="workItem.requiresReleaseSupport"
                  class="rounded-md bg-amber-50 px-2.5 py-1 font-semibold text-amber-700 ring-1 ring-amber-200"
                >
                  Релизное сопровождение
                </span>
                <span
                  v-if="workItem.requiresDesignReview"
                  class="rounded-md bg-fuchsia-50 px-2.5 py-1 font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200"
                >
                  Design review {{ formatDuration(workItem.designReviewEstimateMinutes ?? 0) }}
                </span>
              </div>
            </div>
          </article>

          <section
            v-if="workItems.length === 0 && epics.length === 0"
            class="rounded-lg border border-dashed border-slate-300 bg-white p-8"
          >
            <h2 class="text-lg font-semibold text-slate-950">Задач пока нет</h2>
            <p class="mt-2 text-sm text-slate-600">Добавьте story или prod bug.</p>
            <button
              type="button"
              class="primary-action mt-4 rounded-lg px-3 py-2 text-sm font-medium transition"
              @click="openNewWorkItemForm"
            >
              Добавить задачу
            </button>
          </section>
        </div>

        <AppModal
          :open="showEpicForm"
          :title="editingEpicId ? 'Редактировать epic' : 'Новый epic'"
          @close="requestCloseEpicForm"
        >
          <form class="grid gap-5" @submit.prevent="submitEpic">
            <label>
              <span class="text-sm font-medium text-slate-700">Название</span>
              <input
                v-model="epicForm.title"
                required
                placeholder="Release package"
                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </label>

            <section class="grid gap-3">
              <h3 class="text-sm font-semibold text-slate-950">Состав epic</h3>
              <div v-if="workItems.length" class="grid max-h-48 gap-2 overflow-y-auto pr-1">
                <label
                  v-for="workItem in workItems"
                  :key="workItem.id"
                  class="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <input
                    v-model="epicForm.workItemIds"
                    :value="workItem.id"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-slate-950"
                  />
                  <span class="min-w-0">
                    <span class="block font-semibold text-slate-950">
                      #{{ workItem.priority }} · {{ workItem.title }}
                    </span>
                    <span class="mt-0.5 block text-xs text-slate-500">
                      {{ typeLabels[workItem.type] }}
                      <template v-if="workItem.epicId && workItem.epicId !== editingEpicId">
                        · сейчас в {{ epicTitle(workItem.epicId) }}
                      </template>
                    </span>
                  </span>
                </label>
              </div>
              <p
                v-else
                class="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-600"
              >
                Сначала добавьте story или prod bug.
              </p>
            </section>

            <section
              class="grid gap-3 rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4"
            >
              <h3 class="text-sm font-semibold text-slate-950">Сопровождение epic</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <div v-for="field in availableReleaseSupportFields" :key="field.key">
                  <span class="text-sm font-medium text-slate-700">{{ field.label }}</span>
                  <input
                    :value="
                      durationInputValue(
                        epicReleaseSupportDraftKey(field.key),
                        epicForm.releaseSupport[field.key],
                      )
                    "
                    placeholder="2д 3ч 15м"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    @focus="
                      clearZeroDurationOnFocus(
                        epicReleaseSupportDraftKey(field.key),
                        epicForm.releaseSupport[field.key],
                        $event,
                      )
                    "
                    @blur="setEpicReleaseSupportDurationFromText(field.key, $event)"
                    @change="setEpicReleaseSupportDurationFromText(field.key, $event)"
                    @input="updateDurationDraft(epicReleaseSupportDraftKey(field.key), $event)"
                  />
                  <p class="mt-1 text-xs font-medium text-slate-500">
                    Можно ввести 2д, 12ч, 45м или число минут.
                  </p>
                </div>
              </div>
            </section>

            <div class="flex flex-wrap gap-2">
              <button
                type="submit"
                :disabled="!canSubmitEpic"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {{ editingEpicId ? 'Сохранить epic' : 'Создать epic' }}
              </button>
              <button
                v-if="editingEpicId"
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="requestCloseEpicForm"
              >
                Отмена
              </button>
            </div>
          </form>
        </AppModal>

        <AppModal
          :open="showWorkItemForm"
          :title="editingWorkItemId ? 'Редактировать задачу' : 'Новая задача'"
          size="xl"
          @close="requestCloseWorkItemForm"
        >
          <form class="grid gap-6" @submit.prevent="submitWorkItem">
            <section class="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <h3 class="text-sm font-semibold text-slate-950">Основное</h3>
              <div class="mt-4 grid gap-4 lg:grid-cols-[1fr_180px_180px]">
                <label class="lg:col-span-1">
                  <span class="text-sm font-medium text-slate-700">Название</span>
                  <input
                    v-model="form.title"
                    required
                    placeholder="Checkout retry story"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>
                <label>
                  <span class="text-sm font-medium text-slate-700">Тип</span>
                  <select
                    v-model="form.type"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  >
                    <option v-for="type in typeOptions" :key="type.value" :value="type.value">
                      {{ type.label }}
                    </option>
                  </select>
                </label>
                <label>
                  <span class="text-sm font-medium text-slate-700">Порядок</span>
                  <input
                    v-model.number="form.priority"
                    min="1"
                    required
                    type="number"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>
                <label v-if="epics.length" class="lg:col-span-3">
                  <span class="text-sm font-medium text-slate-700">Epic</span>
                  <select
                    v-model="form.epicId"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  >
                    <option value="">Без epic</option>
                    <option v-for="epic in epics" :key="epic.id" :value="epic.id">
                      {{ epic.title }}
                    </option>
                  </select>
                </label>
              </div>
            </section>

            <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
              <section class="self-start rounded-lg border border-slate-200 bg-white p-4">
                <div class="flex items-center justify-between gap-3">
                  <h3 class="text-sm font-semibold text-slate-950">Оценки</h3>
                  <span
                    v-if="!hasSchedulableWorkItemMinutes"
                    class="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 ring-1 ring-red-200"
                  >
                    Нужна оценка или сопровождение
                  </span>
                </div>
                <div class="mt-4 grid gap-4 sm:grid-cols-2">
                  <div v-for="field in availableEstimateFields" :key="field.key">
                    <span class="text-sm font-medium text-slate-700">{{ field.label }}</span>
                    <input
                      :value="
                        durationInputValue(estimateDraftKey(field.key), form.estimates[field.key])
                      "
                      placeholder="2д 3ч 15м"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                      @focus="
                        clearZeroDurationOnFocus(
                          estimateDraftKey(field.key),
                          form.estimates[field.key],
                          $event,
                        )
                      "
                      @blur="setEstimateDurationFromText(field.key, $event)"
                      @change="setEstimateDurationFromText(field.key, $event)"
                      @input="updateDurationDraft(estimateDraftKey(field.key), $event)"
                    />
                  </div>
                </div>
                <p class="mt-3 text-xs font-medium text-slate-500">
                  Формат: 2д, 12ч, 45м или число минут.
                </p>
              </section>

              <section class="self-start rounded-lg border border-slate-200 bg-white p-4">
                <h3 class="text-sm font-semibold text-slate-950">Назначения</h3>
                <div class="mt-4 grid gap-3">
                  <label v-for="direction in availableAssignmentDirections" :key="direction">
                    <span class="text-sm font-medium text-slate-700">
                      {{ directionLabels[direction] }}
                    </span>
                    <select
                      v-model="form.assignments[direction]"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                    >
                      <option value="">Не назначен</option>
                      <option
                        v-for="member in candidateMembersForDirection(direction)"
                        :key="member.id"
                        :value="member.id"
                      >
                        {{ member.name }} · {{ roleLabels[member.role] }}
                      </option>
                    </select>
                  </label>
                </div>
              </section>
            </div>

            <div class="grid items-start gap-6 lg:grid-cols-2">
              <section
                class="grid self-start gap-3 rounded-lg border border-slate-200 bg-white p-4"
              >
                <h3 class="text-sm font-semibold text-slate-950">Порядок разработки</h3>
                <label
                  class="flex gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm"
                >
                  <input
                    v-model="form.developmentFlow.backendFrontendParallel"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span class="text-slate-700">Backend и frontend могут идти параллельно</span>
                </label>
                <label
                  v-if="hasIosMember || hasAndroidMember"
                  class="flex gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm"
                >
                  <input
                    v-model="form.developmentFlow.mobileParallelWithBackend"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700"
                  />
                  <span class="text-slate-700">
                    Mobile-разработка может идти параллельно backend
                  </span>
                </label>
              </section>

              <section
                v-if="dependencyOptions.length"
                class="grid self-start gap-3 rounded-lg border border-sky-100 bg-sky-50/60 p-4"
              >
                <h3 class="text-sm font-semibold text-slate-950">Зависимости</h3>
                <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <select
                    v-model="dependencyToAddId"
                    :disabled="!availableDependencyOptions.length"
                    class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition disabled:bg-slate-100 disabled:text-slate-500 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  >
                    <option value="">
                      {{
                        availableDependencyOptions.length
                          ? 'Выберите задачу'
                          : 'Все доступные зависимости добавлены'
                      }}
                    </option>
                    <option
                      v-for="dependency in availableDependencyOptions"
                      :key="dependency.id"
                      :value="dependency.id"
                    >
                      #{{ dependency.priority }} · {{ dependency.title }}
                    </option>
                  </select>
                  <button
                    type="button"
                    :disabled="!dependencyToAddId"
                    class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium whitespace-nowrap text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    @click="addDependency"
                  >
                    Добавить
                  </button>
                </div>

                <div
                  v-if="form.dependencyIds.length"
                  class="grid max-h-40 gap-2 overflow-y-auto pr-1"
                >
                  <div
                    v-for="dependencyId in form.dependencyIds"
                    :key="dependencyId"
                    class="flex items-start justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span class="min-w-0 text-slate-700">{{ dependencyTitle(dependencyId) }}</span>
                    <button
                      type="button"
                      class="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
                      @click="removeDependency(dependencyId)"
                    >
                      Убрать
                    </button>
                  </div>
                </div>
              </section>
            </div>

            <div class="grid items-start gap-6 lg:grid-cols-2">
              <section
                class="grid self-start gap-3 rounded-lg border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-white p-4"
              >
                <h3 class="text-sm font-semibold text-slate-950">Design review</h3>
                <label class="flex gap-3 rounded-lg border border-fuchsia-200 bg-white p-3 text-sm">
                  <input
                    v-model="form.requiresDesignReview"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-fuchsia-700"
                  />
                  <span class="text-slate-700">Нужен отдельный review-этап</span>
                </label>

                <div v-if="form.requiresDesignReview" class="grid gap-3">
                  <div>
                    <span class="text-sm font-medium text-slate-700">Оценка</span>
                    <input
                      :value="
                        durationInputValue(designReviewDraftKey, form.designReviewEstimateMinutes)
                      "
                      placeholder="2д 3ч 15м"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100"
                      @focus="
                        clearZeroDurationOnFocus(
                          designReviewDraftKey,
                          form.designReviewEstimateMinutes,
                          $event,
                        )
                      "
                      @blur="setDesignReviewDurationFromText"
                      @change="setDesignReviewDurationFromText"
                      @input="updateDurationDraft(designReviewDraftKey, $event)"
                    />
                  </div>

                  <div class="rounded-lg border border-fuchsia-200 bg-white px-3 py-2 text-sm">
                    <p class="text-xs font-medium text-slate-500">Исполнитель</p>
                    <p class="mt-1 font-semibold text-slate-950">Дизайнер</p>
                  </div>
                </div>
              </section>

              <section
                class="grid self-start gap-3 rounded-lg border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-4"
              >
                <h3 class="text-sm font-semibold text-slate-950">Релизное сопровождение</h3>
                <label class="flex gap-3 rounded-lg border border-amber-200 bg-white p-3 text-sm">
                  <input
                    v-model="form.requiresReleaseSupport"
                    type="checkbox"
                    class="mt-1 h-4 w-4 rounded border-slate-300 text-amber-700"
                  />
                  <span class="text-slate-700">Нужно релизное сопровождение</span>
                </label>

                <div v-if="form.requiresReleaseSupport" class="grid gap-3 sm:grid-cols-2">
                  <div v-for="field in availableReleaseSupportFields" :key="field.key">
                    <span class="text-sm font-medium text-slate-700">{{ field.label }}</span>
                    <input
                      :value="
                        durationInputValue(
                          releaseSupportDraftKey(field.key),
                          form.releaseSupport[field.key],
                        )
                      "
                      placeholder="2д 3ч 15м"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-100"
                      @focus="
                        clearZeroDurationOnFocus(
                          releaseSupportDraftKey(field.key),
                          form.releaseSupport[field.key],
                          $event,
                        )
                      "
                      @blur="setReleaseSupportDurationFromText(field.key, $event)"
                      @change="setReleaseSupportDurationFromText(field.key, $event)"
                      @input="updateDurationDraft(releaseSupportDraftKey(field.key), $event)"
                    />
                  </div>
                </div>
              </section>
            </div>

            <div
              class="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap gap-2 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur"
            >
              <button
                type="submit"
                :disabled="!canSubmitWorkItem"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {{ editingWorkItemId ? 'Сохранить' : 'Добавить задачу' }}
              </button>
              <button
                v-if="editingWorkItemId"
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="requestCloseWorkItemForm"
              >
                Отмена
              </button>
            </div>
          </form>
        </AppModal>
      </section>
    </template>

    <section v-else class="rounded-lg border border-dashed border-slate-300 bg-white p-8">
      <h1 class="text-xl font-semibold text-slate-950">Спринт не найден</h1>
      <p class="mt-2 text-sm text-slate-600">
        Проверьте список спринтов или выберите существующий контейнер планирования.
      </p>
      <RouterLink
        :to="{ name: 'sprints' }"
        class="primary-action mt-4 inline-flex rounded-lg px-3 py-2 text-sm font-medium"
      >
        К спринтам
      </RouterLink>
    </section>
  </main>
</template>
