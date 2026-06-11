<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import AppConfirmDialog from '@/components/AppConfirmDialog.vue'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useDataExchange, type ImportDraft } from '@/composables/useDataExchange'
import { useReviewPrompt } from '@/composables/useReviewPrompt'
import { usePlanningStore } from '@/stores/planning'

const route = useRoute()
const planningStore = usePlanningStore()
const confirmDialog = useConfirmDialog()
const { prepareImportFromText, prepareImportFromFile, applyImportDraft, exportFullBackup } =
  useDataExchange()
const { showPrompt: showReviewPrompt, openForm: openReviewForm, dismiss: dismissReviewPrompt } = useReviewPrompt()

// ─── Onboarding: version-based ─────────────────────────────────────────────
// Store the major version of the app when the user dismisses onboarding.
// If the major version changes (new major release), onboarding is shown again.
const APP_MAJOR = (import.meta.env.APP_VERSION ?? '0').split('.')[0]!
const ONBOARDING_SEEN_VERSION_KEY = 'team-planning:onboarding-seen-version'

const getSeenMajor = () =>
  typeof window !== 'undefined'
    ? (window.localStorage.getItem(ONBOARDING_SEEN_VERSION_KEY) ?? '')
    : APP_MAJOR

const hashImportMessage = ref('')
const isDraggingImportFile = ref(false)
const dragDepth = ref(0)
const onboardingSlideIndex = ref(0)
const isOnboardingDismissed = ref(getSeenMajor() === APP_MAJOR)

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
      showMessage('Импорт отменен.')
      return
    }

    if (choice === 'backup') {
      exportFullBackup()
    }
  }

  const result = applyImportDraft(draft)
  showMessage(result.message)
}

onMounted(async () => {
  const hash = window.location.hash

  // AllocationReportView handles its own #import= locally (no store writes),
  // so App.vue must not process it here.
  if (startsOnReportPath) return

  if (!hash.startsWith('#import=')) return
  try {
    const encoded = decodeURIComponent(hash.slice('#import='.length))
    const preparation = prepareImportFromText(encoded)
    // Clean up hash without reloading
    history.replaceState(null, '', window.location.pathname + window.location.search)

    if (!preparation.success || !preparation.draft) {
      showMessage(preparation.message)
      return
    }

    await applyImportWithConfirmation(preparation.draft)
  } catch {
    showMessage('Не удалось импортировать данные из ссылки.')
  }
})

const navigationItems = [
  { label: 'Обзор', routeName: 'home' },
  { label: 'Спринты', routeName: 'sprints' },
  { label: 'Команды', routeName: 'teams' },
  { label: 'Отпуска', routeName: 'vacations' },
  { label: 'Импорт/экспорт', routeName: 'data' },
]

const teamCount = computed(() => planningStore.teams.length)

const headerSubtitle = computed(() => {
  const n = teamCount.value
  if (n === 0) return 'Нет команд'
  if (n === 1) return planningStore.teams[0]!.name
  if (n <= 4) return `${n} команды`
  return `${n} команд`
})

const isReportView = computed(() => route.meta.reportView === true)

// Eagerly check the URL path so we never flash the onboarding on report links,
// even before the async route chunk has resolved and set route.meta.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const startsOnReportPath =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith(`${BASE}/reports/`)

const shouldShowOnboarding = computed(
  () => !startsOnReportPath && !isReportView.value && !isOnboardingDismissed.value,
)

const onboardingSlides = [
  {
    eyebrow: '1 / 4',
    title: 'Сначала опишите команду',
    body: 'Заведите участников, роли, дневную доступность и регулярные встречи. Эти данные станут capacity для всех спринтов.',
    exampleTitle: 'Пример команды',
    exampleLines: ['Backend · 6 ч/день', 'Frontend · 6 ч/день', 'QA · 5 ч/день, встречи по Пн/Ср'],
  },
  {
    eyebrow: '2 / 4',
    title: 'Потом соберите спринт',
    body: 'В спринте добавляются story/prod bug, epics, зависимости, оценки по направлениям и ответственные. Оценки можно вводить как 2д 3ч 15м.',
    exampleTitle: 'Пример задачи',
    exampleLines: ['Backend 1д · Docs 2ч', 'Frontend 4ч · QA testing 3ч', 'Design review 45м'],
  },
  {
    eyebrow: '3 / 4',
    title: 'Запустите распределение',
    body: 'Планировщик раскладывает этапы по рабочим дням, учитывает отпуска, встречи, зависимости и release support.',
    exampleTitle: 'Что проверяется',
    exampleLines: [
      'Автоназначения без изменения исходных задач',
      'Загрузка от 80% capacity',
      'Прогноз работы после спринта',
    ],
  },
  {
    eyebrow: '4 / 4',
    title: 'Смотрите Gantt и отчет',
    body: 'Timeline показывает, кто и когда занят. Отчет можно открыть отдельно для скриншота или отправить коллегам по прямой ссылке.',
    exampleTitle: 'Что вы увидите',
    exampleLines: [
      'Ганtt по каждому участнику с разбивкой по дням',
      'Предупреждения: перегруз, задачи за спринт, конфликты',
      'Ссылка на отчёт — без регистрации и установки',
    ],
  },
]

const currentOnboardingSlide = computed(() => onboardingSlides[onboardingSlideIndex.value]!)

const isRouteActive = (routeName: string) => {
  if (routeName === 'sprints') {
    return route.name === 'sprints' || route.name === 'sprint-planning'
  }

  return route.name === routeName
}

const showMessage = (message: string) => {
  hashImportMessage.value = message
  setTimeout(() => {
    hashImportMessage.value = ''
  }, 5000)
}

const hasDraggedFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

const handleDragEnter = (event: DragEvent) => {
  if (isReportView.value || !hasDraggedFiles(event)) return
  dragDepth.value += 1
  isDraggingImportFile.value = true
}

const handleDragLeave = (event: DragEvent) => {
  if (isReportView.value || !hasDraggedFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) {
    isDraggingImportFile.value = false
  }
}

const handleDrop = async (event: DragEvent) => {
  if (isReportView.value || !hasDraggedFiles(event)) return
  dragDepth.value = 0
  isDraggingImportFile.value = false
  const file = event.dataTransfer?.files?.[0]
  if (!file) return
  const preparation = await prepareImportFromFile(file)
  if (!preparation.success || !preparation.draft) {
    showMessage(preparation.message)
    return
  }
  await applyImportWithConfirmation(preparation.draft)
}

const dismissOnboarding = () => {
  isOnboardingDismissed.value = true
  window.localStorage.setItem(ONBOARDING_SEEN_VERSION_KEY, APP_MAJOR)
}

const openNextOnboardingSlide = () => {
  if (onboardingSlideIndex.value >= onboardingSlides.length - 1) {
    dismissOnboarding()
    return
  }

  onboardingSlideIndex.value += 1
}

const openPreviousOnboardingSlide = () => {
  onboardingSlideIndex.value = Math.max(0, onboardingSlideIndex.value - 1)
}

const loadDemoAndCloseOnboarding = () => {
  planningStore.resetToSeedState()
  dismissOnboarding()
  showMessage('Демо-данные загружены. Удалить их можно в разделе «Импорт/экспорт» -> «Очистить рабочую область».')
}

const bugReportMailto = computed(() => {
  const subject = encodeURIComponent('Сообщение об ошибке — Team Planning')
  const body = encodeURIComponent(
    'Опишите проблему или что работает неожиданно:\n\n\n' +
      '——————————————\n' +
      'Можно приложить скриншоты или файл экспорта (.tpdata) из раздела «Импорт/экспорт».\n\n' +
      'Страница: ' +
      window.location.href,
  )
  return `mailto:upachko@gmail.com?subject=${subject}&body=${body}`
})
</script>

<template>
  <div
    class="app-shell text-slate-800"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <header
      v-if="!isReportView"
      class="border-b border-teal-100/80 bg-white/88 shadow-sm backdrop-blur"
    >
      <div class="h-1 bg-gradient-to-r from-teal-500 via-sky-500 to-amber-400"></div>
      <div class="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-4 sm:px-8 lg:px-12">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <RouterLink :to="{ name: 'home' }" class="min-w-0">
            <p class="text-sm font-bold tracking-normal text-teal-700 uppercase">Team planning</p>
            <p class="mt-1 truncate text-lg font-semibold text-slate-950">
              {{ headerSubtitle }}
            </p>
          </RouterLink>

          <dl class="grid grid-cols-3 gap-3 text-sm sm:w-auto sm:grid-cols-3">
            <div class="muted-metric">
              <dt class="text-sky-700">Команды</dt>
              <dd class="font-semibold text-sky-950">{{ planningStore.teams.length }}</dd>
            </div>
            <div class="muted-metric">
              <dt class="text-emerald-700">Спринты</dt>
              <dd class="font-semibold text-emerald-950">{{ planningStore.sprints.length }}</dd>
            </div>
            <div class="muted-metric">
              <dt class="text-amber-700">Задачи</dt>
              <dd class="font-semibold text-amber-950">{{ planningStore.workItems.length }}</dd>
            </div>
          </dl>
        </div>

        <div class="flex items-center justify-between gap-3">
          <nav class="flex gap-2 overflow-x-auto pb-1" aria-label="Основная навигация">
            <RouterLink
              v-for="item in navigationItems"
              :key="item.routeName"
              :to="{ name: item.routeName }"
              class="rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition"
              :class="
                isRouteActive(item.routeName)
                  ? 'bg-teal-700 text-white shadow-sm shadow-teal-700/20'
                  : 'text-slate-600 hover:bg-teal-50 hover:text-teal-800'
              "
            >
              {{ item.label }}
            </RouterLink>
          </nav>
          <div class="flex shrink-0 items-center gap-3">
            <button
              type="button"
              class="text-[11px] text-slate-300 transition hover:text-slate-500"
              @click="openReviewForm"
            >Оставить отзыв</button>
            <span class="text-[11px] text-slate-200" aria-hidden="true">·</span>
            <a
              :href="bugReportMailto"
              class="text-[11px] text-slate-300 transition hover:text-slate-500"
            >Сообщить об ошибке</a>
          </div>
        </div>
      </div>
    </header>

    <RouterView />
    <AppConfirmDialog />

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="shouldShowOnboarding"
        class="fixed inset-0 z-30 grid place-items-center bg-slate-950/50 p-5"
      >
        <section class="surface-card w-full max-w-3xl overflow-hidden rounded-lg shadow-2xl">
          <div class="grid gap-0 md:grid-cols-[minmax(0,1fr)_300px]">
            <div class="p-6 sm:p-8">
              <p class="text-sm font-bold text-teal-700 uppercase">
                {{ currentOnboardingSlide.eyebrow }}
              </p>
              <h2 class="mt-3 text-2xl font-bold text-slate-950">
                {{ currentOnboardingSlide.title }}
              </h2>
              <p class="mt-4 text-base leading-7 text-slate-600">
                {{ currentOnboardingSlide.body }}
              </p>

              <div class="mt-6 flex gap-2">
                <span
                  v-for="(_, index) in onboardingSlides"
                  :key="index"
                  class="h-2 flex-1 rounded-full"
                  :class="
                    index === onboardingSlideIndex
                      ? 'bg-gradient-to-r from-teal-600 to-sky-500'
                      : 'bg-slate-200'
                  "
                ></span>
              </div>
            </div>

            <div
              class="border-t border-teal-100 bg-gradient-to-br from-teal-50 to-amber-50 p-6 md:border-t-0 md:border-l"
            >
              <p class="text-sm font-semibold text-slate-950">
                {{ currentOnboardingSlide.exampleTitle }}
              </p>
              <ul class="mt-4 grid gap-3 text-sm">
                <li
                  v-for="line in currentOnboardingSlide.exampleLines"
                  :key="line"
                  class="rounded-lg border border-white/80 bg-white/80 px-3 py-2 font-medium text-slate-700 shadow-sm"
                >
                  {{ line }}
                </li>
              </ul>
            </div>
          </div>

          <div class="border-t border-slate-200 px-5 py-3 text-center text-xs text-slate-400">
            Все данные хранятся только в вашем браузере — без сервера и регистрации.
          </div>

          <div
            class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 p-5"
          >
            <div class="flex flex-wrap gap-2">
              <button
                type="button"
                :disabled="onboardingSlideIndex === 0"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
                @click="openPreviousOnboardingSlide"
              >
                Назад
              </button>
              <button
                type="button"
                class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                @click="dismissOnboarding"
              >
                Пропустить
              </button>
            </div>
            <div class="flex flex-wrap gap-2">
              <button
                v-if="onboardingSlideIndex < onboardingSlides.length - 1"
                type="button"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
                @click="openNextOnboardingSlide"
              >
                Дальше
              </button>
              <button
                v-else
                type="button"
                class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
                @click="loadDemoAndCloseOnboarding"
              >
                Загрузить демо
              </button>
            </div>
          </div>
        </section>
      </div>
    </Transition>

    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="isDraggingImportFile && !isReportView"
        class="fixed inset-0 z-40 grid place-items-center bg-slate-950/40 p-6"
      >
        <div
          class="w-full max-w-md rounded-lg border border-dashed border-white/70 bg-white p-8 text-center shadow-xl"
        >
          <p class="text-base font-semibold text-slate-950">Импорт данных</p>
          <p class="mt-2 text-sm text-slate-600">Отпустите .tpdata или JSON-файл для загрузки.</p>
        </div>
      </div>
    </Transition>

    <!-- Hash-import notification -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-if="hashImportMessage"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-slate-950 px-5 py-3 text-sm font-medium text-white shadow-lg"
      >
        {{ hashImportMessage }}
      </div>
    </Transition>

    <!-- Review prompt toast -->
    <Transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="translate-y-4 opacity-0"
      leave-active-class="transition duration-200 ease-in"
      leave-to-class="translate-y-4 opacity-0"
    >
      <div
        v-if="showReviewPrompt"
        class="fixed right-5 bottom-5 z-50 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
      >
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm font-semibold text-slate-950">Как вам инструмент?</p>
          <button
            type="button"
            class="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Закрыть"
            @click="dismissReviewPrompt"
          >
            ✕
          </button>
        </div>
        <p class="mt-1 text-sm text-slate-600">
          Если удобно, оставьте отзыв — это помогает сделать планирование лучше.
        </p>
        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="primary-action rounded-lg px-3 py-2 text-sm font-medium transition"
            @click="openReviewForm"
          >
            Оставить отзыв
          </button>
          <button
            type="button"
            class="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            @click="dismissReviewPrompt"
          >
            Не сейчас
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
