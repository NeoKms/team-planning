<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import AllocationTimeline from '@/components/AllocationTimeline.vue'
import {
  allocationCalculationNotes,
  stageToneByDirection,
  stageToneByType,
  stageLabels,
  useAllocationReport,
} from '@/composables/useAllocationReport'
import { useDataExchange } from '@/composables/useDataExchange'
import { useAnalytics } from '@/composables/useAnalytics'
import { useReviewPrompt } from '@/composables/useReviewPrompt'
import { usePlanningStore } from '@/stores/planning'
import { formatDuration, type PlanningState } from '@/domain/planning'

const props = defineProps<{
  sprintId: string
}>()

const planningStore = usePlanningStore()
const { getAllocationShareableLink, decodeAllocationState, createShareableLinkFromState, exportAllocationResult } =
  useDataExchange()
const { track } = useAnalytics()

const localState = ref<PlanningState | null>(null)

onMounted(() => {
  const hash = window.location.hash
  if (!hash.startsWith('#import=')) return
  try {
    const encoded = decodeURIComponent(hash.slice('#import='.length))
    const state = decodeAllocationState(encoded)
    if (state) localState.value = state
  } catch {
    /* ignore malformed hash */
  }
  history.replaceState(null, '', window.location.pathname + window.location.search)
})

const shareLinkCopied = ref(false)
const copyShareLink = async () => {
  const link = localState.value
    ? createShareableLinkFromState(props.sprintId, localState.value)
    : getAllocationShareableLink(props.sprintId)
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    shareLinkCopied.value = true
    track('report_link_copied')
    setTimeout(() => {
      shareLinkCopied.value = false
    }, 2000)
  } catch {
    /* clipboard not available */
  }
}

const goHome = () => {
  window.location.href = '/'
}
const selectedSprint = computed(() => {
  const sprints = localState.value?.sprints ?? planningStore.sprints
  return sprints.find((sprint) => sprint.id === props.sprintId)
})

const {
  allocationResult,
  selectedTeam,
  workItemById,
  sprintWorkingDateSet,
  displayDates,
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
  slotTitle,
  slotDirectionLabel,
  formatMinutes,
  formatDateLabel,
  severityClasses,
} = useAllocationReport(selectedSprint, localState)

type GanttTab = 'gantt' | 'details' | 'recommendations'
const activeTab = ref<GanttTab>('gantt')

/** True when the sprint data changed after the last calculation and this report is from own data (not shareable link). */
const isAllocationStale = computed(() => {
  if (localState.value) return false
  if (!selectedSprint.value) return false
  return planningStore.isSprintAllocationStale(props.sprintId)
})

// ── Bug report / feedback ──────────────────────────────────────────────────

const bugReportMailto = computed(() => {
  const sprint = selectedSprint.value
  const team = selectedTeam.value
  const calcDate = allocationResult.value
    ? new Date(allocationResult.value.generatedAt).toLocaleString('ru-RU')
    : ''
  const subject = encodeURIComponent(
    sprint ? `Ошибка в плане — ${sprint.name}` : 'Сообщение об ошибке — Team Planning',
  )
  const body = encodeURIComponent(
    'Опишите проблему или неоптимальный план:\n\n\n' +
      '——————————————\n' +
      (sprint ? `Спринт: ${sprint.name}\n` : '') +
      (team ? `Команда: ${team.name}\n` : '') +
      (calcDate ? `Расчёт от: ${calcDate}\n` : '') +
      '\nМожно приложить скриншоты или файл экспорта спринта (.tpdata) к этому письму.\n\n' +
      'Страница: ' +
      window.location.href,
  )
  return `mailto:upachko@gmail.com?subject=${subject}&body=${body}`
})

const exportSprintData = () => {
  exportAllocationResult(props.sprintId)
}

const { openForm: openReviewForm } = useReviewPrompt()

const ticketsByAssignee = computed(() => {
  const assigneeMap = new Map<
    string,
    {
      assigneeId: string
      assigneeName: string
      workItemGroups: {
        workItemId: string
        workItemTitle: string
        epicTitle: string | undefined
        tickets: typeof sprintTickets.value
      }[]
    }
  >()

  for (const ticket of sprintTickets.value) {
    if (!assigneeMap.has(ticket.assigneeId)) {
      assigneeMap.set(ticket.assigneeId, {
        assigneeId: ticket.assigneeId,
        assigneeName: ticket.assigneeName,
        workItemGroups: [],
      })
    }
    const assigneeGroup = assigneeMap.get(ticket.assigneeId)!
    let wiGroup = assigneeGroup.workItemGroups.find((g) => g.workItemId === ticket.workItemId)
    if (!wiGroup) {
      wiGroup = {
        workItemId: ticket.workItemId,
        workItemTitle: ticket.workItemTitle,
        epicTitle: ticket.epicTitle,
        tickets: [],
      }
      assigneeGroup.workItemGroups.push(wiGroup)
    }
    wiGroup.tickets.push(ticket)
  }
  return [...assigneeMap.values()]
})

const outcomeColors: Record<
  string,
  { border: string; bg: string; title: string; text: string; desc: string; dot: string }
> = {
  released: {
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
    title: 'text-emerald-900',
    text: 'text-emerald-800',
    desc: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  'fully-tested': {
    border: 'border-sky-200',
    bg: 'bg-sky-50',
    title: 'text-sky-900',
    text: 'text-sky-800',
    desc: 'text-sky-700',
    dot: 'bg-sky-500',
  },
  'dev-completed': {
    border: 'border-amber-200',
    bg: 'bg-amber-50',
    title: 'text-amber-900',
    text: 'text-amber-800',
    desc: 'text-amber-700',
    dot: 'bg-amber-500',
  },
  'in-progress': {
    border: 'border-slate-200',
    bg: 'bg-slate-50',
    title: 'text-slate-700',
    text: 'text-slate-700',
    desc: 'text-slate-500',
    dot: 'bg-slate-400',
  },
}
</script>

<template>
  <main class="min-h-screen bg-white px-5 py-6 text-slate-900 sm:px-8 lg:px-10">
    <section
      v-if="!selectedSprint"
      class="mx-auto max-w-3xl rounded-lg border border-dashed border-slate-300 p-8"
    >
      <p class="text-sm font-bold text-slate-500 uppercase">Отчет</p>
      <h1 class="mt-2 text-2xl font-bold text-slate-950">Спринт не найден</h1>
      <p class="mt-3 text-sm text-slate-600">
        Прямая ссылка указывает на спринт, которого нет. Если отчет был открыт по прямой ссылке с
        данными, то необходимо открыть её заново.
      </p>
      <div class="mt-5">
        <button
          type="button"
          class="primary-action inline-flex rounded-lg px-3 py-2 text-sm font-medium"
          @click="goHome"
        >
          На главную
        </button>
      </div>
    </section>

    <section
      v-else-if="!allocationResult"
      class="mx-auto max-w-3xl rounded-lg border border-dashed border-slate-300 p-8"
    >
      <p class="text-sm font-bold text-slate-500 uppercase">Отчет</p>
      <h1 class="mt-2 text-2xl font-bold text-slate-950">Расчет не найден</h1>
      <p class="mt-3 text-sm text-slate-600">
        Для этого спринта еще нет сохраненного результата распределения. Запустите расчет на рабочем
        экране распределения.
      </p>
      <RouterLink
        :to="{ name: 'sprint-allocation', params: { sprintId: selectedSprint.id } }"
        class="mt-5 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
      >
        К распределению
      </RouterLink>
    </section>

    <section v-else class="mx-auto min-w-0 max-w-400">
      <!-- Stale allocation banner (only for own data, not shareable links) -->
      <div
        v-if="isAllocationStale"
        class="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
      >
        <span class="shrink-0 text-amber-600">⚠️</span>
        <div class="min-w-0 text-sm">
          <p class="font-semibold text-amber-900">Расчёт устарел</p>
          <p class="mt-0.5 text-amber-800">
            Данные спринта изменились после последнего расчёта — этот отчёт может не отражать
            текущий план.
          </p>
        </div>
        <RouterLink
          :to="{ name: 'sprint-allocation', params: { sprintId: selectedSprint.id } }"
          class="ml-auto shrink-0 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
        >
          Пересчитать
        </RouterLink>
      </div>

      <!-- Header -->
      <header class="border-b border-slate-200 pb-5">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-sm font-bold text-slate-500 uppercase">Team planning report</p>
            <h1 class="mt-2 text-3xl font-bold text-slate-950">{{ selectedSprint.name }}</h1>
            <p class="mt-2 text-base text-slate-600">
              {{ selectedTeam?.name ?? 'Команда не найдена' }} · расчет от
              {{ new Date(allocationResult.generatedAt).toLocaleString('ru-RU') }}
            </p>
          </div>
          <div class="flex flex-col items-start gap-3 lg:items-end">
            <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt class="text-slate-500">В спринте</dt>
                <dd class="mt-1 font-semibold text-slate-950">
                  {{ formatMinutes(summary.totalMinutes) }}
                </dd>
              </div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt class="text-slate-500">После спринта</dt>
                <dd
                  class="mt-1 font-semibold"
                  :class="summary.overflowMinutes ? 'text-red-700' : 'text-slate-950'"
                >
                  {{ formatMinutes(summary.overflowMinutes) }}
                </dd>
              </div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt class="text-slate-500">Ошибки</dt>
                <dd
                  class="mt-1 font-semibold"
                  :class="summary.errorCount ? 'text-red-700' : 'text-slate-950'"
                >
                  {{ summary.errorCount }}
                </dd>
              </div>
              <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <dt class="text-slate-500">Риски</dt>
                <dd
                  class="mt-1 font-semibold"
                  :class="summary.warningCount ? 'text-amber-700' : 'text-slate-950'"
                >
                  {{ summary.warningCount }}
                </dd>
              </div>
            </dl>
            <div class="flex flex-wrap items-center gap-2">
              <RouterLink
                v-if="!localState"
                :to="{ name: 'sprint-allocation', params: { sprintId: selectedSprint.id } }"
                class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                ← Вернуться к распределению
              </RouterLink>
              <button
                type="button"
                class="rounded-lg border px-3 py-2 text-sm font-medium transition"
                :class="
                  shareLinkCopied
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                "
                @click="copyShareLink"
              >
                {{ shareLinkCopied ? '✓ Ссылка скопирована!' : 'Скопировать ссылку на отчёт' }}
              </button>
            </div>
          </div>
        </div>
      </header>

      <details class="mt-5 rounded-lg border border-sky-100 bg-sky-50/60 p-4">
        <summary class="cursor-pointer text-sm font-semibold text-sky-900">
          Как считается расчет?
        </summary>
        <ul class="mt-3 grid gap-2 text-sm text-sky-900">
          <li v-for="note in allocationCalculationNotes" :key="note" class="leading-6">
            {{ note }}
          </li>
        </ul>
      </details>

      <!-- Загрузка сотрудников -->
      <section class="mt-6 rounded-lg border border-slate-200 p-5">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-xl font-semibold text-slate-950">Загрузка сотрудников</h2>
            <p class="mt-1 text-sm text-slate-600">
              Учитывается работа в текущем спринте; целевой минимум — 80% capacity.
            </p>
          </div>
          <span
            class="w-fit rounded-md px-2.5 py-1 text-sm font-semibold"
            :class="
              summary.errorCount || summary.underloadedMemberCount
                ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
            "
          >
            {{
              summary.errorCount || summary.underloadedMemberCount
                ? 'Проверьте загрузку'
                : 'Загрузка от 80%'
            }}
          </span>
        </div>
        <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="row in memberRows"
            :key="row.member.id"
            class="rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate font-semibold text-slate-950">{{ row.member.name }}</h3>
                <p class="mt-1 text-sm text-slate-600">
                  {{ formatMinutes(row.assignedMinutes) }} из
                  {{ formatMinutes(row.capacityMinutes) }}
                </p>
              </div>
              <span
                class="shrink-0 rounded-md px-2 py-1 text-xs font-semibold"
                :class="
                  row.isUnderloaded ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-700'
                "
              >
                {{ row.loadPercent }}%
              </span>
            </div>
            <p
              class="mt-2 text-xs"
              :class="row.isUnderloaded ? 'text-amber-700' : 'text-slate-500'"
            >
              {{
                row.isUnderloaded
                  ? `До 80%: ${formatMinutes(row.targetLoadGapMinutes)}`
                  : `Резерв: ${formatMinutes(row.balanceMinutes)}`
              }}
            </p>
          </article>
        </div>
      </section>

      <!-- Timeline Gantt / Детализация по дням / Рекомендации — tabs -->
      <section class="mt-6 min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              class="rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              :class="
                activeTab === 'gantt'
                  ? 'bg-white text-teal-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              "
              @click="activeTab = 'gantt'"
            >
              Timeline Gantt
            </button>
            <button
              type="button"
              class="rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              :class="
                activeTab === 'details'
                  ? 'bg-white text-teal-700 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              "
              @click="activeTab = 'details'"
            >
              Детализация по дням
            </button>
            <button
              type="button"
              class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-all"
              :class="
                assignmentRecommendations.length
                  ? activeTab === 'recommendations'
                    ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-600'
                    : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100'
                  : activeTab === 'recommendations'
                    ? 'bg-white text-teal-700 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-white/60'
              "
              @click="activeTab = 'recommendations'"
            >
              Рекомендации
              <span
                v-if="assignmentRecommendations.length"
                class="rounded-full px-1.5 py-0.5 text-xs font-semibold"
                :class="
                  activeTab === 'recommendations'
                    ? 'bg-white/20 text-white'
                    : 'bg-emerald-100 text-emerald-700'
                "
              >
                {{ assignmentRecommendations.length }} замен
              </span>
              <span
                v-if="summary.errorCount + summary.warningCount + summary.infoCount > 0"
                class="rounded-full px-1.5 py-0.5 text-xs font-semibold"
                :class="
                  summary.errorCount
                    ? 'bg-red-100 text-red-700'
                    : summary.warningCount
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-sky-100 text-sky-700'
                "
              >
                {{ summary.errorCount + summary.warningCount + summary.infoCount }}
              </span>
            </button>
          </div>
          <div v-show="activeTab === 'gantt'" class="flex flex-wrap gap-x-4 gap-y-2">
            <div
              v-for="[label, cls] in [
                ['Backend', stageToneByDirection.backend],
                ['Frontend', stageToneByDirection.frontend],
                ['iOS', stageToneByDirection.ios],
                ['Android', stageToneByDirection.android],
                ['QA', stageToneByDirection.qa],
                ['Release', stageToneByType['release-support']],
                ['Design review', stageToneByType['design-review']],
              ]"
              :key="label"
              class="flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span class="inline-block h-2.5 w-2.5 shrink-0 rounded-full" :class="cls"></span>
              {{ label }}
            </div>
          </div>
        </div>

        <div
          v-if="activeTab === 'gantt'"
          class="mt-3 rounded-xl border border-slate-200 p-4"
        >
          <AllocationTimeline
            :display-dates="displayDates"
            :sprint-working-date-set="sprintWorkingDateSet"
            :timeline-rows="timelineRows"
            :vacation-dates-by-member-id="vacationDatesByMemberId"
            :format-date-label="formatDateLabel"
            :format-minutes="formatMinutes"
            :nav-items="navItems"
          />
        </div>

        <div v-else-if="activeTab === 'details'" class="mt-3 rounded-xl border border-slate-200 p-4">
          <div class="max-h-[72vh] overflow-auto pb-2 pr-1">
            <div
              class="min-w-245"
              :style="{ width: `${Math.max(980, displayDates.length * 160 + 190)}px` }"
            >
              <div class="grid grid-cols-[190px_minmax(0,1fr)] gap-2">
                <div
                  class="sticky top-0 left-0 z-40 rounded-lg bg-slate-100 p-3 text-xs font-semibold text-slate-500 uppercase shadow-sm"
                >
                  Участник
                </div>
                <div
                  class="sticky top-0 z-20 grid gap-2"
                  :style="{
                    gridTemplateColumns: `repeat(${displayDates.length}, minmax(150px, 1fr))`,
                  }"
                >
                  <div
                    v-for="date in displayDates"
                    :key="date"
                    class="rounded-lg p-3 text-sm font-semibold shadow-sm"
                    :class="
                      sprintWorkingDateSet.has(date)
                        ? 'bg-slate-100 text-slate-700'
                        : 'bg-red-50 text-red-700 ring-1 ring-red-200'
                    "
                  >
                    {{ formatDateLabel(date) }}
                  </div>
                </div>

                <template v-for="row in scheduleRows" :key="row.member.id">
                  <div
                    class="sticky left-0 z-30 rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-[8px_0_16px_-16px_rgba(15,23,42,0.45)]"
                  >
                    <p class="font-semibold text-slate-950">{{ row.member.name }}</p>
                    <p class="mt-1 text-xs text-slate-500">
                      <template v-if="row.isExternal">Внешняя зависимость</template>
                      <template v-else>
                        {{ formatMinutes(row.member.availableMinutesPerDay) }}/день
                      </template>
                    </p>
                  </div>
                  <div
                    class="grid gap-2"
                    :style="{
                      gridTemplateColumns: `repeat(${displayDates.length}, minmax(150px, 1fr))`,
                    }"
                  >
                    <div
                      v-for="date in displayDates"
                      :key="`${row.member.id}-${date}`"
                      class="min-h-28 rounded-lg border p-2"
                      :class="
                        sprintWorkingDateSet.has(date)
                          ? 'border-slate-200 bg-white'
                          : 'border-red-200 bg-red-50'
                      "
                    >
                      <div
                        v-if="vacationDatesByMemberId.get(row.member.id)?.has(date)"
                        class="mb-2 rounded-md border border-slate-200 bg-slate-100 p-2 text-xs text-slate-500"
                      >
                        <p class="font-semibold text-slate-600">Отпуск</p>
                      </div>
                      <div v-if="getSlots(row.member.id, date).length" class="grid gap-2">
                        <article
                          v-for="slot in getSlots(row.member.id, date)"
                          :key="slot.id"
                          class="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"
                        >
                          <p class="font-semibold text-slate-950">{{ slotTitle(slot) }}</p>
                          <p class="mt-1 text-slate-600">
                            {{ slotDirectionLabel(slot) }} · {{ formatMinutes(slot.minutes) }}
                          </p>
                        </article>
                      </div>
                      <p
                        v-else-if="!vacationDatesByMemberId.get(row.member.id)?.has(date)"
                        class="text-xs text-slate-400"
                      >
                        Свободно
                      </p>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- Рекомендации — 3й таб -->
        <div v-else class="mt-3 rounded-xl border border-slate-200 p-5">
          <div v-if="!warningGroups.length && !assignmentRecommendations.length" class="flex items-center gap-3 py-2">
            <span
              class="rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200"
            >
              Замечаний нет
            </span>
            <p class="text-sm text-slate-600">
              Расчёт прошёл без ошибок и предупреждений.
            </p>
          </div>
          <div v-else>
            <div class="mb-4 flex flex-wrap gap-2">
              <span
                v-if="assignmentRecommendations.length"
                class="rounded-md bg-emerald-50 px-2.5 py-1 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200"
              >
                {{ assignmentRecommendations.length }} замен
              </span>
              <span
                v-if="summary.errorCount"
                class="rounded-md bg-red-50 px-2.5 py-1 text-sm font-semibold text-red-700 ring-1 ring-red-200"
              >
                {{ summary.errorCount }} ошиб.
              </span>
              <span
                v-if="summary.warningCount"
                class="rounded-md bg-amber-50 px-2.5 py-1 text-sm font-semibold text-amber-700 ring-1 ring-amber-200"
              >
                {{ summary.warningCount }} рисков
              </span>
              <span
                v-if="summary.infoCount"
                class="rounded-md bg-sky-50 px-2.5 py-1 text-sm font-semibold text-sky-700 ring-1 ring-sky-200"
              >
                {{ summary.infoCount }} инфо
              </span>
            </div>

            <section v-if="assignmentRecommendations.length" class="mb-5">
              <h3 class="text-base font-semibold text-slate-950">Рекомендации по исполнителям</h3>
              <div class="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                <article
                  v-for="recommendation in assignmentRecommendations"
                  :key="recommendation.id"
                  class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <p class="font-semibold">{{ recommendation.stageLabel }}</p>
                      <p class="mt-1 text-emerald-800">{{ recommendation.workItemTitle }}</p>
                    </div>
                    <span class="shrink-0 rounded-md bg-white/70 px-2 py-0.5 text-xs font-semibold">
                      {{ formatDuration(recommendation.estimatedGainMinutes) }}
                    </span>
                  </div>
                  <p class="mt-3">
                    {{ recommendation.fromAssigneeName }} → {{ recommendation.toAssigneeName }}
                  </p>
                  <p class="mt-2 text-emerald-800">{{ recommendation.impact }}</p>
                </article>
              </div>
            </section>

            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <article
                v-for="group in warningGroups"
                :key="group.severity"
                class="rounded-lg border p-4"
                :class="severityClasses[group.severity]"
              >
                <div class="mb-3 flex items-center justify-between gap-2">
                  <h3 class="font-semibold">{{ group.title }}</h3>
                  <span class="rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold">
                    {{ group.items.length }}
                  </span>
                </div>
                <div class="grid gap-2">
                  <div
                    v-for="warning in group.items"
                    :key="warning.id"
                    class="rounded-md border border-current/10 bg-white/50 p-2.5 text-sm"
                  >
                    <p>{{ warning.message }}</p>
                    <p v-if="warning.workItemId" class="mt-1 text-xs opacity-70">
                      {{ workItemById[warning.workItemId]?.title ?? 'Задача удалена' }}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      </section>

      <!-- Прогноз по задачам спринта -->
      <section v-if="workItemOutcomes.length" class="mt-6 rounded-lg border border-slate-200 p-5">
        <h2 class="text-xl font-semibold text-slate-950">Прогноз по задачам спринта</h2>
        <p class="mt-1 text-sm text-slate-600">
          На основе расчёта — какой результат по каждой задаче можно ожидать к концу спринта.
          Используйте для определения целей спринта.
        </p>
        <div class="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div
            v-for="group in workItemOutcomes"
            :key="group.outcome"
            class="rounded-lg border p-4"
            :class="[outcomeColors[group.outcome]?.border, outcomeColors[group.outcome]?.bg]"
          >
            <h3 class="font-semibold" :class="outcomeColors[group.outcome]?.title">
              {{ group.label }}
            </h3>
            <p class="mt-1 text-xs" :class="outcomeColors[group.outcome]?.desc">
              {{ group.description }}
            </p>
            <ul class="mt-3 grid gap-1.5">
              <li
                v-for="item in group.items"
                :key="item.workItemId"
                class="flex items-start gap-2 text-sm"
                :class="outcomeColors[group.outcome]?.text"
              >
                <span
                  class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="outcomeColors[group.outcome]?.dot"
                ></span>
                <span>
                  <span class="font-medium">{{ item.workItemTitle }}</span>
                  <span v-if="item.epicTitle" class="ml-1 opacity-60">· {{ item.epicTitle }}</span>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Задачи для заведения в трекер -->
      <section
        v-if="ticketsByAssignee.length"
        class="mt-6 rounded-lg border border-slate-200 p-5"
      >
        <h2 class="text-xl font-semibold text-slate-950">Задачи для заведения в трекер</h2>
        <p class="mt-1 text-sm text-slate-600">
          Только работа в рамках текущего спринта. Одна задача — максимум 1 рабочий день (6 ч).
          Задачи QA (тест-кейсы и тестирование) не делятся — одна задача на всю оценку.
        </p>
        <div class="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div
            v-for="assigneeGroup in ticketsByAssignee"
            :key="assigneeGroup.assigneeId"
            class="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <h3 class="font-semibold text-slate-950">{{ assigneeGroup.assigneeName }}</h3>
            <div class="mt-3 grid gap-4">
              <div v-for="wiGroup in assigneeGroup.workItemGroups" :key="wiGroup.workItemId">
                <p class="text-xs font-semibold tracking-wide text-slate-500 uppercase">
                  {{ wiGroup.workItemTitle
                  }}<span v-if="wiGroup.epicTitle" class="font-normal normal-case">
                    · {{ wiGroup.epicTitle }}</span
                  >
                </p>
                <div class="mt-1.5 grid gap-1.5">
                  <div
                    v-for="ticket in wiGroup.tickets"
                    :key="ticket.stageId"
                    class="flex items-start justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                  >
                    <div>
                      <p class="text-sm font-medium text-slate-900">
                        {{ stageLabels[ticket.stageType] }}
                      </p>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span
                          v-for="(task, idx) in ticket.tasks"
                          :key="idx"
                          class="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                        >
                          {{ formatDuration(task.estimateMinutes) }}
                        </span>
                      </div>
                    </div>
                    <span
                      v-if="ticket.tasks.length > 1"
                      class="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600"
                    >
                      {{ ticket.tasks.length }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Сообщить об ошибке -->
      <div class="mt-8 border-t border-slate-100 pt-5 pb-2">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-slate-700">Нашли ошибку или неоптимальный план?</p>
            <p class="mt-0.5 text-xs text-slate-500">
              Опишите ситуацию и при необходимости приложите скриншоты или экспорт спринта.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              @click="openReviewForm"
            >
              Оставить отзыв
            </button>
            <button
              v-if="!localState"
              type="button"
              class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              @click="exportSprintData"
            >
              Скачать экспорт спринта
            </button>
            <a
              :href="bugReportMailto"
              class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              ✉️ Сообщить об ошибке
            </a>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>
