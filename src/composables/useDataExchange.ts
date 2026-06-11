import { ref } from 'vue'

import {
  type ExportEnvelope,
  type ExportEnvelopeType,
  type PlanningState,
  type TeamExportData,
} from '@/domain/planning'
import { usePlanningStore } from '@/stores/planning'

// ─── Base64 helpers (UTF-8 safe) ───────────────────────────────────────────

const encodeToBase64 = (data: unknown): string => {
  const json = JSON.stringify(data)
  // encodeURIComponent → percent-encoded UTF-8, unescape → latin1 bytes safe for btoa
  return btoa(unescape(encodeURIComponent(json)))
}

const decodeFromBase64 = (encoded: string): unknown => {
  const json = decodeURIComponent(escape(atob(encoded)))
  return JSON.parse(json)
}

// ─── Envelope helpers ──────────────────────────────────────────────────────

const createEnvelope = <T>(type: ExportEnvelopeType, data: T): ExportEnvelope<T> => ({
  type,
  version: '1',
  exportedAt: new Date().toISOString(),
  data,
})

const isEnvelope = (value: unknown): value is ExportEnvelope => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'version' in value &&
    'data' in value
  )
}

const isPlanningState = (value: unknown): value is PlanningState => {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<Record<keyof PlanningState, unknown>>
  return (
    Array.isArray(c.teams) &&
    Array.isArray(c.members) &&
    Array.isArray(c.sprints) &&
    Array.isArray(c.workItems) &&
    Array.isArray(c.epics) &&
    Array.isArray(c.allocationResults)
  )
}

const isTeamExportData = (value: unknown): value is TeamExportData => {
  if (!value || typeof value !== 'object') return false
  const c = value as Partial<Record<keyof TeamExportData, unknown>>
  return (
    typeof c.team === 'object' &&
    c.team !== null &&
    Array.isArray(c.members) &&
    Array.isArray(c.vacations)
  )
}

// ─── File download ─────────────────────────────────────────────────────────

const safeFileName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'export'

const downloadTextFile = (fileName: string, content: string) => {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

// ─── Import result ─────────────────────────────────────────────────────────

export interface ImportResult {
  success: boolean
  type?: ExportEnvelopeType
  message: string
  requiresConfirmation?: boolean
  destructive?: boolean
  conflictMessages?: string[]
}

export interface ImportDraft {
  type: ExportEnvelopeType
  data: PlanningState | TeamExportData
  message: string
  requiresConfirmation: boolean
  destructive: boolean
  conflictMessages: string[]
}

export interface ImportPreparationResult {
  success: boolean
  message: string
  draft?: ImportDraft
}

// ─── Composable ────────────────────────────────────────────────────────────

export const useDataExchange = () => {
  const planningStore = usePlanningStore()
  const status = ref('')

  const normalizeName = (value: string) => value.trim().toLocaleLowerCase()

  const currentSummary = () => {
    const parts = [
      `${planningStore.teams.length} команд`,
      `${planningStore.sprints.length} спринтов`,
      `${planningStore.workItems.length} задач`,
      `${planningStore.allocationResults.length} расчетов`,
    ]

    return parts.join(', ')
  }

  const findNameIntersections = (data: PlanningState) => {
    const currentTeamNames = new Set(planningStore.teams.map((team) => normalizeName(team.name)))
    const currentSprintNames = new Set(
      planningStore.sprints.map((sprint) => normalizeName(sprint.name)),
    )
    const teamNames = data.teams
      .map((team) => team.name)
      .filter((name) => currentTeamNames.has(normalizeName(name)))
    const sprintNames = data.sprints
      .map((sprint) => sprint.name)
      .filter((name) => currentSprintNames.has(normalizeName(name)))

    return {
      teamNames: [...new Set(teamNames)],
      sprintNames: [...new Set(sprintNames)],
    }
  }

  const analyzePlanningStateImport = (
    type: ExportEnvelopeType,
    data: PlanningState,
  ): Pick<ImportDraft, 'requiresConfirmation' | 'destructive' | 'conflictMessages'> => {
    const intersections = findNameIntersections(data)
    const conflictMessages: string[] = []
    const destructive = type === 'full' && planningStore.hasData

    if (destructive) {
      conflictMessages.push(
        `Полный импорт заменит текущую рабочую область: ${currentSummary()}.`,
      )
    }

    if (intersections.teamNames.length) {
      conflictMessages.push(
        `Совпадающие названия команд: ${intersections.teamNames.join(', ')}.`,
      )
    }

    if (intersections.sprintNames.length) {
      conflictMessages.push(
        `Совпадающие названия спринтов: ${intersections.sprintNames.join(', ')}.`,
      )
    }

    return {
      destructive,
      requiresConfirmation: destructive || conflictMessages.length > 0,
      conflictMessages,
    }
  }

  const analyzeTeamImport = (
    data: TeamExportData,
  ): Pick<ImportDraft, 'requiresConfirmation' | 'destructive' | 'conflictMessages'> => {
    const conflictMessages: string[] = []
    const hasTeamNameConflict = planningStore.teams.some(
      (team) => normalizeName(team.name) === normalizeName(data.team.name),
    )

    if (hasTeamNameConflict) {
      conflictMessages.push(
        `Команда с названием «${data.team.name}» уже есть. Импорт будет добавлен как копия.`,
      )
    }

    return {
      destructive: false,
      requiresConfirmation: conflictMessages.length > 0,
      conflictMessages,
    }
  }

  // ── Exports ──

  const exportFull = () => {
    const envelope = createEnvelope('full', planningStore.state)
    const encoded = encodeToBase64(envelope)
    const name = planningStore.teams[0]?.name ?? 'workspace'
    downloadTextFile(`team-planning-${safeFileName(name)}-full.tpdata`, encoded)
    status.value = 'Рабочая область экспортирована.'
  }

  const exportFullBackup = () => {
    exportFull()
    status.value = 'Резервная копия рабочей области скачана.'
  }

  const exportTeam = (teamId: string) => {
    const snapshot = planningStore.createTeamSnapshot(teamId)
    if (!snapshot) {
      status.value = 'Команда не найдена.'
      return
    }
    const envelope = createEnvelope('team', snapshot)
    const encoded = encodeToBase64(envelope)
    downloadTextFile(`team-planning-team-${safeFileName(snapshot.team.name)}.tpdata`, encoded)
    status.value = `Команда «${snapshot.team.name}» экспортирована.`
  }

  const exportSprint = (sprintId: string) => {
    const snapshot = planningStore.createSprintSnapshot(sprintId)
    if (!snapshot) {
      status.value = 'Спринт не найден.'
      return
    }
    const sprint = snapshot.sprints[0]!
    const envelope = createEnvelope('sprint', snapshot)
    const encoded = encodeToBase64(envelope)
    downloadTextFile(`team-planning-sprint-${safeFileName(sprint.name)}.tpdata`, encoded)
    status.value = `Спринт «${sprint.name}» экспортирован.`
  }

  const exportAllocationResult = (sprintId: string) => {
    const snapshot = planningStore.createSprintSnapshot(sprintId)
    if (!snapshot) {
      status.value = 'Спринт не найден.'
      return
    }
    if (!snapshot.allocationResults.length) {
      status.value = 'Результат планирования ещё не рассчитан.'
      return
    }
    const sprint = snapshot.sprints[0]!
    const envelope = createEnvelope('allocation', snapshot)
    const encoded = encodeToBase64(envelope)
    downloadTextFile(
      `team-planning-allocation-${safeFileName(sprint.name)}.tpdata`,
      encoded,
    )
    status.value = `Результат планирования для «${sprint.name}» экспортирован.`
    return encoded
  }

  const getAllocationShareableLink = (sprintId: string): string | undefined => {
    const snapshot = planningStore.createSprintSnapshot(sprintId)
    if (!snapshot || !snapshot.allocationResults.length) return undefined
    const envelope = createEnvelope('allocation', snapshot)
    const encoded = encodeToBase64(envelope)
    // Link opens the full report directly; App.vue processes the #import= hash on mount
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const url = new URL(`${window.location.origin}${base}/reports/allocation/${sprintId}`)
    url.hash = `import=${encodeURIComponent(encoded)}`
    return url.toString()
  }

  // ── Universal import ──

  const prepareImportFromText = (text: string): ImportPreparationResult => {
    try {
      const trimmed = text.trim()

      // Try base64 envelope first
      let parsed: unknown
      try {
        parsed = decodeFromBase64(trimmed)
      } catch {
        // Fallback: try plain JSON (legacy format)
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          return { success: false, message: 'Не удалось декодировать файл.' }
        }
      }

      // If it's an envelope
      if (isEnvelope(parsed)) {
        switch (parsed.type) {
          case 'full': {
            if (!isPlanningState(parsed.data)) {
              return { success: false, message: 'Данные не похожи на полный snapshot.' }
            }
            const analysis = analyzePlanningStateImport('full', parsed.data)
            return {
              success: true,
              message: 'Рабочая область готова к импорту.',
              draft: {
                type: 'full',
                data: parsed.data,
                message: 'Рабочая область импортирована.',
                ...analysis,
              },
            }
          }
          case 'team': {
            if (!isTeamExportData(parsed.data)) {
              return { success: false, message: 'Данные не похожи на snapshot команды.' }
            }
            const teamName = (parsed.data as TeamExportData).team.name
            const analysis = analyzeTeamImport(parsed.data)
            return {
              success: true,
              message: `Команда «${teamName}» готова к импорту.`,
              draft: {
                type: 'team',
                data: parsed.data,
                message: `Команда «${teamName}» импортирована.`,
                ...analysis,
              },
            }
          }
          case 'sprint':
          case 'allocation': {
            if (!isPlanningState(parsed.data)) {
              return { success: false, message: 'Данные не похожи на snapshot спринта.' }
            }
            const sprintName = (parsed.data as PlanningState).sprints[0]?.name ?? ''
            const analysis = analyzePlanningStateImport(parsed.type, parsed.data)
            return {
              success: true,
              message:
                parsed.type === 'allocation'
                  ? `Результат планирования для «${sprintName}» готов к импорту.`
                  : `Спринт «${sprintName}» готов к импорту.`,
              draft: {
                type: parsed.type,
                data: parsed.data,
                message:
                  parsed.type === 'allocation'
                    ? `Результат планирования для «${sprintName}» импортирован.`
                    : `Спринт «${sprintName}» импортирован.`,
                ...analysis,
              },
            }
          }
          default:
            return { success: false, message: `Неизвестный тип экспорта.` }
        }
      }

      // If it's a raw PlanningState (legacy JSON format)
      if (isPlanningState(parsed)) {
        const analysis = analyzePlanningStateImport('full', parsed)
        return {
          success: true,
          message: 'Legacy-рабочая область готова к импорту.',
          draft: {
            type: 'full',
            data: parsed,
            message: 'Рабочая область импортирована (legacy).',
            ...analysis,
          },
        }
      }

      return { success: false, message: 'Файл не похож на данные Team Planning.' }
    } catch {
      return { success: false, message: 'Ошибка при разборе файла.' }
    }
  }

  const applyImportDraft = (draft: ImportDraft): ImportResult => {
    if (draft.type === 'full') {
      if (!isPlanningState(draft.data)) {
        return { success: false, message: 'Данные не похожи на полный snapshot.' }
      }
      planningStore.importState(draft.data)
    } else if (draft.type === 'team') {
      if (!isTeamExportData(draft.data)) {
        return { success: false, message: 'Данные не похожи на snapshot команды.' }
      }
      planningStore.mergeTeamSnapshot(draft.data)
    } else {
      if (!isPlanningState(draft.data)) {
        return { success: false, message: 'Данные не похожи на snapshot спринта.' }
      }
      planningStore.mergeSprintSnapshot(draft.data)
    }

    return {
      success: true,
      type: draft.type,
      message: draft.message,
      destructive: draft.destructive,
      conflictMessages: draft.conflictMessages,
    }
  }

  const importFromText = (text: string): ImportResult => {
    const preparation = prepareImportFromText(text)

    if (!preparation.success || !preparation.draft) {
      return { success: false, message: preparation.message }
    }

    if (preparation.draft.requiresConfirmation) {
      return {
        success: false,
        type: preparation.draft.type,
        message: 'Импорт требует подтверждения.',
        requiresConfirmation: true,
        destructive: preparation.draft.destructive,
        conflictMessages: preparation.draft.conflictMessages,
      }
    }

    return applyImportDraft(preparation.draft)
  }

  const prepareImportFromFile = async (file: File): Promise<ImportPreparationResult> => {
    try {
      const text = await file.text()
      return prepareImportFromText(text)
    } catch {
      return { success: false, message: 'Не удалось прочитать файл.' }
    }
  }

  const importFromFile = async (file: File): Promise<ImportResult> => {
    try {
      const text = await file.text()
      return importFromText(text)
    } catch {
      return { success: false, message: 'Не удалось прочитать файл.' }
    }
  }

  // ── Link / decode helpers used by AllocationReportView ──

  /**
   * Decodes a base64-encoded shareable-link payload into a PlanningState WITHOUT
   * importing into the global store. Used by AllocationReportView to display
   * report data in isolation.
   */
  const decodeAllocationState = (encoded: string): PlanningState | undefined => {
    try {
      const raw = decodeFromBase64(encoded)
      if (isEnvelope(raw)) {
        if (isPlanningState(raw.data)) return raw.data as PlanningState
      }
      if (isPlanningState(raw)) return raw as PlanningState
    } catch {
      /* ignore malformed data */
    }
    return undefined
  }

  /**
   * Generates a shareable report link from an arbitrary PlanningState (e.g. one decoded
   * from a hash without touching the global store).
   */
  const createShareableLinkFromState = (
    sprintId: string,
    state: PlanningState,
  ): string | undefined => {
    const sprint = state.sprints.find((s) => s.id === sprintId)
    if (!sprint) return undefined

    const team = state.teams.find((t) => t.id === sprint.teamId)
    const members = state.members.filter((m) => m.teamId === sprint.teamId)
    const memberIdSet = new Set(members.map((m) => m.id))

    const snapshot: PlanningState = {
      teams: team ? [team] : [],
      members,
      sprints: [sprint],
      workItems: state.workItems.filter((wi) => wi.sprintId === sprintId),
      epics: state.epics.filter((e) => e.sprintId === sprintId),
      allocationResults: state.allocationResults.filter((r) => r.sprintId === sprintId),
      vacations: state.vacations.filter((v) => memberIdSet.has(v.memberId)),
    }

    if (!snapshot.allocationResults.length) return undefined

    const envelope = createEnvelope('allocation', snapshot)
    const encoded2 = encodeToBase64(envelope)
    const base = import.meta.env.BASE_URL.replace(/\/$/, '')
    const url = new URL(`${window.location.origin}${base}/reports/allocation/${sprintId}`)
    url.hash = `import=${encodeURIComponent(encoded2)}`
    return url.toString()
  }

  return {
    status,
    exportFull,
    exportFullBackup,
    exportTeam,
    exportSprint,
    exportAllocationResult,
    getAllocationShareableLink,
    decodeAllocationState,
    createShareableLinkFromState,
    prepareImportFromText,
    prepareImportFromFile,
    applyImportDraft,
    importFromText,
    importFromFile,
  }
}
