<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import AppModal from '@/components/AppModal.vue'
import {
  SPRINT_DURATIONS_WEEKS,
  formatDate,
  type Sprint,
  type SprintDurationWeeks,
} from '@/domain/planning'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useDataExchange } from '@/composables/useDataExchange'
import { useAnalytics } from '@/composables/useAnalytics'
import { usePlanningStore } from '@/stores/planning'

const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()
const { status: exchangeStatus, exportSprint } = useDataExchange()
const { track } = useAnalytics()

// --- Date utilities ---
const MS_PER_DAY = 24 * 60 * 60 * 1000
const parseIsoDate = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}
const sprintEndDate = (sprint: Sprint) =>
  new Date(parseIsoDate(sprint.startsOn) + sprint.durationWeeks * 7 * MS_PER_DAY - MS_PER_DAY)
    .toISOString()
    .slice(0, 10)

type SprintStatus = 'active' | 'upcoming' | 'past'
const todayStr = new Date().toISOString().slice(0, 10)

const getSprintStatus = (sprint: Sprint): SprintStatus => {
  const end = sprintEndDate(sprint)
  if (end < todayStr) return 'past'
  if (sprint.startsOn > todayStr) return 'upcoming'
  return 'active'
}

// --- Form types ---
interface SprintForm {
  teamId: string
  name: string
  startsOn: string
  durationWeeks: SprintDurationWeeks
}

const defaultTeamId = computed(() => planningStore.teams[0]?.id ?? '')

const createSprintForm = (teamId = defaultTeamId.value): SprintForm => ({
  teamId,
  name: '',
  startsOn: todayStr,
  durationWeeks: 2,
})

const newSprintForm = reactive<SprintForm>(createSprintForm())
const editingSprintId = ref<string | null>(null)
const editingSprintForm = reactive<SprintForm>(createSprintForm())
const showArchive = ref(false)
const showNewSprintForm = ref(false)
const cloningSourceSprintId = ref<string | null>(null)
const cloneSprintForm = reactive<SprintForm>(createSprintForm())

const durationOptions = SPRINT_DURATIONS_WEEKS.map((durationWeeks) => ({
  value: durationWeeks,
  label: `${durationWeeks} нед.`,
}))

const teamNameById = computed(() =>
  Object.fromEntries(planningStore.teams.map((team) => [team.id, team.name])),
)

const sprintsWithSummary = computed(() =>
  planningStore.sprints.map((sprint) => {
    const workItems = planningStore.workItems.filter((wi) => wi.sprintId === sprint.id)
    const epics = planningStore.epics.filter((e) => e.sprintId === sprint.id)
    return {
      ...sprint,
      teamName: teamNameById.value[sprint.teamId] ?? 'Команда не найдена',
      workItemCount: workItems.length,
      releaseWorkItemCount: workItems.filter((wi) => wi.requiresReleaseSupport).length,
      epicCount: epics.length,
      status: getSprintStatus(sprint),
      endDate: sprintEndDate(sprint),
    }
  }),
)

const activeSprints = computed(() => sprintsWithSummary.value.filter((s) => s.status !== 'past'))
const archivedSprints = computed(() =>
  sprintsWithSummary.value.filter((s) => s.status === 'past').reverse(),
)

watch(
  () => planningStore.teams.map((team) => team.id),
  (teamIds) => {
    if (!teamIds.includes(newSprintForm.teamId)) newSprintForm.teamId = teamIds[0] ?? ''
    if (editingSprintForm.teamId && !teamIds.includes(editingSprintForm.teamId))
      editingSprintId.value = null
  },
  { immediate: true },
)

const resetSprintForm = (form: SprintForm, teamId = defaultTeamId.value) => {
  Object.assign(form, createSprintForm(teamId))
}

const sprintToForm = (sprint: Sprint): SprintForm => ({
  teamId: sprint.teamId,
  name: sprint.name,
  startsOn: sprint.startsOn,
  durationWeeks: sprint.durationWeeks,
})

const toSprintInput = (form: SprintForm) => ({
  teamId: form.teamId,
  name: form.name.trim(),
  startsOn: form.startsOn,
  durationWeeks: form.durationWeeks,
})

const createSprint = () => {
  const input = toSprintInput(newSprintForm)
  if (!input.teamId || !input.name || !input.startsOn) return
  planningStore.createSprint(input)
  track('sprint_created', { duration_weeks: input.durationWeeks })
  resetSprintForm(newSprintForm, input.teamId)
  showNewSprintForm.value = false
}

const startSprintEdit = (sprint: Sprint) => {
  editingSprintId.value = sprint.id
  Object.assign(editingSprintForm, sprintToForm(sprint))
}

const saveSprintEdit = () => {
  const sprintId = editingSprintId.value
  const input = toSprintInput(editingSprintForm)
  if (!sprintId || !input.teamId || !input.name || !input.startsOn) return
  planningStore.updateSprint(sprintId, input)
  editingSprintId.value = null
  resetSprintForm(editingSprintForm)
}

const deleteSprint = async (
  sprint: Sprint & { workItemCount: number; epicCount: number; releaseWorkItemCount: number },
) => {
  const confirmed = await confirmDialog.confirm({
    title: `Удалить спринт "${sprint.name}"?`,
    message: `Будут удалены задачи, epics и результаты распределения. Задач: ${sprint.workItemCount}, epics: ${sprint.epicCount}.`,
    confirmLabel: 'Удалить спринт',
    tone: 'danger',
  })
  if (!confirmed) return
  planningStore.deleteSprint(sprint.id)
}

const startCloneSprint = (sprint: Sprint) => {
  cloningSourceSprintId.value = sprint.id
  Object.assign(cloneSprintForm, {
    teamId: sprint.teamId,
    name: `${sprint.name} (копия)`,
    startsOn: todayStr,
    durationWeeks: sprint.durationWeeks,
  })
}

const submitCloneSprint = () => {
  const sourceId = cloningSourceSprintId.value
  const input = toSprintInput(cloneSprintForm)
  if (!sourceId || !input.teamId || !input.name || !input.startsOn) return
  planningStore.cloneSprintWithWorkItems(sourceId, input)
  cloningSourceSprintId.value = null
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
    <section class="min-w-0">
      <header class="border-b border-teal-100 pb-6">
        <p class="text-sm font-bold text-teal-700 uppercase">Спринты</p>
        <div class="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-3xl font-bold text-slate-950">Контейнеры планирования</h1>
            <p class="mt-3 max-w-2xl text-base text-slate-600">
              Создавайте спринты на одну или две недели, привязывайте их к командам и открывайте
              рабочее место планирования.
            </p>
          </div>
          <button
            type="button"
            :disabled="!planningStore.teams.length"
            class="primary-action w-fit rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            @click="showNewSprintForm = true"
          >
            Создать спринт
          </button>
        </div>
      </header>
      <section
        v-if="!planningStore.teams.length"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-5"
      >
        <h2 class="text-base font-semibold text-slate-950">Нужна команда</h2>
        <p class="mt-2 text-sm text-slate-600">
          Спринт всегда привязан к команде. Сначала создайте команду и участников.
        </p>
        <RouterLink
          :to="{ name: 'teams' }"
          class="mt-4 inline-flex rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          К командам
        </RouterLink>
      </section>
      <p v-if="exchangeStatus" class="mt-3 text-sm font-medium text-slate-600">
        {{ exchangeStatus }}
      </p>

      <!-- Активные и будущие спринты -->
      <div v-if="activeSprints.length" class="mt-6 grid gap-4">
        <article
          v-for="sprint in activeSprints"
          :key="sprint.id"
          class="group accent-strip surface-card rounded-lg border p-5 pl-6 hover-card"
          :class="sprint.status === 'active' ? 'border-sky-200' : 'border-slate-200'"
        >
          <form
            v-if="editingSprintId === sprint.id"
            class="grid gap-4"
            @submit.prevent="saveSprintEdit"
          >
            <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label class="min-w-0">
                <span class="text-sm font-medium text-slate-700">Название</span>
                <input
                  v-model="editingSprintForm.name"
                  required
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label>
                <span class="text-sm font-medium text-slate-700">Команда</span>
                <select
                  v-model="editingSprintForm.teamId"
                  required
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                >
                  <option v-for="team in planningStore.teams" :key="team.id" :value="team.id">
                    {{ team.name }}
                  </option>
                </select>
              </label>
              <label>
                <span class="text-sm font-medium text-slate-700">Старт</span>
                <input
                  v-model="editingSprintForm.startsOn"
                  required
                  type="date"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label>
                <span class="text-sm font-medium text-slate-700">Длительность</span>
                <select
                  v-model.number="editingSprintForm.durationWeeks"
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                >
                  <option v-for="d in durationOptions" :key="d.value" :value="d.value">
                    {{ d.label }}
                  </option>
                </select>
              </label>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                type="submit"
                class="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              >
                Сохранить
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="editingSprintId = null"
              >
                Отмена
              </button>
            </div>
          </form>

          <template v-else>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span
                    v-if="sprint.status === 'active'"
                    class="inline-block h-2 w-2 shrink-0 rounded-full bg-teal-500 shadow-sm shadow-teal-500/40"
                  ></span>
                  <h2 class="text-xl font-semibold text-slate-950">{{ sprint.name }}</h2>
                </div>
                <p class="mt-1 text-sm text-slate-600">{{ sprint.teamName }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <span
                  class="rounded-md px-2.5 py-1 text-xs font-semibold"
                  :class="
                    sprint.status === 'active'
                      ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200'
                      : 'bg-slate-100 text-slate-600'
                  "
                >
                  {{ sprint.status === 'active' ? 'Активен' : 'Скоро' }}
                </span>
                <span
                  class="rounded-md bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700"
                >
                  {{ sprint.durationWeeks }} нед.
                </span>
              </div>
            </div>

            <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-4">
              <div class="rounded-lg bg-slate-50 p-3">
                <dt class="text-slate-500">Старт</dt>
                <dd class="mt-1 font-semibold text-slate-950">{{ formatDate(sprint.startsOn) }}</dd>
              </div>
              <div class="rounded-lg bg-slate-50 p-3">
                <dt class="text-slate-500">Задачи</dt>
                <dd class="mt-1 font-semibold text-slate-950">{{ sprint.workItemCount }}</dd>
              </div>
              <div class="rounded-lg bg-slate-50 p-3">
                <dt class="text-slate-500">Epics</dt>
                <dd class="mt-1 font-semibold text-slate-950">{{ sprint.epicCount }}</dd>
              </div>
              <div class="rounded-lg bg-slate-50 p-3">
                <dt class="text-slate-500">Релизы</dt>
                <dd class="mt-1 font-semibold text-slate-950">{{ sprint.releaseWorkItemCount }}</dd>
              </div>
            </dl>

            <div class="mt-4 flex flex-wrap gap-2">
              <RouterLink
                :to="{ name: 'sprint-planning', params: { sprintId: sprint.id } }"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
              >
                Открыть план
              </RouterLink>
              <RouterLink
                :to="{ name: 'sprint-allocation', params: { sprintId: sprint.id } }"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Распределение
              </RouterLink>
              <div class="hover-actions flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                  @click="exportSprint(sprint.id)"
                >
                  Экспорт
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white"
                  @click="startCloneSprint(sprint)"
                >
                  Создать на основе
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-teal-200 bg-white/80 px-3 py-2 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
                  @click="startSprintEdit(sprint)"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-transparent px-2.5 py-2 text-sm font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                  @click="deleteSprint(sprint)"
                >
                  Удалить
                </button>
              </div>
            </div>
          </template>
        </article>
      </div>

      <div
        v-else-if="!archivedSprints.length"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8"
      >
        <h2 class="text-lg font-semibold text-slate-950">Спринтов пока нет</h2>
        <p class="mt-2 text-sm text-slate-600">Создайте первый контейнер планирования.</p>
        <button
          type="button"
          :disabled="!planningStore.teams.length"
          class="primary-action mt-4 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          @click="showNewSprintForm = true"
        >
          Создать спринт
        </button>
      </div>

      <!-- Архив прошедших спринтов -->
      <div v-if="archivedSprints.length" class="mt-6">
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          @click="showArchive = !showArchive"
        >
          <span class="flex items-center gap-2">
            <span class="text-xl">Архив</span>
            — {{ archivedSprints.length }} прошедших спринтов
          </span>
          <span
            class="text-slate-400 transition-transform"
            :class="showArchive ? 'rotate-180' : ''"
          >
            ▾
          </span>
        </button>

        <div v-if="showArchive" class="mt-3 grid gap-3">
          <article
            v-for="sprint in archivedSprints"
            :key="sprint.id"
            class="rounded-lg border border-slate-200 bg-slate-50 p-4 opacity-60 transition hover:opacity-80"
          >
            <form
              v-if="editingSprintId === sprint.id"
              class="grid gap-4"
              @submit.prevent="saveSprintEdit"
            >
              <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label class="min-w-0">
                  <span class="text-sm font-medium text-slate-700">Название</span>
                  <input
                    v-model="editingSprintForm.name"
                    required
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </label>
                <label>
                  <span class="text-sm font-medium text-slate-700">Команда</span>
                  <select
                    v-model="editingSprintForm.teamId"
                    required
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option v-for="team in planningStore.teams" :key="team.id" :value="team.id">
                      {{ team.name }}
                    </option>
                  </select>
                </label>
                <label>
                  <span class="text-sm font-medium text-slate-700">Старт</span>
                  <input
                    v-model="editingSprintForm.startsOn"
                    required
                    type="date"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </label>
                <label>
                  <span class="text-sm font-medium text-slate-700">Длительность</span>
                  <select
                    v-model.number="editingSprintForm.durationWeeks"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option v-for="d in durationOptions" :key="d.value" :value="d.value">
                      {{ d.label }}
                    </option>
                  </select>
                </label>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  type="submit"
                  class="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                >
                  Сохранить
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  @click="editingSprintId = null"
                >
                  Отмена
                </button>
              </div>
            </form>

            <template v-else>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <h2 class="text-base font-semibold text-slate-700">{{ sprint.name }}</h2>
                  <p class="mt-0.5 text-sm text-slate-500">
                    {{ sprint.teamName }} · завершён {{ formatDate(sprint.endDate) }}
                  </p>
                </div>
                <span
                  class="shrink-0 rounded-md bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-500"
                >
                  {{ sprint.durationWeeks }} нед.
                </span>
              </div>

              <dl class="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                <div>
                  <span class="font-medium text-slate-600">{{ sprint.workItemCount }}</span> задач
                </div>
                <div>
                  <span class="font-medium text-slate-600">{{ sprint.epicCount }}</span> epics
                </div>
                <div>
                  <span class="font-medium text-slate-600">{{ sprint.releaseWorkItemCount }}</span>
                  релизов
                </div>
              </dl>

              <div class="mt-3 flex flex-wrap gap-2">
                <RouterLink
                  :to="{ name: 'sprint-planning', params: { sprintId: sprint.id } }"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
                >
                  Открыть план
                </RouterLink>
                <RouterLink
                  :to="{ name: 'sprint-allocation', params: { sprintId: sprint.id } }"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
                >
                  Распределение
                </RouterLink>
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
                  @click="exportSprint(sprint.id)"
                >
                  Экспорт
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
                  @click="startCloneSprint(sprint)"
                >
                  Создать на основе
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-white"
                  @click="startSprintEdit(sprint)"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50"
                  @click="deleteSprint(sprint)"
                >
                  Удалить
                </button>
              </div>
            </template>
          </article>
        </div>
      </div>
    </section>
  </main>

  <AppModal :open="showNewSprintForm" title="Новый спринт" @close="showNewSprintForm = false">
    <form class="grid gap-4" @submit.prevent="createSprint">
      <label>
        <span class="text-sm font-medium text-slate-700">Команда</span>
        <select
          v-model="newSprintForm.teamId"
          required
          :disabled="!planningStore.teams.length"
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        >
          <option value="" disabled>Выберите команду</option>
          <option v-for="team in planningStore.teams" :key="team.id" :value="team.id">
            {{ team.name }}
          </option>
        </select>
      </label>

      <label>
        <span class="text-sm font-medium text-slate-700">Название</span>
        <input
          v-model="newSprintForm.name"
          required
          placeholder="Sprint 2026.06"
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label>
          <span class="text-sm font-medium text-slate-700">Дата старта</span>
          <input
            v-model="newSprintForm.startsOn"
            required
            type="date"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </label>

        <label>
          <span class="text-sm font-medium text-slate-700">Длительность</span>
          <select
            v-model.number="newSprintForm.durationWeeks"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            <option v-for="d in durationOptions" :key="d.value" :value="d.value">
              {{ d.label }}
            </option>
          </select>
        </label>
      </div>

      <button
        type="submit"
        :disabled="!planningStore.teams.length"
        class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
      >
        Создать спринт
      </button>
    </form>
  </AppModal>

  <AppModal
    :open="cloningSourceSprintId !== null"
    title="Создать спринт на основе"
    @close="cloningSourceSprintId = null"
  >
    <form class="grid gap-4" @submit.prevent="submitCloneSprint">
      <p class="text-sm text-slate-600">
        Будет создан новый спринт с теми же задачами и epics. Назначения исполнителей сохранятся,
        результаты распределения — нет.
      </p>

      <label>
        <span class="text-sm font-medium text-slate-700">Команда</span>
        <select
          v-model="cloneSprintForm.teamId"
          required
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        >
          <option v-for="team in planningStore.teams" :key="team.id" :value="team.id">
            {{ team.name }}
          </option>
        </select>
      </label>

      <label>
        <span class="text-sm font-medium text-slate-700">Название</span>
        <input
          v-model="cloneSprintForm.name"
          required
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-2">
        <label>
          <span class="text-sm font-medium text-slate-700">Дата старта</span>
          <input
            v-model="cloneSprintForm.startsOn"
            required
            type="date"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </label>

        <label>
          <span class="text-sm font-medium text-slate-700">Длительность</span>
          <select
            v-model.number="cloneSprintForm.durationWeeks"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            <option v-for="d in durationOptions" :key="d.value" :value="d.value">
              {{ d.label }}
            </option>
          </select>
        </label>
      </div>

      <button
        type="submit"
        class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
      >
        Создать спринт
      </button>
    </form>
  </AppModal>
</template>
