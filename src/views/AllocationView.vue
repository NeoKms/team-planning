<script setup lang="ts">
import { computed } from 'vue'

import AllocationTimeline from '@/components/AllocationTimeline.vue'
import {
  allocationCalculationNotes,
  stageToneByDirection,
  stageToneByType,
  useAllocationReport,
} from '@/composables/useAllocationReport'
import { useDataExchange } from '@/composables/useDataExchange'
import { usePlanningStore } from '@/stores/planning'

const props = defineProps<{
  sprintId?: string
}>()

const planningStore = usePlanningStore()
const { exportAllocationResult } = useDataExchange()

const selectedSprint = computed(() => {
  if (props.sprintId) {
    return planningStore.sprints.find((sprint) => sprint.id === props.sprintId)
  }

  return undefined
})

const {
  allocationResult,
  selectedTeam,
  sprintWorkingDateSet,
  displayDates,
  memberRows,
  summary,
  timelineRows,
  vacationDatesByMemberId,
  navItems,
  formatMinutes,
  formatDateLabel,
} = useAllocationReport(selectedSprint)

const calculateAllocation = () => {
  if (!selectedSprint.value) {
    return
  }

  planningStore.calculateAllocationForSprint(selectedSprint.value.id)
}

const isAllocationStale = computed(() => {
  if (!selectedSprint.value) return false
  return planningStore.isSprintAllocationStale(selectedSprint.value.id)
})
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
    <header
      class="flex flex-col gap-4 border-b border-teal-100 pb-6 lg:flex-row lg:items-end lg:justify-between"
    >
      <div>
        <p class="text-sm font-bold text-teal-700 uppercase">Распределение</p>
        <h1 class="mt-2 text-3xl font-bold text-slate-950">Расчет нагрузки</h1>
        <p class="mt-3 max-w-2xl text-base text-slate-600">
          Gantt по участникам, дневная детализация, прогноз overflow и контроль загрузки от 80%.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <RouterLink
          v-if="selectedSprint"
          :to="{ name: 'sprint-planning', params: { sprintId: selectedSprint.id } }"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
        >
          План спринта
        </RouterLink>
        <button
          v-if="selectedSprint"
          type="button"
          class="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800 transition hover:bg-teal-100"
          @click="calculateAllocation"
        >
          Пересчитать
        </button>
        <button
          v-if="selectedSprint && allocationResult"
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          @click="exportAllocationResult(selectedSprint!.id)"
        >
          Экспорт результата
        </button>
      </div>
    </header>

    <div
      v-if="isAllocationStale"
      class="mx-auto mt-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
    >
      <span class="shrink-0 text-amber-600">⚠️</span>
      <div class="min-w-0 text-sm">
        <p class="font-semibold text-amber-900">Расчёт устарел</p>
        <p class="mt-0.5 text-amber-800">
          Данные спринта изменились после последнего расчёта — результат может не соответствовать
          текущему плану. Нажмите «Пересчитать», чтобы получить актуальный результат.
        </p>
      </div>
      <button
        v-if="selectedSprint"
        type="button"
        class="ml-auto shrink-0 rounded-lg border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
        @click="calculateAllocation"
      >
        Пересчитать
      </button>
    </div>

    <section class="mt-6 grid gap-4">
      <!-- Full report CTA — shown only when a result exists -->
      <RouterLink
        v-if="selectedSprint && allocationResult"
        :to="{ name: 'allocation-report', params: { sprintId: selectedSprint.id } }"
        class="flex items-center justify-between gap-4 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-600 to-sky-600 px-5 py-4 shadow-md shadow-teal-600/20 transition hover:from-teal-500 hover:to-sky-500"
      >
        <div>
          <p class="text-sm font-semibold text-teal-100">Готово к просмотру</p>
          <p class="mt-0.5 text-lg font-bold text-white">Открыть полный отчет →</p>
        </div>
        <div class="shrink-0 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm">
          Gantt · Детали · Рекомендации
        </div>
      </RouterLink>

      <section class="surface-card rounded-lg border p-4">
          <div>
            <h2 class="text-base font-semibold text-slate-950">Контекст расчета</h2>
            <dl v-if="selectedSprint" class="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <dt class="text-slate-500">Спринт</dt>
                <dd class="mt-1 font-medium text-slate-950">{{ selectedSprint.name }}</dd>
              </div>
              <div>
                <dt class="text-slate-500">Команда</dt>
                <dd class="mt-1 font-medium text-slate-950">
                  {{ selectedTeam?.name ?? 'Не найдена' }}
                </dd>
              </div>
              <div>
                <dt class="text-slate-500">Результаты</dt>
                <dd class="mt-1 font-medium text-slate-950">
                  {{ allocationResult ? 'Есть сохраненный расчет' : 'Расчет еще не запускался' }}
                </dd>
              </div>
              <div v-if="allocationResult">
                <dt class="text-slate-500">Сформирован</dt>
                <dd class="mt-1 font-medium text-slate-950">
                  {{ new Date(allocationResult.generatedAt).toLocaleString('ru-RU') }}
                </dd>
              </div>
            </dl>
            <p v-else class="mt-4 text-sm text-slate-600">Спринт для расчета пока не выбран.</p>
          </div>

        <dl
          v-if="allocationResult"
          class="mt-4 grid gap-2 border-t border-slate-100 pt-4 text-sm sm:grid-cols-4"
        >
          <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <dt class="text-slate-500">В спринте</dt>
            <dd class="font-semibold text-slate-950">
              {{ formatMinutes(summary.totalMinutes) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <dt class="text-slate-500">После спринта</dt>
            <dd
              class="font-semibold"
              :class="summary.overflowMinutes ? 'text-red-700' : 'text-slate-950'"
            >
              {{ formatMinutes(summary.overflowMinutes) }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <dt class="text-slate-500">Ошибки</dt>
            <dd
              class="font-semibold"
              :class="summary.errorCount ? 'text-red-700' : 'text-slate-950'"
            >
              {{ summary.errorCount }}
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
            <dt class="text-slate-500">Риски</dt>
            <dd
              class="font-semibold"
              :class="summary.warningCount ? 'text-amber-700' : 'text-slate-950'"
            >
              {{ summary.warningCount }}
            </dd>
          </div>
        </dl>

        <details class="mt-4 rounded-lg border border-sky-100 bg-sky-50/60 p-3">
          <summary class="cursor-pointer text-sm font-semibold text-sky-900">
            Как считается расчет?
          </summary>
          <ul class="mt-3 grid gap-2 text-sm text-sky-900 md:grid-cols-2">
            <li v-for="note in allocationCalculationNotes" :key="note" class="leading-6">
              {{ note }}
            </li>
          </ul>
        </details>
      </section>

      <section
        v-if="!selectedSprint"
        class="rounded-lg border border-dashed border-slate-300 bg-white p-8"
      >
        <h2 class="text-lg font-semibold text-slate-950">Спринт не выбран</h2>
        <p class="mt-2 text-sm text-slate-600">
          Откройте распределение из списка спринтов или выберите существующий спринт.
        </p>
        <RouterLink
          :to="{ name: 'sprints' }"
          class="primary-action mt-5 inline-flex rounded-lg px-3 py-2 text-sm font-medium transition"
        >
          К спринтам
        </RouterLink>
      </section>

      <section
        v-else-if="!allocationResult"
        class="rounded-lg border border-dashed border-slate-300 bg-white p-8"
      >
        <h2 class="text-lg font-semibold text-slate-950">Расчет еще не запускался</h2>
        <p class="mt-2 max-w-2xl text-sm text-slate-600">
          Запустите распределение, чтобы увидеть дневную загрузку участников, прогноз overflow и
          предупреждения по загрузке ниже 80%.
        </p>
        <button
          type="button"
          class="primary-action mt-5 rounded-lg px-3 py-2 text-sm font-medium transition"
          @click="calculateAllocation"
        >
          Распределить нагрузку
        </button>
      </section>

      <section v-else class="grid min-w-0 gap-4">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-slate-950">Загрузка сотрудников</h2>
              <p class="mt-1 text-sm text-slate-600">
                Сравнивает работу в текущем спринте с доступностью и подсвечивает загрузку ниже 80%.
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

          <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="row in memberRows"
              :key="row.member.id"
              class="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="font-semibold text-slate-950">{{ row.member.name }}</h3>
                  <p class="mt-1 text-sm text-slate-600">
                    {{ formatMinutes(row.member.availableMinutesPerDay) }} в день
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
              <div class="mt-4 h-2 overflow-hidden rounded-full bg-white">
                <div
                  class="h-full rounded-full bg-slate-950"
                  :style="{ width: `${Math.min(row.loadPercent, 100)}%` }"
                ></div>
              </div>
              <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt class="text-slate-500">Назначено</dt>
                  <dd class="font-semibold text-slate-950">
                    {{ formatMinutes(row.assignedMinutes) }}
                  </dd>
                </div>
                <div>
                  <dt class="text-slate-500">
                    {{ row.isUnderloaded ? 'До 80%' : 'Резерв' }}
                  </dt>
                  <dd
                    class="font-semibold"
                    :class="row.isUnderloaded ? 'text-amber-700' : 'text-slate-950'"
                  >
                    {{
                      formatMinutes(
                        row.isUnderloaded ? row.targetLoadGapMinutes : row.balanceMinutes,
                      )
                    }}
                  </dd>
                </div>
              </dl>
            </article>
          </div>
        </section>

        <section class="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h2 class="text-lg font-semibold text-slate-950">Timeline Gantt</h2>
              <p class="mt-1 text-sm text-slate-600">
                Горизонтальные бары показывают порядок этапов внутри рабочих дней и прогноз после
                спринта.
              </p>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2">
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

          <AllocationTimeline
            class="mt-4"
            :display-dates="displayDates"
            :sprint-working-date-set="sprintWorkingDateSet"
            :timeline-rows="timelineRows"
            :vacation-dates-by-member-id="vacationDatesByMemberId"
            :format-date-label="formatDateLabel"
            :format-minutes="formatMinutes"
            :initial-show-labels="false"
            :show-mode-toggle="false"
            :nav-items="navItems"
          />
        </section>
      </section>
    </section>
  </main>
</template>
