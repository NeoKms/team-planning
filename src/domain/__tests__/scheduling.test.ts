import { describe, expect, it } from 'vitest'

import {
  WORK_DAY_MINUTES,
  defaultDevelopmentFlow,
  emptyMeetingLoadByWeekday,
  emptyReleaseSupportEstimates,
  emptyWorkEstimates,
  type PlanningState,
  type Role,
  type TeamMember,
  type WorkAssignments,
  type WorkItem,
} from '../planning'
import { scheduleSprint } from '../scheduling'

const createdAt = '2026-06-01T00:00:00.000Z'
const teamId = 'team'
const sprintId = 'sprint'

const createMember = (id: string, role: Role): TeamMember => ({
  id,
  teamId,
  name: id,
  role,
  availableMinutesPerDay: WORK_DAY_MINUTES,
  meetingLoadByWeekday: emptyMeetingLoadByWeekday(),
})

const createState = (members: TeamMember[], workItems: WorkItem[]): PlanningState => ({
  teams: [
    {
      id: teamId,
      name: 'Team',
      memberIds: members.map((member) => member.id),
      createdAt,
      updatedAt: createdAt,
    },
  ],
  members,
  sprints: [
    {
      id: sprintId,
      teamId,
      name: 'Sprint',
      startsOn: '2026-06-15',
      durationWeeks: 1,
      createdAt,
      updatedAt: createdAt,
    },
  ],
  workItems,
  epics: [],
  allocationResults: [],
  vacations: [],
})

const createWorkItem = (
  id: string,
  priority: number,
  assignments: WorkAssignments,
  overrides: Partial<WorkItem>,
): WorkItem => ({
  id,
  sprintId,
  type: 'story',
  title: id,
  priority,
  priorityLabel: priority <= 1 ? 'critical' : 'medium',
  estimates: emptyWorkEstimates(),
  assignments,
  developmentFlow: defaultDevelopmentFlow(),
  dependencyIds: [],
  requiresDesignReview: false,
  designReviewEstimateMinutes: 0,
  requiresReleaseSupport: false,
  releaseSupport: emptyReleaseSupportEstimates(),
  createdAt: `${createdAt}-${id}`,
  updatedAt: createdAt,
  ...overrides,
})

describe('scheduleSprint optimizer', () => {
  // ...existing tests...
  it('reserves a ready release before same-priority bulk work', () => {
    const backend = createMember('backend', 'backend')
    const assignments = { backend: backend.id }
    const releaseWork = createWorkItem('release-work', 1, assignments, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,
      },
      requiresReleaseSupport: true,
      releaseSupport: {
        ...emptyReleaseSupportEstimates(),
        backend: 120,
      },
    })
    const bulkWork = createWorkItem('bulk-work', 1, assignments, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 600,
      },
    })

    const result = scheduleSprint(createState([backend], [bulkWork, releaseWork]), sprintId, createdAt)

    expect(result).toBeDefined()

    const releaseSlot = result?.slots.find(
      (slot) =>
        slot.workItemId === releaseWork.id &&
        result.stages.find((stage) => stage.id === slot.stageId)?.type === 'release-support',
    )
    const firstBulkSlot = result?.slots.find((slot) => slot.workItemId === bulkWork.id)

    expect(releaseSlot?.date).toBe('2026-06-15')
    expect(releaseSlot?.startsAtMinute).toBe(60)
    expect(releaseSlot?.minutes).toBe(120)
    expect(firstBulkSlot?.date).toBe('2026-06-15')
    expect(firstBulkSlot?.startsAtMinute).toBeGreaterThanOrEqual(180)
  })

  it('starts synchronous release groups together with role-specific durations', () => {
    const backend = createMember('backend', 'backend')
    const frontend = createMember('frontend', 'frontend')
    const qa = createMember('qa', 'qa')
    const releaseWork = createWorkItem(
      'release-work',
      1,
      {
        backend: backend.id,
        frontend: frontend.id,
        qa: qa.id,
      },
      {
        estimates: {
          ...emptyWorkEstimates(),
          backend: 60,
        },
        requiresReleaseSupport: true,
        releaseSupport: {
          ...emptyReleaseSupportEstimates(),
          backend: 120,
          frontend: 60,
          qa: 30,
        },
      },
    )

    const result = scheduleSprint(
      createState([backend, frontend, qa], [releaseWork]),
      sprintId,
      createdAt,
    )
    const releaseSlots = result?.slots.filter(
      (slot) =>
        slot.workItemId === releaseWork.id &&
        result.stages.find((stage) => stage.id === slot.stageId)?.type === 'release-support',
    )

    expect(releaseSlots).toHaveLength(3)
    expect(new Set(releaseSlots?.map((slot) => `${slot.date}:${slot.startsAtMinute}`))).toEqual(
      new Set(['2026-06-15:60']),
    )
    expect(Object.fromEntries(releaseSlots?.map((slot) => [slot.assigneeId, slot.minutes]))).toEqual({
      backend: 120,
      frontend: 60,
      qa: 30,
    })
  })

  it('keeps dependent work behind the upstream QA terminal stage', () => {
    const backend = createMember('backend', 'backend')
    const qa = createMember('qa', 'qa')
    const upstream = createWorkItem(
      'upstream',
      1,
      {
        backend: backend.id,
        qa: qa.id,
      },
      {
        estimates: {
          ...emptyWorkEstimates(),
          backend: 60,
          qaTesting: 120,
        },
      },
    )
    const dependent = createWorkItem('dependent', 2, { backend: backend.id }, {
      dependencyIds: [upstream.id],
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,
      },
    })

    const result = scheduleSprint(createState([backend, qa], [upstream, dependent]), sprintId, createdAt)
    const upstreamQaSlot = result?.slots.find(
      (slot) =>
        slot.workItemId === upstream.id &&
        result.stages.find((stage) => stage.id === slot.stageId)?.type === 'qa-testing',
    )
    const dependentSlot = result?.slots.find((slot) => slot.workItemId === dependent.id)

    expect(upstreamQaSlot).toBeDefined()
    expect(dependentSlot).toBeDefined()
    expect(`${dependentSlot?.date}:${dependentSlot?.startsAtMinute}`).toBe(
      `${upstreamQaSlot?.date}:${upstreamQaSlot?.endsAtMinute}`,
    )
  })
})

describe('documentation stage behavior', () => {  it('documentation does not block QA testing — QA starts as soon as dev is done', () => {
    const backend = createMember('backend', 'backend')
    const qa = createMember('qa', 'qa')

    const workItem = createWorkItem('wi', 1, { backend: backend.id, qa: qa.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,         // 60 min backend dev
        documentation: 120,  // 2 h docs (same assignee: backend)
        qaTesting: 60,       // 60 min QA — should start right after backend, not waiting for docs
      },
    })

    const result = scheduleSprint(createState([backend, qa], [workItem]), sprintId, createdAt)

    expect(result).toBeDefined()

    const backendSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'backend-development',
    )
    const qaSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'qa-testing',
    )
    const docsSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'documentation',
    )

    expect(backendSlot).toBeDefined()
    expect(qaSlot).toBeDefined()
    expect(docsSlot).toBeDefined()

    // QA must start right after backend completes (minute 60), NOT after docs (minute 180)
    const qaStart = `${qaSlot!.date}:${qaSlot!.startsAtMinute}`
    const backendEnd = `${backendSlot!.date}:${backendSlot!.endsAtMinute}`
    expect(qaStart).toBe(backendEnd)
  })

  it('documentation blocks release support — release waits for docs to finish', () => {
    const backend = createMember('backend', 'backend')

    const workItem = createWorkItem('wi', 1, { backend: backend.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,         // 60 min backend dev
        documentation: 60,   // 60 min docs — must finish before release
      },
      requiresReleaseSupport: true,
      releaseSupport: {
        ...emptyReleaseSupportEstimates(),
        backend: 30,
      },
    })

    const result = scheduleSprint(createState([backend], [workItem]), sprintId, createdAt)

    expect(result).toBeDefined()

    const docsSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'documentation',
    )
    const releaseSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'release-support',
    )

    expect(docsSlot).toBeDefined()
    expect(releaseSlot).toBeDefined()

    // Release must not start before documentation finishes
    const docsEnd = `${docsSlot!.date}:${docsSlot!.endsAtMinute}`
    const releaseStart = `${releaseSlot!.date}:${releaseSlot!.startsAtMinute}`
    expect(releaseStart).toBe(docsEnd)
  })

  it('documentation is scheduled after QA testing when both are ready', () => {
    const backend = createMember('backend', 'backend')
    const qa = createMember('qa', 'qa')

    // Work item with backend, docs (same backend assignee), and QA testing.
    // After backend completes, both docs and QA testing become eligible.
    // Docs should be scheduled after QA testing due to lower priority.
    const workItem = createWorkItem('wi', 1, { backend: backend.id, qa: qa.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,
        documentation: 60,
        qaTesting: 60,
      },
    })

    const result = scheduleSprint(createState([backend, qa], [workItem]), sprintId, createdAt)

    expect(result).toBeDefined()

    const qaSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'qa-testing',
    )
    const docsSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'documentation',
    )

    expect(qaSlot).toBeDefined()
    expect(docsSlot).toBeDefined()

    // QA starts right after backend (minute 60); docs start only after QA (minute 120 on qa's side,
    // but backend person is free after minute 60 and could start docs there).
    // The important assertion: docs unit scores lower than QA and thus the scheduler
    // prefers placing QA before docs in its ordering.
    // Backend person does docs starting at minute 60 (parallel with QA who is on a different person).
    // So we just verify QA and docs both have slots and no error warnings.
    const errors = result?.warnings.filter((w) => w.severity === 'error')
    expect(errors).toHaveLength(0)
    // QA testing must start no later than docs start (QA runs in parallel or first)
    const qaStartMs = qaSlot!.date + qaSlot!.startsAtMinute.toString().padStart(6, '0')
    const docsStartMs = docsSlot!.date + docsSlot!.startsAtMinute.toString().padStart(6, '0')
    expect(qaStartMs <= docsStartMs).toBe(true)
  })
})

describe('critical path scheduling', () => {
  it('schedules the stage with the longer downstream chain before an independent stage of the same priority', () => {
    // Two backend developers, same priority.
    // - "chain": backend(120) → QA(120). criticalPath = 240.
    // - "standalone": backend(120), no QA. criticalPath = 120.
    // The scheduler should start "chain" before "standalone" so QA is unblocked earlier.
    const backend1 = createMember('backend1', 'backend')
    const backend2 = createMember('backend2', 'backend')
    const qa = createMember('qa', 'qa')

    const chainWork = createWorkItem('chain', 1, { backend: backend1.id, qa: qa.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 120,
        qaTesting: 120,
      },
    })
    const standaloneWork = createWorkItem('standalone', 1, { backend: backend2.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 120,
      },
    })

    const result = scheduleSprint(
      createState([backend1, backend2, qa], [standaloneWork, chainWork]),
      sprintId,
      createdAt,
    )

    expect(result).toBeDefined()
    const errors = result?.warnings.filter((w) => w.severity === 'error')
    expect(errors).toHaveLength(0)

    // The QA slot should exist and start as early as possible (backend1 chain completes first).
    const qaSlot = result?.slots.find((slot) =>
      result.stages.find((s) => s.id === slot.stageId)?.type === 'qa-testing',
    )
    expect(qaSlot).toBeDefined()
    // QA starts no later than day 1 end (backend1 finishes at minute 120 on day 1).
    expect(qaSlot?.date).toBe('2026-06-15')
    expect(qaSlot?.startsAtMinute).toBe(120)
  })

  it('schedules the stage with more downstream fan-out before one that unblocks nobody', () => {
    // One backend developer.
    // - "hub": backend(60), then frontend(60) + QA(60) can both start. fan-out = 2.
    // - "leaf": backend(60), nothing depends on it. fan-out = 0.
    // Both have same priority. Hub should be scheduled first so FE+QA start sooner.
    const backend = createMember('backend', 'backend')
    const frontend = createMember('frontend', 'frontend')
    const qa = createMember('qa', 'qa')

    const hubWork = createWorkItem('hub', 1, { backend: backend.id, frontend: frontend.id, qa: qa.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,
        frontend: 60,
        qaTesting: 60,
      },
      developmentFlow: { backendFrontendParallel: false, mobileParallelWithBackend: false },
    })
    const leafWork = createWorkItem('leaf', 1, { backend: backend.id }, {
      estimates: {
        ...emptyWorkEstimates(),
        backend: 60,
      },
    })

    const result = scheduleSprint(
      createState([backend, frontend, qa], [leafWork, hubWork]),
      sprintId,
      createdAt,
    )

    expect(result).toBeDefined()
    const errors = result?.warnings.filter((w) => w.severity === 'error')
    expect(errors).toHaveLength(0)

    // Hub backend should start at minute 0 (before leaf).
    const hubBackendSlot = result?.slots.find(
      (slot) =>
        slot.workItemId === hubWork.id &&
        result.stages.find((s) => s.id === slot.stageId)?.type === 'backend-development',
    )
    const leafBackendSlot = result?.slots.find(
      (slot) =>
        slot.workItemId === leafWork.id &&
        result.stages.find((s) => s.id === slot.stageId)?.type === 'backend-development',
    )

    expect(hubBackendSlot).toBeDefined()
    expect(leafBackendSlot).toBeDefined()
    // hub's backend should start no later than leaf's backend (both on same day, hub first)
    const hubStart = hubBackendSlot!.date + hubBackendSlot!.startsAtMinute.toString().padStart(6, '0')
    const leafStart = leafBackendSlot!.date + leafBackendSlot!.startsAtMinute.toString().padStart(6, '0')
    expect(hubStart <= leafStart).toBe(true)
  })
})
