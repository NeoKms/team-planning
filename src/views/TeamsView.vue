<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import AppModal from '@/components/AppModal.vue'
import {
  CALENDAR_MEETING_BUFFER_MINUTES,
  CALENDAR_WORK_DAY_MINUTES,
  WORKING_DAYS,
  WORK_DAY_HOURS,
  emptyMeetingLoadByWeekday,
  formatDuration,
  type MeetingLoadByWeekday,
  type Role,
  type Team,
  type TeamMember,
  type Weekday,
} from '@/domain/planning'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useDataExchange } from '@/composables/useDataExchange'
import { useAnalytics } from '@/composables/useAnalytics'
import { usePlanningStore } from '@/stores/planning'

const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()
const { status: exchangeStatus, exportTeam } = useDataExchange()
const { track } = useAnalytics()

const roleOptions: Array<{ value: Role; label: string }> = [
  { value: 'frontend', label: 'Frontend' },
  { value: 'backend', label: 'Backend' },
  { value: 'tech-lead', label: 'Tech lead' },
  { value: 'qa', label: 'QA' },
  { value: 'ios', label: 'iOS' },
  { value: 'android', label: 'Android' },
]

const roleLabels = Object.fromEntries(
  roleOptions.map((role) => [role.value, role.label]),
) as Record<Role, string>

const weekdayLabels: Record<Weekday, string> = {
  monday: 'Пн',
  tuesday: 'Вт',
  wednesday: 'Ср',
  thursday: 'Чт',
  friday: 'Пт',
}

const weekdayOptions = WORKING_DAYS.map((day) => ({
  value: day,
  label: weekdayLabels[day],
}))

interface MemberForm {
  teamId: string
  name: string
  role: Role
  availableHoursPerDay: number
  meetings: MeetingLoadByWeekday
}

const teamForm = reactive({
  name: '',
})

const editingTeamId = ref<string | null>(null)
const editingTeamName = ref('')
const showNewTeamForm = ref(false)
const showNewMemberForm = ref(false)
const selectedTeamId = ref('')

const defaultTeamId = computed(() => planningStore.teams[0]?.id ?? '')

const createMemberForm = (teamId = defaultTeamId.value): MemberForm => ({
  teamId,
  name: '',
  role: 'backend',
  availableHoursPerDay: WORK_DAY_HOURS,
  meetings: emptyMeetingLoadByWeekday(),
})

const newMemberForm = reactive<MemberForm>(createMemberForm())
const editingMemberId = ref<string | null>(null)
const editingMemberForm = reactive<MemberForm>(createMemberForm())

const teamsWithMembers = computed(() =>
  planningStore.teams.map((team) => {
    const members = planningStore.members.filter((member) => member.teamId === team.id)
    const sprintCount = planningStore.sprints.filter((sprint) => sprint.teamId === team.id).length
    const availableHours =
      Math.round(
        (members.reduce((total, member) => total + member.availableMinutesPerDay, 0) / 60) * 10,
      ) / 10

    return {
      ...team,
      members,
      sprintCount,
      availableHours,
    }
  }),
)

const selectedTeam = computed(
  () =>
    teamsWithMembers.value.find((team) => team.id === selectedTeamId.value) ??
    teamsWithMembers.value[0],
)

const selectedTeamRoleSummary = computed(() => {
  const members = selectedTeam.value?.members ?? []

  return roleOptions
    .map((role) => {
      const roleMembers = members.filter((member) => member.role === role.value)
      const availableMinutesPerDay = roleMembers.reduce(
        (total, member) => total + member.availableMinutesPerDay,
        0,
      )

      return {
        ...role,
        count: roleMembers.length,
        availableMinutesPerDay,
      }
    })
    .filter((role) => role.count > 0)
})

watch(
  () => planningStore.teams.map((team) => team.id),
  (teamIds) => {
    if (!teamIds.includes(selectedTeamId.value)) {
      selectedTeamId.value = teamIds[0] ?? ''
    }

    if (!teamIds.includes(newMemberForm.teamId)) {
      newMemberForm.teamId = teamIds[0] ?? ''
    }

    if (editingMemberForm.teamId && !teamIds.includes(editingMemberForm.teamId)) {
      editingMemberId.value = null
    }
  },
  { immediate: true },
)

const asNumber = (value: number, fallback = 0) => {
  if (Number.isFinite(value)) {
    return value
  }

  return fallback
}

const toDailyMinutes = (hours: number) => Math.max(0, Math.round(asNumber(hours) * 60))

const sanitizeMeetingLoad = (meetingLoad: MeetingLoadByWeekday): MeetingLoadByWeekday => {
  const nextMeetingLoad = emptyMeetingLoadByWeekday()

  for (const day of WORKING_DAYS) {
    nextMeetingLoad[day] = Math.max(0, Math.round(asNumber(meetingLoad[day])))
  }

  return nextMeetingLoad
}

const toMemberInput = (form: MemberForm) => ({
  teamId: form.teamId,
  name: form.name.trim(),
  role: form.role,
  availableMinutesPerDay: toDailyMinutes(form.availableHoursPerDay),
  meetingLoadByWeekday: sanitizeMeetingLoad(form.meetings),
})

const memberToForm = (member: TeamMember): MemberForm => ({
  teamId: member.teamId,
  name: member.name,
  role: member.role,
  availableHoursPerDay: Math.round((member.availableMinutesPerDay / 60) * 100) / 100,
  meetings: {
    ...emptyMeetingLoadByWeekday(),
    ...member.meetingLoadByWeekday,
  },
})

const resetMemberForm = (form: MemberForm, teamId = defaultTeamId.value) => {
  Object.assign(form, createMemberForm(teamId))
}

const meetingLoadTotal = (member: TeamMember) =>
  WORKING_DAYS.reduce((total, day) => total + member.meetingLoadByWeekday[day], 0)

const meetingOverloadTotal = (member: TeamMember) =>
  WORKING_DAYS.reduce(
    (total, day) =>
      total +
      Math.max(0, Math.round(member.meetingLoadByWeekday[day]) - CALENDAR_MEETING_BUFFER_MINUTES),
    0,
  )

const createTeam = () => {
  const name = teamForm.name.trim()

  if (!name) {
    return
  }

  const team = planningStore.createTeam({ name })
  track('team_created')
  teamForm.name = ''
  selectedTeamId.value = team.id
  newMemberForm.teamId = team.id
  showNewTeamForm.value = false
}

const startTeamEdit = (team: Team) => {
  editingTeamId.value = team.id
  editingTeamName.value = team.name
}

const saveTeamEdit = () => {
  const teamId = editingTeamId.value
  const name = editingTeamName.value.trim()

  if (!teamId || !name) {
    return
  }

  planningStore.updateTeam(teamId, { name })
  editingTeamId.value = null
  editingTeamName.value = ''
}

const deleteTeam = async (team: Team & { sprintCount: number }) => {
  const suffix = team.sprintCount
    ? ` Связанные спринты, задачи и результаты распределения тоже будут удалены: ${team.sprintCount}.`
    : ''

  const confirmed = await confirmDialog.confirm({
    title: `Удалить команду "${team.name}"?`,
    message: `Все участники команды будут удалены.${suffix}`,
    confirmLabel: 'Удалить команду',
    tone: 'danger',
  })

  if (!confirmed) {
    return
  }

  planningStore.deleteTeam(team.id)
}

const createMember = () => {
  const input = toMemberInput(newMemberForm)

  if (!input.teamId || !input.name) {
    return
  }

  planningStore.createTeamMember(input)
  resetMemberForm(newMemberForm, input.teamId)
  showNewMemberForm.value = false
}

const startMemberEdit = (member: TeamMember) => {
  editingMemberId.value = member.id
  Object.assign(editingMemberForm, memberToForm(member))
}

const saveMemberEdit = () => {
  const memberId = editingMemberId.value
  const input = toMemberInput(editingMemberForm)

  if (!memberId || !input.teamId || !input.name) {
    return
  }

  planningStore.updateTeamMember(memberId, input)
  editingMemberId.value = null
  resetMemberForm(editingMemberForm)
}

const deleteMember = async (member: TeamMember) => {
  const confirmed = await confirmDialog.confirm({
    title: `Удалить участника "${member.name}"?`,
    message: 'Назначения в задачах и связанные слоты распределения будут очищены.',
    confirmLabel: 'Удалить участника',
    tone: 'danger',
  })

  if (!confirmed) {
    return
  }

  planningStore.deleteTeamMember(member.id)
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
    <section class="min-w-0">
      <header class="border-b border-teal-100 pb-6">
        <p class="text-sm font-bold text-teal-700 uppercase">Команды</p>
        <div class="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 class="text-3xl font-bold text-slate-950">Составы и доступность</h1>
            <p class="mt-3 max-w-2xl text-base text-slate-600">
              Управляйте командами, ролями участников, дневной доступностью и средней занятостью
              встречами по рабочим дням.
            </p>
          </div>
          <div class="relative flex flex-wrap gap-2">
            <div class="relative">
              <button
                type="button"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
                @click="showNewTeamForm = !showNewTeamForm"
              >
                Создать команду
              </button>
              <button
                v-if="showNewTeamForm && teamsWithMembers.length"
                type="button"
                class="fixed inset-0 z-10 cursor-default"
                aria-label="Закрыть форму создания команды"
                @click="showNewTeamForm = false"
              ></button>
              <form
                v-if="showNewTeamForm && teamsWithMembers.length"
                class="absolute right-0 z-20 mt-2 grid w-72 gap-3 rounded-lg border border-teal-100 bg-white p-3 text-left shadow-xl ring-1 ring-slate-950/5"
                @submit.prevent="createTeam"
              >
                <label>
                  <span class="text-xs font-semibold text-slate-600 uppercase">Название</span>
                  <input
                    v-model="teamForm.name"
                    required
                    placeholder="Core Platform"
                    class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  />
                </label>
                <div class="flex justify-end gap-2">
                  <button
                    type="button"
                    class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    @click="showNewTeamForm = false"
                  >
                    Отмена
                  </button>
                  <button
                    type="submit"
                    class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
                  >
                    Создать
                  </button>
                </div>
              </form>
            </div>
            <button
              type="button"
              :disabled="!planningStore.teams.length"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              @click="showNewMemberForm = true"
            >
              Добавить участника
            </button>
          </div>
        </div>
      </header>
      <p v-if="exchangeStatus" class="mt-3 text-sm font-medium text-slate-600">
        {{ exchangeStatus }}
      </p>

      <section v-if="teamsWithMembers.length" class="mt-6 grid gap-4">
        <div
          v-if="teamsWithMembers.length > 1"
          class="surface-card grid gap-2 rounded-lg border p-2 sm:grid-cols-2 xl:grid-cols-4"
        >
          <button
            v-for="team in teamsWithMembers"
            :key="team.id"
            type="button"
            class="rounded-lg px-3 py-3 text-left transition"
            :class="
              selectedTeamId === team.id
                ? 'bg-gradient-to-r from-teal-700 to-sky-600 text-white shadow-sm shadow-teal-700/20'
                : 'text-slate-700 hover:bg-teal-50 hover:text-teal-800'
            "
            @click="selectedTeamId = team.id"
          >
            <span class="block truncate text-sm font-semibold">{{ team.name }}</span>
            <span
              class="mt-1 block text-xs"
              :class="selectedTeamId === team.id ? 'text-teal-50' : 'text-slate-500'"
            >
              {{ team.members.length }} участников ·
              {{ formatDuration(team.availableHours * 60) }}/день
            </span>
          </button>
        </div>

        <article
          v-for="team in selectedTeam ? [selectedTeam] : []"
          :key="team.id"
          class="group surface-card accent-strip rounded-lg border p-5 pl-6"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <form
              v-if="editingTeamId === team.id"
              class="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
              @submit.prevent="saveTeamEdit"
            >
              <label class="min-w-0">
                <span class="text-sm font-medium text-slate-700">Название команды</span>
                <input
                  v-model="editingTeamName"
                  required
                  class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <button
                type="submit"
                class="primary-action self-end rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition"
              >
                Сохранить
              </button>
              <button
                type="button"
                class="self-end rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium whitespace-nowrap text-slate-700 transition hover:bg-slate-100"
                @click="editingTeamId = null"
              >
                Отмена
              </button>
            </form>

            <div v-else class="min-w-0">
              <h2 class="text-xl font-semibold text-slate-950">{{ team.name }}</h2>
              <p class="mt-1 text-sm text-slate-600">
                {{ team.members.length }} участников,
                {{ formatDuration(team.availableHours * 60) }} доступно в день
              </p>
              <p v-if="team.sprintCount" class="mt-1 text-xs text-slate-500">
                Связанные спринты: {{ team.sprintCount }}
              </p>
            </div>

            <div v-if="editingTeamId !== team.id" class="hover-actions flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white"
                @click="exportTeam(team.id)"
              >
                Экспорт
              </button>
              <button
                type="button"
                class="rounded-lg border border-teal-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
                @click="startTeamEdit(team)"
              >
                Редактировать
              </button>
              <button
                type="button"
                class="rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                @click="deleteTeam(team)"
              >
                Удалить
              </button>
            </div>
          </div>

          <section
            v-if="selectedTeamRoleSummary.length"
            class="mt-5 grid gap-2 border-t border-teal-100 pt-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div
              v-for="role in selectedTeamRoleSummary"
              :key="role.value"
              class="rounded-lg border border-teal-100 bg-teal-50/45 px-3 py-2"
            >
              <p class="text-xs font-semibold text-teal-700 uppercase">{{ role.label }}</p>
              <p class="mt-1 text-sm font-semibold text-slate-950">
                {{ role.count }} чел. · {{ formatDuration(role.availableMinutesPerDay) }}/день
              </p>
            </div>
          </section>

          <div v-if="team.members.length" class="mt-5 divide-y divide-slate-200">
            <div
              v-for="member in team.members"
              :key="member.id"
              class="group -mx-3 rounded-lg px-3 py-4 first:pt-3 last:pb-3 hover-card"
            >
              <form
                v-if="editingMemberId === member.id"
                class="grid gap-4"
                @submit.prevent="saveMemberEdit"
              >
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label class="min-w-0">
                    <span class="text-sm font-medium text-slate-700">Имя</span>
                    <input
                      v-model="editingMemberForm.name"
                      required
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                  <label>
                    <span class="text-sm font-medium text-slate-700">Команда</span>
                    <select
                      v-model="editingMemberForm.teamId"
                      required
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      <option
                        v-for="candidate in planningStore.teams"
                        :key="candidate.id"
                        :value="candidate.id"
                      >
                        {{ candidate.name }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span class="text-sm font-medium text-slate-700">Роль</span>
                    <select
                      v-model="editingMemberForm.role"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      <option v-for="role in roleOptions" :key="role.value" :value="role.value">
                        {{ role.label }}
                      </option>
                    </select>
                  </label>
                  <label>
                    <span class="text-sm font-medium text-slate-700">Часов в день</span>
                    <input
                      v-model.number="editingMemberForm.availableHoursPerDay"
                      min="0"
                      max="12"
                      step="0.25"
                      type="number"
                      class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />
                  </label>
                </div>

                <fieldset>
                  <legend class="text-sm font-medium text-slate-700">
                    Календарь встреч, минут в день
                  </legend>
                  <p class="mt-1 text-xs text-slate-500">
                    До {{ CALENDAR_MEETING_BUFFER_MINUTES }} мин/день уже заложено в процесс и не
                    уменьшает доступность.
                  </p>
                  <div class="mt-2 grid grid-cols-5 gap-2">
                    <label v-for="day in weekdayOptions" :key="day.value" class="min-w-0">
                      <span class="text-xs text-slate-500">{{ day.label }}</span>
                      <input
                        v-model.number="editingMemberForm.meetings[day.value]"
                        min="0"
                        :max="CALENDAR_WORK_DAY_MINUTES"
                        step="15"
                        type="number"
                        class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      />
                    </label>
                  </div>
                </fieldset>

                <div class="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    @click="editingMemberId = null"
                  >
                    Отмена
                  </button>
                </div>
              </form>

              <div v-else class="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-semibold text-slate-950">{{ member.name }}</h3>
                    <span
                      class="rounded-md bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 ring-1 ring-teal-200"
                    >
                      {{ roleLabels[member.role] }}
                    </span>
                  </div>
                  <dl class="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-3">
                    <div>
                      <dt class="text-slate-500">Доступность</dt>
                      <dd class="font-medium text-slate-950">
                        {{ formatDuration(member.availableMinutesPerDay) }}/день
                      </dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">Календарь за неделю</dt>
                      <dd class="font-medium text-slate-950">
                        {{ formatDuration(meetingLoadTotal(member)) }}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">Сверх буфера</dt>
                      <dd class="font-medium text-slate-950">
                        {{ formatDuration(meetingOverloadTotal(member)) }}
                      </dd>
                    </div>
                    <div>
                      <dt class="text-slate-500">Дефолт</dt>
                      <dd class="font-medium text-slate-950">
                        {{ formatDuration(WORK_DAY_HOURS * 60) }}/день
                      </dd>
                    </div>
                  </dl>
                </div>

                <div class="hover-actions flex flex-wrap gap-2 md:justify-end">
                  <button
                    type="button"
                    class="rounded-lg border border-teal-200 bg-white/80 px-3 py-1.5 text-sm font-medium text-teal-800 transition hover:bg-teal-50"
                    @click="startMemberEdit(member)"
                  >
                    Редактировать
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-transparent px-2.5 py-1.5 text-sm font-medium text-slate-400 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    @click="deleteMember(member)"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="mt-5 rounded-lg border border-dashed border-slate-300 p-4">
            <p class="text-sm text-slate-600">В этой команде пока нет участников.</p>
          </div>
        </article>
      </section>

      <section v-else class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8">
        <h2 class="text-lg font-semibold text-slate-950">Команд пока нет</h2>
        <p class="mt-2 text-sm text-slate-600">
          Создайте первую команду, затем добавьте участников с ролями и доступностью.
        </p>
        <div class="relative mt-4 inline-block">
          <button
            type="button"
            class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
            @click="showNewTeamForm = !showNewTeamForm"
          >
            Создать команду
          </button>
          <button
            v-if="showNewTeamForm"
            type="button"
            class="fixed inset-0 z-10 cursor-default"
            aria-label="Закрыть форму создания команды"
            @click="showNewTeamForm = false"
          ></button>
          <form
            v-if="showNewTeamForm"
            class="absolute left-0 z-20 mt-2 grid w-72 gap-3 rounded-lg border border-teal-100 bg-white p-3 text-left shadow-xl ring-1 ring-slate-950/5"
            @submit.prevent="createTeam"
          >
            <label>
              <span class="text-xs font-semibold text-slate-600 uppercase">Название</span>
              <input
                v-model="teamForm.name"
                required
                placeholder="Core Platform"
                class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
              />
            </label>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="showNewTeamForm = false"
              >
                Отмена
              </button>
              <button
                type="submit"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
              >
                Создать
              </button>
            </div>
          </form>
        </div>
      </section>
    </section>
  </main>

  <AppModal :open="showNewMemberForm" title="Новый участник" @close="showNewMemberForm = false">
    <form class="grid gap-4" @submit.prevent="createMember">
      <label>
        <span class="text-sm font-medium text-slate-700">Команда</span>
        <select
          v-model="newMemberForm.teamId"
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
        <span class="text-sm font-medium text-slate-700">Имя</span>
        <input
          v-model="newMemberForm.name"
          required
          placeholder="Alex Backend"
          class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
        />
      </label>

      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <label>
          <span class="text-sm font-medium text-slate-700">Роль</span>
          <select
            v-model="newMemberForm.role"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          >
            <option v-for="role in roleOptions" :key="role.value" :value="role.value">
              {{ role.label }}
            </option>
          </select>
        </label>

        <label>
          <span class="text-sm font-medium text-slate-700">Часов в день</span>
          <input
            v-model.number="newMemberForm.availableHoursPerDay"
            min="0"
            max="12"
            step="0.25"
            type="number"
            class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
          />
        </label>
      </div>

      <fieldset>
        <legend class="text-sm font-medium text-slate-700">Календарь встреч, минут в день</legend>
        <p class="mt-1 text-xs text-slate-500">
          До {{ CALENDAR_MEETING_BUFFER_MINUTES }} мин/день уже заложено в процесс и не уменьшает
          доступность.
        </p>
        <div class="mt-2 grid grid-cols-5 gap-2">
          <label v-for="day in weekdayOptions" :key="day.value" class="min-w-0">
            <span class="text-xs text-slate-500">{{ day.label }}</span>
            <input
              v-model.number="newMemberForm.meetings[day.value]"
              min="0"
              :max="CALENDAR_WORK_DAY_MINUTES"
              step="15"
              type="number"
              class="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-950 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
          </label>
        </div>
      </fieldset>

      <button
        type="submit"
        :disabled="!planningStore.teams.length"
        class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
      >
        Добавить участника
      </button>
    </form>
  </AppModal>
</template>
