<script setup lang="ts">
import { computed } from 'vue'

import {
  NON_RELEASE_DAYS,
  WORKING_DAYS,
  WORK_DAY_MINUTES,
  formatDate,
  formatDuration,
  type Sprint,
} from '@/domain/planning'
import { usePlanningStore } from '@/stores/planning'

const weekdayLabels: Record<string, string> = {
  monday: 'Пн',
  tuesday: 'Вт',
  wednesday: 'Ср',
  thursday: 'Чт',
  friday: 'Пт',
}
const formatWeekdays = (days: readonly string[]) =>
  days.map((d) => weekdayLabels[d] ?? d).join(', ')

const planningStore = usePlanningStore()

// --- Helpers for sprint date calculations ---
const MS_PER_DAY = 24 * 60 * 60 * 1000
const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}
const formatIsoDate = (ts: number) => new Date(ts).toISOString().slice(0, 10)
const sprintEndDate = (sprint: Sprint) =>
  formatIsoDate(parseIsoDate(sprint.startsOn) + sprint.durationWeeks * 7 * MS_PER_DAY - MS_PER_DAY)

const todayStr = new Date().toISOString().slice(0, 10)

// --- Active / upcoming sprints with team context ---
interface SprintCard {
  sprint: Sprint
  teamName: string
  memberCount: number
  workItemCount: number
  isActive: boolean
  endDate: string
}

const activeSprintsWithTeam = computed<SprintCard[]>(() => {
  const all = planningStore.sprints.map((sprint) => {
    const end = sprintEndDate(sprint)
    const isActive = sprint.startsOn <= todayStr && end >= todayStr
    return {
      sprint,
      teamName: planningStore.teams.find((t) => t.id === sprint.teamId)?.name ?? 'Команда удалена',
      memberCount: planningStore.members.filter((m) => m.teamId === sprint.teamId).length,
      workItemCount: planningStore.workItems.filter((w) => w.sprintId === sprint.id).length,
      isActive,
      endDate: end,
    }
  })

  const active = all.filter((c) => c.isActive)
  const upcoming = all.filter((c) => c.sprint.startsOn > todayStr).slice(0, 4)

  // Показываем активные + ближайшие будущие вместе
  const combined = [...active, ...upcoming]
  if (combined.length > 0) return combined

  // Если ни активных, ни будущих — последние прошедшие
  return all.slice(-4).reverse()
})

const quickLinks = computed(() => [
  {
    label: 'Команды',
    description: 'Составы и доступность участников',
    routeName: 'teams',
    routeParams: undefined,
    metric: planningStore.teams.length,
    cardClass:
      'border-sky-200 bg-gradient-to-br from-sky-50 to-white hover:border-sky-300 hover:shadow-sky-100/80',
    metricClass: 'bg-white text-sky-800 ring-1 ring-sky-200 shadow-sm',
  },
  {
    label: 'Спринты',
    description: 'Контейнеры планирования на 1 или 2 недели',
    routeName: 'sprints',
    routeParams: undefined,
    metric: planningStore.sprints.length,
    cardClass:
      'border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 hover:border-teal-300 hover:shadow-teal-100/80',
    metricClass: 'bg-white text-teal-800 ring-1 ring-teal-200 shadow-sm',
  },
])
</script>

<template>
  <main
    class="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12"
  >
    <section class="min-w-0">
      <div class="border-b border-teal-100 pb-6">
        <p class="text-sm font-bold text-teal-700 uppercase">Рабочая область</p>
        <h1 class="mt-2 text-3xl font-bold leading-tight text-slate-950">Планирование спринтов</h1>
        <p class="mt-3 max-w-2xl text-base text-slate-600">
          Создавайте команды, добавляйте спринты с задачами и запускайте расчет нагрузки с Gantt по
          каждому участнику.
        </p>
      </div>

      <!-- Быстрый доступ -->
      <div class="mt-6 grid gap-3 sm:grid-cols-2">
        <RouterLink
          v-for="link in quickLinks"
          :key="link.label"
          :to="{ name: link.routeName, params: link.routeParams }"
          class="accent-strip rounded-lg border p-4 pl-5 shadow-sm transition hover:shadow-md"
          :class="link.cardClass"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-slate-950">{{ link.label }}</h2>
              <p class="mt-1 text-sm text-slate-600">{{ link.description }}</p>
            </div>
            <span
              class="shrink-0 rounded-md px-2.5 py-1 text-sm font-semibold"
              :class="link.metricClass"
            >
              {{ link.metric }}
            </span>
          </div>
        </RouterLink>
      </div>

      <!-- Актуальные спринты -->
      <section class="mt-8">
        <h2 class="text-base font-semibold text-slate-950">
          {{
            activeSprintsWithTeam.some((c) => c.isActive)
              ? activeSprintsWithTeam.some((c) => !c.isActive)
                ? 'Активные и ближайшие спринты'
                : 'Активные спринты'
              : 'Ближайшие спринты'
          }}
        </h2>

        <div v-if="activeSprintsWithTeam.length" class="mt-3 grid gap-3 sm:grid-cols-2">
          <RouterLink
            v-for="card in activeSprintsWithTeam"
            :key="card.sprint.id"
            :to="{ name: 'sprint-planning', params: { sprintId: card.sprint.id } }"
            class="accent-strip surface-card rounded-lg border p-4 pl-5 transition hover:shadow-md"
            :class="card.isActive ? 'border-sky-200' : 'border-slate-200'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span
                    v-if="card.isActive"
                    class="inline-block h-2 w-2 shrink-0 rounded-full bg-teal-500 shadow-sm shadow-teal-500/40"
                  ></span>
                  <p class="truncate font-semibold text-slate-950">{{ card.sprint.name }}</p>
                </div>
                <p class="mt-1 truncate text-sm text-slate-600">{{ card.teamName }}</p>
              </div>
              <span
                class="shrink-0 rounded-md px-2 py-1 text-xs font-semibold"
                :class="
                  card.isActive
                    ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200'
                    : 'bg-slate-100 text-slate-600'
                "
              >
                {{ card.isActive ? 'Активен' : 'Скоро' }}
              </span>
            </div>
            <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt class="text-slate-400">Участников</dt>
                <dd class="mt-0.5 font-semibold text-slate-700">{{ card.memberCount }}</dd>
              </div>
              <div>
                <dt class="text-slate-400">Задач</dt>
                <dd class="mt-0.5 font-semibold text-slate-700">{{ card.workItemCount }}</dd>
              </div>
              <div>
                <dt class="text-slate-400">До</dt>
                <dd class="mt-0.5 font-semibold text-slate-700">
                  {{ formatDate(card.endDate) }}
                </dd>
              </div>
            </dl>
          </RouterLink>
        </div>

        <p v-else class="mt-3 text-sm text-slate-500">
          Спринты пока не созданы.
          <RouterLink :to="{ name: 'sprints' }" class="text-slate-950 underline">
            Создать спринт
          </RouterLink>
        </p>
      </section>
    </section>

    <aside class="grid gap-4 lg:content-start">
      <!-- Статистика по командам -->
      <section class="surface-card rounded-lg border p-5">
        <h2 class="text-base font-semibold text-slate-950">Команды</h2>
        <div v-if="planningStore.teams.length" class="mt-4 grid gap-3">
          <RouterLink
            v-for="team in planningStore.teams"
            :key="team.id"
            :to="{ name: 'teams' }"
            class="flex items-center justify-between gap-3 rounded-lg border border-teal-100 bg-teal-50/50 px-3 py-2.5 text-sm transition hover:border-teal-200 hover:bg-teal-50"
          >
            <span class="truncate font-medium text-slate-950">{{ team.name }}</span>
            <span class="shrink-0 text-slate-500">
              {{ planningStore.members.filter((m) => m.teamId === team.id).length }}
              уч.
            </span>
          </RouterLink>
        </div>
        <p v-else class="mt-4 text-sm text-slate-600">
          Команд пока нет.
          <RouterLink :to="{ name: 'teams' }" class="text-slate-950 underline">
            Добавить команду
          </RouterLink>
        </p>
      </section>

      <section class="surface-card rounded-lg border p-5">
        <h2 class="text-base font-semibold text-slate-950">Ограничения расчета</h2>
        <dl class="mt-4 grid gap-3 text-sm">
          <div>
            <dt class="text-slate-500">Рабочий день</dt>
            <dd class="mt-1 font-medium text-slate-950">{{ formatDuration(WORK_DAY_MINUTES) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Рабочие дни</dt>
            <dd class="mt-1 font-medium text-slate-950">{{ formatWeekdays(WORKING_DAYS) }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Нерелизные дни</dt>
            <dd class="mt-1 font-medium text-slate-950">{{ formatWeekdays(NON_RELEASE_DAYS) }}</dd>
          </div>
        </dl>
      </section>
    </aside>
  </main>
</template>
