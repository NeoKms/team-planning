<script setup lang="ts">
import { computed, ref } from 'vue'

import { formatDate } from '@/domain/planning'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useDataExchange, type ImportDraft } from '@/composables/useDataExchange'
import { usePlanningStore } from '@/stores/planning'

const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()
const {
  status,
  exportFull,
  exportTeam,
  exportSprint,
  exportAllocationResult,
  exportFullBackup,
  prepareImportFromFile,
  applyImportDraft,
} = useDataExchange()

const importInput = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)

const teamNameById = computed(() =>
  Object.fromEntries(planningStore.teams.map((team) => [team.id, team.name])),
)

const sprintExportOptions = computed(() =>
  planningStore.sprints.map((sprint) => ({
    ...sprint,
    teamName: teamNameById.value[sprint.teamId] ?? 'Команда не найдена',
    hasAllocation: planningStore.allocationResults.some((result) => result.sprintId === sprint.id),
  })),
)

const applyImportWithConfirmation = async (draft: ImportDraft) => {
  if (draft.requiresConfirmation) {
    const message = draft.destructive
      ? [
          'Текущие данные будут потеряны после применения этого импорта.',
          ...draft.conflictMessages,
          'Перед импортом можно скачать резервную копию текущей рабочей области.',
        ].join('\n')
      : [
          'В импортируемом файле найдены совпадения с текущими данными.',
          ...draft.conflictMessages,
          'Импорт будет добавлен как копия, текущие данные не затираются.',
        ].join('\n')

    const choice = await confirmDialog.choose({
      title: draft.destructive ? 'Импорт заменит текущие данные' : 'Найдены совпадения при импорте',
      message,
      cancelLabel: 'Отмена',
      actions: [
        {
          label: 'Резервная копия и импорт',
          value: 'backup',
        },
        {
          label: 'Импорт без копии',
          value: 'import',
          tone: draft.destructive ? 'danger' : 'default',
        },
      ],
    })

    if (!choice) {
      status.value = 'Импорт отменен.'
      return
    }

    if (choice === 'backup') {
      exportFullBackup()
    }
  }

  const result = applyImportDraft(draft)
  status.value = result.message
}

const importFile = async (file: File | undefined) => {
  if (!file) return
  const preparation = await prepareImportFromFile(file)
  if (!preparation.success || !preparation.draft) {
    status.value = preparation.message
    return
  }

  await applyImportWithConfirmation(preparation.draft)
}

const handleFileChange = async (event: Event) => {
  const input = event.target as HTMLInputElement
  await importFile(input.files?.[0])
  input.value = ''
}

const handleDrop = async (event: DragEvent) => {
  isDragging.value = false
  await importFile(event.dataTransfer?.files?.[0])
}

const resetToDemo = async () => {
  const confirmed = await confirmDialog.confirm({
    title: 'Загрузить демо-данные?',
    message: 'Текущая рабочая область будет заменена seed-состоянием для проверки сценариев.',
    confirmLabel: 'Загрузить демо',
    tone: 'danger',
  })

  if (!confirmed) return

  planningStore.resetToSeedState()
  status.value = 'Демо-данные загружены.'
}

const clearWorkspace = async () => {
  const confirmed = await confirmDialog.confirm({
    title: 'Очистить рабочую область?',
    message: 'Будут удалены команды, участники, спринты, задачи, отпуска и результаты расчетов.',
    confirmLabel: 'Очистить',
    tone: 'danger',
  })

  if (!confirmed) return

  planningStore.clearState()
  status.value = 'Рабочая область очищена.'
}
</script>

<template>
  <main class="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
    <header class="border-b border-slate-200 pb-6">
      <p class="text-sm font-bold text-slate-500 uppercase">Импорт/экспорт</p>
      <h1 class="mt-2 text-3xl font-bold text-slate-950">Импорт и экспорт</h1>
      <p class="mt-3 max-w-2xl text-base text-slate-600">
        Управляйте переносом client-only данных между браузерами и быстро возвращайтесь к
        демо-сценарию.
      </p>
    </header>

    <section class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="grid gap-4">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-slate-950">Полная рабочая область</h2>
              <p class="mt-1 text-sm text-slate-600">
                Экспортирует все команды, участников, отпуска, спринты, задачи и сохраненные
                расчеты.
              </p>
            </div>
            <button
              type="button"
              class="w-fit rounded-lg bg-slate-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
              @click="exportFull"
            >
              Экспорт всего
            </button>
          </div>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">Команды</h2>
          <div v-if="planningStore.teams.length" class="mt-4 grid gap-3">
            <article
              v-for="team in planningStore.teams"
              :key="team.id"
              class="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div class="min-w-0">
                <h3 class="font-semibold text-slate-950">{{ team.name }}</h3>
                <p class="mt-1 text-sm text-slate-600">
                  {{ planningStore.members.filter((member) => member.teamId === team.id).length }}
                  участников
                </p>
              </div>
              <button
                type="button"
                class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="exportTeam(team.id)"
              >
                Экспорт команды
              </button>
            </article>
          </div>
          <p v-else class="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
            Команд пока нет.
          </p>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-lg font-semibold text-slate-950">Спринты и расчеты</h2>
          <div v-if="sprintExportOptions.length" class="mt-4 grid gap-3">
            <article
              v-for="sprint in sprintExportOptions"
              :key="sprint.id"
              class="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center"
            >
              <div class="min-w-0">
                <h3 class="font-semibold text-slate-950">{{ sprint.name }}</h3>
                <p class="mt-1 text-sm text-slate-600">
                  {{ sprint.teamName }} · старт {{ formatDate(sprint.startsOn) }} ·
                  {{ sprint.durationWeeks }} нед.
                </p>
              </div>
              <div class="flex flex-wrap gap-2 xl:justify-end">
                <button
                  type="button"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                  @click="exportSprint(sprint.id)"
                >
                  Экспорт спринта
                </button>
                <button
                  type="button"
                  :disabled="!sprint.hasAllocation"
                  class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  @click="exportAllocationResult(sprint.id)"
                >
                  Экспорт расчета
                </button>
              </div>
            </article>
          </div>
          <p v-else class="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
            Спринтов пока нет.
          </p>
        </section>
      </div>

      <aside class="grid gap-4 lg:content-start">
        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-base font-semibold text-slate-950">Импорт</h2>
          <button
            type="button"
            class="mt-4 w-full rounded-lg border border-dashed px-4 py-8 text-center transition"
            :class="
              isDragging
                ? 'border-slate-500 bg-slate-100 text-slate-950'
                : 'border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100'
            "
            @click="importInput?.click()"
            @dragenter.prevent="isDragging = true"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent.stop="handleDrop"
          >
            <span class="block text-sm font-semibold">Перетащите .tpdata сюда</span>
            <span class="mt-1 block text-xs">или выберите файл</span>
          </button>
          <input
            ref="importInput"
            class="hidden"
            type="file"
            accept=".tpdata,.json,text/plain"
            @change="handleFileChange"
          />
          <p v-if="status" class="mt-3 text-sm font-medium text-slate-600">
            {{ status }}
          </p>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-base font-semibold text-slate-950">Состояние</h2>
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-lg bg-slate-50 p-3">
              <dt class="text-slate-500">Команды</dt>
              <dd class="mt-1 font-semibold text-slate-950">{{ planningStore.teams.length }}</dd>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <dt class="text-slate-500">Спринты</dt>
              <dd class="mt-1 font-semibold text-slate-950">{{ planningStore.sprints.length }}</dd>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <dt class="text-slate-500">Задачи</dt>
              <dd class="mt-1 font-semibold text-slate-950">{{ planningStore.workItems.length }}</dd>
            </div>
            <div class="rounded-lg bg-slate-50 p-3">
              <dt class="text-slate-500">Расчеты</dt>
              <dd class="mt-1 font-semibold text-slate-950">
                {{ planningStore.allocationResults.length }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 class="text-base font-semibold text-slate-950">Быстрые действия</h2>
          <div class="mt-4 grid gap-2">
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              @click="resetToDemo"
            >
              Загрузить демо-данные
            </button>
            <button
              type="button"
              class="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50"
              @click="clearWorkspace"
            >
              Очистить рабочую область
            </button>
          </div>
        </section>
      </aside>
    </section>
  </main>
</template>
