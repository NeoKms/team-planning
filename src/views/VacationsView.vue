<script setup lang="ts">
import { computed, reactive, ref } from 'vue'

import { type VacationPeriod, formatDate } from '@/domain/planning'
import { getSprintWorkingDates } from '@/domain/scheduling'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { usePlanningStore } from '@/stores/planning'

const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()

const selectedTeamId = ref(planningStore.teams[0]?.id ?? '')

const filteredMembers = computed(() =>
  planningStore.members.filter((m) => m.teamId === (selectedTeamId.value || m.teamId)),
)

const memberById = computed(() =>
  Object.fromEntries(planningStore.members.map((m) => [m.id, m])),
)

const vacationsByMemberId = computed(() => {
  const map = new Map<string, VacationPeriod[]>()
  planningStore.vacations.forEach((v) => {
    const list = map.get(v.memberId) ?? []
    list.push(v)
    map.set(v.memberId, list)
  })
  return map
})

// Sprint overlap helpers
const sprintOverlapLabels = (vacation: VacationPeriod): string[] => {
  return planningStore.sprints
    .filter((sprint) => {
      const member = memberById.value[vacation.memberId]
      if (!member || sprint.teamId !== member.teamId) return false
      const dates = getSprintWorkingDates(sprint)
      if (!dates.length) return false
      return dates.some((d) => d >= vacation.startDate && d <= vacation.endDate)
    })
    .map((s) => s.name)
}

const isFullSprintVacation = (vacation: VacationPeriod): string[] => {
  return planningStore.sprints
    .filter((sprint) => {
      const member = memberById.value[vacation.memberId]
      if (!member || sprint.teamId !== member.teamId) return false
      const dates = getSprintWorkingDates(sprint)
      if (!dates.length) return false
      return dates.every((d) => d >= vacation.startDate && d <= vacation.endDate)
    })
    .map((s) => s.name)
}

interface VacationForm {
  memberId: string
  startDate: string
  endDate: string
}

const createForm = (): VacationForm => ({
  memberId: filteredMembers.value[0]?.id ?? '',
  startDate: '',
  endDate: '',
})

const form = reactive<VacationForm>(createForm())
const editingVacationId = ref<string | null>(null)

const formError = computed(() => {
  if (!form.memberId) return 'Выберите участника'
  if (!form.startDate) return 'Укажите дату начала'
  if (!form.endDate) return 'Укажите дату окончания'
  if (form.endDate < form.startDate) return 'Дата окончания не может быть раньше начала'
  return null
})

const resetForm = () => {
  Object.assign(form, createForm())
  editingVacationId.value = null
}

const startEdit = (vacation: VacationPeriod) => {
  editingVacationId.value = vacation.id
  form.memberId = vacation.memberId
  form.startDate = vacation.startDate
  form.endDate = vacation.endDate
}

const submitForm = () => {
  if (formError.value) return

  if (editingVacationId.value) {
    planningStore.updateVacation(editingVacationId.value, {
      memberId: form.memberId,
      startDate: form.startDate,
      endDate: form.endDate,
    })
  } else {
    planningStore.createVacation({
      memberId: form.memberId,
      startDate: form.startDate,
      endDate: form.endDate,
    })
  }
  resetForm()
}

const deleteVacation = async (vacation: VacationPeriod) => {
  const member = memberById.value[vacation.memberId]
  const confirmed = await confirmDialog.confirm({
    title: `Удалить отпуск${member ? ` "${member.name}"` : ''}?`,
    message: `${formatDate(vacation.startDate)} — ${formatDate(vacation.endDate)}. Распределение нагрузки для связанных спринтов будет сброшено.`,
    confirmLabel: 'Удалить',
    tone: 'danger',
  })
  if (!confirmed) return
  planningStore.deleteVacation(vacation.id)
}

const roleLabels: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  'tech-lead': 'Tech lead',
  qa: 'QA',
  ios: 'iOS',
  android: 'Android',
}

const formatDateRange = (startDate: string, endDate: string) =>
  startDate === endDate ? formatDate(startDate) : `${formatDate(startDate)} — ${formatDate(endDate)}`
</script>

<template>
  <main
    class="mx-auto grid max-w-7xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-12"
  >
    <section class="min-w-0">
      <header class="border-b border-slate-200 pb-6">
        <p class="text-sm font-bold text-slate-500 uppercase">Команда</p>
        <h1 class="mt-2 text-3xl font-bold text-slate-950">Отпуска</h1>
        <p class="mt-3 max-w-2xl text-base text-slate-600">
          Укажите периоды отпусков участников команды. Дни отпуска учитываются при распределении
          нагрузки: ёмкость сотрудника за отпускные дни обнуляется, а при полном отпуске на весь
          спринт он исключается из автоназначения и недоступен как ответственный.
        </p>
      </header>

      <!-- Team filter -->
      <div class="mt-6" v-if="planningStore.teams.length > 1">
        <label class="text-sm font-medium text-slate-700">
          Команда
          <select
            v-model="selectedTeamId"
            class="mt-1 block w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            <option value="">Все команды</option>
            <option v-for="team in planningStore.teams" :key="team.id" :value="team.id">
              {{ team.name }}
            </option>
          </select>
        </label>
      </div>

      <section v-if="filteredMembers.length" class="mt-6 grid gap-4">
        <article
          v-for="member in filteredMembers"
          :key="member.id"
          class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold text-slate-950">{{ member.name }}</h2>
            <span class="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
              {{ roleLabels[member.role] ?? member.role }}
            </span>
          </div>

          <div
            v-if="vacationsByMemberId.get(member.id)?.length"
            class="mt-4 grid gap-2"
          >
            <div
              v-for="vacation in vacationsByMemberId.get(member.id)"
              :key="vacation.id"
              class="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div class="min-w-0">
                <p class="font-medium text-slate-950">
                  {{ formatDateRange(vacation.startDate, vacation.endDate) }}
                </p>
                <div class="mt-1.5 flex flex-wrap gap-1.5">
                  <template v-for="sprintName in isFullSprintVacation(vacation)" :key="sprintName">
                    <span
                      class="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200"
                    >
                      Весь спринт: {{ sprintName }}
                    </span>
                  </template>
                  <template
                    v-for="sprintName in sprintOverlapLabels(vacation).filter(
                      (n) => !isFullSprintVacation(vacation).includes(n),
                    )"
                    :key="sprintName"
                  >
                    <span
                      class="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200"
                    >
                      Частично: {{ sprintName }}
                    </span>
                  </template>
                </div>
              </div>
              <div class="flex shrink-0 gap-2">
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  @click="startEdit(vacation)"
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  class="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50"
                  @click="deleteVacation(vacation)"
                >
                  Удалить
                </button>
              </div>
            </div>
          </div>

          <p
            v-else
            class="mt-4 rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500"
          >
            Отпусков не указано
          </p>
        </article>
      </section>

      <section v-else class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8">
        <h2 class="text-lg font-semibold text-slate-950">Участников нет</h2>
        <p class="mt-2 text-sm text-slate-600">Сначала добавьте команду и участников.</p>
      </section>
    </section>

    <!-- Sidebar form -->
    <aside class="grid gap-4 lg:content-start">
      <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 class="text-base font-semibold text-slate-950">
          {{ editingVacationId ? 'Редактировать отпуск' : 'Добавить отпуск' }}
        </h2>

        <form class="mt-4 grid gap-4" @submit.prevent="submitForm">
          <label>
            <span class="text-sm font-medium text-slate-700">Участник</span>
            <select
              v-model="form.memberId"
              required
              :disabled="!planningStore.members.length"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition disabled:bg-slate-100 disabled:text-slate-500 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="" disabled>Выберите участника</option>
              <template
                v-for="team in planningStore.teams"
                :key="team.id"
              >
                <optgroup :label="team.name">
                  <option
                    v-for="member in planningStore.members.filter((m) => m.teamId === team.id)"
                    :key="member.id"
                    :value="member.id"
                  >
                    {{ member.name }} · {{ roleLabels[member.role] ?? member.role }}
                  </option>
                </optgroup>
              </template>
            </select>
          </label>

          <label>
            <span class="text-sm font-medium text-slate-700">Дата начала</span>
            <input
              v-model="form.startDate"
              type="date"
              required
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>

          <label>
            <span class="text-sm font-medium text-slate-700">Дата окончания</span>
            <input
              v-model="form.endDate"
              type="date"
              required
              :min="form.startDate || undefined"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>

          <p v-if="formError" class="text-xs font-medium text-red-600">{{ formError }}</p>

          <div class="flex flex-wrap gap-2">
            <button
              type="submit"
              :disabled="Boolean(formError)"
              class="rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {{ editingVacationId ? 'Сохранить' : 'Добавить отпуск' }}
            </button>
            <button
              v-if="editingVacationId"
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              @click="resetForm"
            >
              Отмена
            </button>
          </div>
        </form>
      </section>

      <section
        v-if="planningStore.vacations.length"
        class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 class="text-base font-semibold text-slate-950">Всего отпусков</h2>
        <p class="mt-2 text-2xl font-bold text-slate-950">{{ planningStore.vacations.length }}</p>
        <p class="mt-1 text-sm text-slate-600">
          у {{ new Set(planningStore.vacations.map((v) => v.memberId)).size }} участников
        </p>
      </section>
    </aside>
  </main>
</template>





