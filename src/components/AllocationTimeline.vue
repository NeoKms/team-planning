<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  type AllocationTimelineBar,
  type AllocationTimelineRow,
  type WorkItemNavItem,
} from '@/composables/useAllocationReport'
import { formatDate } from '@/domain/planning'

const props = withDefaults(
  defineProps<{
    displayDates: string[]
    sprintWorkingDateSet: Set<string>
    timelineRows: AllocationTimelineRow[]
    vacationDatesByMemberId?: Map<string, Set<string>>
    formatDateLabel: (date: string) => string
    formatMinutes: (minutes: number) => string
    initialShowLabels?: boolean
    showModeToggle?: boolean
    navItems?: WorkItemNavItem[]
  }>(),
  {
    initialShowLabels: true,
    showModeToggle: true,
  },
)

const showLabels = ref(props.initialShowLabels)
const activeTooltipSlotId = ref<string>()
const labeledLaneHeight = 76
const labeledRowPadding = 24
const compactRowHeight = 44

// ─── Selection state ────────────────────────────────────────────────────────
const selectedWorkItemId = ref<string | null>(null)
const selectedEpicId = ref<string | null>(null)
const selectionClickCount = ref(0)
const shimmerDisabled = computed(() => selectionClickCount.value >= 3)

const hasSelection = computed(() => selectedWorkItemId.value !== null || selectedEpicId.value !== null)

const isBarSelected = (bar: AllocationTimelineBar) => {
  if (selectedEpicId.value !== null) return bar.epicId === selectedEpicId.value
  if (selectedWorkItemId.value !== null) return bar.slot.workItemId === selectedWorkItemId.value
  return true
}

const selectBar = (bar: AllocationTimelineBar) => {
  selectionClickCount.value += 1
  if (bar.epicId) {
    if (selectedEpicId.value === bar.epicId) {
      selectedEpicId.value = null
    } else {
      selectedEpicId.value = bar.epicId
      selectedWorkItemId.value = null
    }
  } else {
    const id = bar.slot.workItemId
    if (selectedWorkItemId.value === id) {
      selectedWorkItemId.value = null
    } else {
      selectedWorkItemId.value = id
      selectedEpicId.value = null
    }
  }
}

const clearSelection = () => {
  selectedWorkItemId.value = null
  selectedEpicId.value = null
}

const selectedLabel = computed(() => {
  if (!hasSelection.value) return ''
  for (const row of props.timelineRows) {
    for (const bar of row.bars) {
      if (isBarSelected(bar)) return bar.title
    }
  }
  return ''
})
// ────────────────────────────────────────────────────────────────────────────

// ─── Task Navigator ──────────────────────────────────────────────────────────
const navOpen = ref(false)
const navContainerRef = ref<HTMLElement | null>(null)

const workItemTypeLabel = (type: WorkItemNavItem['type']) =>
  type === 'prod-bug' ? 'Bug' : 'Story'

const navGroups = computed(() => {
  const items = props.navItems ?? []
  const epicMap = new Map<string, { epicId: string; epicTitle: string; items: WorkItemNavItem[] }>()
  const standalone: WorkItemNavItem[] = []

  for (const item of items) {
    if (item.epicId) {
      if (!epicMap.has(item.epicId)) {
        epicMap.set(item.epicId, {
          epicId: item.epicId,
          epicTitle: item.epicTitle ?? item.epicId,
          items: [],
        })
      }
      epicMap.get(item.epicId)!.items.push(item)
    } else {
      standalone.push(item)
    }
  }

  return { standalone, epics: [...epicMap.values()] }
})

const navigateTo = (item: WorkItemNavItem) => {
  navOpen.value = false
  selectionClickCount.value += 1
  if (item.epicId) {
    selectedEpicId.value = item.epicId
    selectedWorkItemId.value = null
  } else {
    selectedWorkItemId.value = item.id
    selectedEpicId.value = null
  }
}

const closeNavOnOutsideClick = (event: MouseEvent) => {
  if (navContainerRef.value && !navContainerRef.value.contains(event.target as Node)) {
    navOpen.value = false
  }
}

const closeNavOnEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') navOpen.value = false
}

onMounted(() => {
  document.addEventListener('mousedown', closeNavOnOutsideClick)
  document.addEventListener('keydown', closeNavOnEscape)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', closeNavOnOutsideClick)
  document.removeEventListener('keydown', closeNavOnEscape)
})
// ────────────────────────────────────────────────────────────────────────────

const getRowHeight = (laneCount: number) =>
  showLabels.value
    ? `${labeledRowPadding + laneCount * labeledLaneHeight}px`
    : `${compactRowHeight}px`
const getBarTop = (laneIndex: number) =>
  showLabels.value ? `${12 + laneIndex * labeledLaneHeight}px` : '16px'
const getLabelTop = (laneIndex: number) => `${30 + laneIndex * labeledLaneHeight}px`
const getLabelLeft = (leftPercent: number) => `calc(${leftPercent}% + 8px)`
const getLabelWidth = (widthPercent: number) => `calc(${widthPercent}% - 16px)`
const getCompactHitWidth = (widthPercent: number) => `max(${widthPercent}%, 16px)`
const compactTooltipTop = '38px'
const showTooltip = (slotId: string) => {
  activeTooltipSlotId.value = slotId
}
const hideTooltip = (slotId: string) => {
  if (activeTooltipSlotId.value === slotId) {
    activeTooltipSlotId.value = undefined
  }
}
const getVacationBars = (memberId: string) => {
  const vacDates = props.vacationDatesByMemberId?.get(memberId)
  if (!vacDates || !vacDates.size) return []
  const dayCount = Math.max(props.displayDates.length, 1)
  return props.displayDates
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => vacDates.has(date))
    .map(({ date, index }) => ({
      date,
      leftPercent: (index / dayCount) * 100,
      widthPercent: (1 / dayCount) * 100,
    }))
}
</script>

<template>
  <div class="max-w-full">
    <div class="mb-3 flex items-center justify-between gap-3">
      <!-- Selection indicator -->
      <Transition
        mode="out-in"
        enter-active-class="transition duration-150 ease-out"
        enter-from-class="opacity-0 -translate-y-1"
        leave-active-class="transition duration-100 ease-in"
        leave-to-class="opacity-0 -translate-y-1"
      >
        <div v-if="hasSelection" class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-teal-800">
            {{ selectedLabel }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
            @click="clearSelection"
          >
            ✕ Снять выделение
          </button>
        </div>
        <div v-else class="hint-shimmer text-xs" :class="{ 'shimmer-off': shimmerDisabled }">Нажмите на задачу в таймлайне для выделения</div>
      </Transition>

      <!-- Right controls -->
      <div class="flex shrink-0 items-center gap-2">
        <!-- Task navigator -->
        <div v-if="navItems?.length" ref="navContainerRef" class="relative">
          <button
            type="button"
            class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            :class="navOpen ? 'border-teal-300 bg-teal-50 text-teal-800' : ''"
            :title="'Навигатор задач'"
            @click.stop="navOpen = !navOpen"
          >
            ≡
          </button>

          <!-- Dropdown -->
          <div
            v-if="navOpen"
            class="absolute right-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-2 shadow-lg ring-1 ring-slate-950/5"
            @click.stop
          >
            <p class="mb-1 px-3 pt-1 pb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
              Задачи спринта
            </p>

            <!-- Standalone items (no epic) -->
            <template v-if="navGroups.standalone.length">
              <button
                v-for="item in navGroups.standalone"
                :key="item.id"
                type="button"
                class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                :class="
                  (selectedWorkItemId === item.id && !item.epicId) ||
                  (selectedEpicId !== null && false)
                    ? 'bg-teal-50 text-teal-900'
                    : 'text-slate-800'
                "
                @click="navigateTo(item)"
              >
                <span
                  class="mt-0.5 shrink-0 rounded px-1 py-0.5 text-xs font-semibold"
                  :class="item.type === 'prod-bug' ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'"
                >
                  {{ workItemTypeLabel(item.type) }}
                </span>
                <span class="min-w-0 truncate font-medium">{{ item.title }}</span>
                <span class="ml-auto shrink-0 text-xs text-slate-400">P{{ item.priority }}</span>
              </button>
            </template>

            <!-- Epic groups -->
            <template v-if="navGroups.epics.length">
              <div v-for="epicGroup in navGroups.epics" :key="epicGroup.epicId" class="mt-1">
                <p class="px-3 pt-2 pb-1 text-xs font-semibold text-slate-500">
                  {{ epicGroup.epicTitle }}
                </p>
                <button
                  v-for="item in epicGroup.items"
                  :key="item.id"
                  type="button"
                  class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-slate-50"
                  :class="
                    selectedEpicId === item.epicId
                      ? 'bg-teal-50 text-teal-900'
                      : 'text-slate-800'
                  "
                  @click="navigateTo(item)"
                >
                  <span
                    class="mt-0.5 shrink-0 rounded px-1 py-0.5 text-xs font-semibold"
                    :class="item.type === 'prod-bug' ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-700'"
                  >
                    {{ workItemTypeLabel(item.type) }}
                  </span>
                  <span class="min-w-0 truncate font-medium">{{ item.title }}</span>
                  <span class="ml-auto shrink-0 text-xs text-slate-400">P{{ item.priority }}</span>
                </button>
              </div>
            </template>
          </div>
        </div>

        <button
          v-if="props.showModeToggle"
          type="button"
          class="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          @click="showLabels = !showLabels"
        >
          {{ showLabels ? 'Скрыть подписи' : 'Показать подписи' }}
        </button>
      </div>
    </div>

    <div class="max-h-[72vh] overflow-auto pb-2 pr-1" @click="clearSelection">
      <div
        class="min-w-[1120px]"
        :style="{ width: `${Math.max(1120, displayDates.length * 280 + 220)}px` }"
      >
        <div class="grid grid-cols-[200px_minmax(0,1fr)] gap-3">
          <div
            class="sticky top-0 left-0 z-40 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500 uppercase shadow-sm"
          >
            Участник
          </div>
          <div
            class="sticky top-0 z-20 grid"
            :style="{ gridTemplateColumns: `repeat(${displayDates.length}, minmax(0, 1fr))` }"
          >
            <div
              v-for="date in displayDates"
              :key="date"
              class="border-l px-3 py-2 text-sm font-semibold first:rounded-l-lg last:rounded-r-lg"
              :class="
                sprintWorkingDateSet.has(date)
                  ? 'border-slate-200 bg-slate-100 text-slate-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              "
            >
              {{ formatDateLabel(date) }}
              <span v-if="!sprintWorkingDateSet.has(date)" class="ml-1 text-xs font-medium"
                >overflow</span
              >
            </div>
          </div>

          <template v-for="row in timelineRows" :key="row.member.id">
            <div
              class="sticky left-0 z-30 rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-[8px_0_16px_-16px_rgba(15,23,42,0.45)]"
            >
              <p class="truncate font-semibold text-slate-950">{{ row.member.name }}</p>
              <p class="mt-1 text-xs text-slate-500">
                <template v-if="row.isExternal">
                  {{ formatMinutes(row.assignedMinutes) }}
                </template>
                <template v-else>
                  {{ formatMinutes(row.assignedMinutes) }} /
                  {{ formatMinutes(row.capacityMinutes) }}
                </template>
              </p>
            </div>
            <div
              class="relative rounded-lg border border-slate-200 bg-white"
              :class="showLabels ? 'overflow-hidden' : 'overflow-visible'"
              :style="{ minHeight: getRowHeight(row.laneCount) }"
            >
              <!-- Column backgrounds (overflow = red, vacation = gray, normal = white) -->
              <div
                class="absolute inset-0 grid"
                :style="{ gridTemplateColumns: `repeat(${displayDates.length}, 1fr)` }"
              >
                <div
                  v-for="date in displayDates"
                  :key="`${row.member.id}-${date}`"
                  class="border-l first:border-l-0"
                  :class="
                    !sprintWorkingDateSet.has(date)
                      ? 'border-red-100 bg-red-50/60'
                      : vacationDatesByMemberId?.get(row.member.id)?.has(date)
                        ? 'border-slate-200 bg-slate-100/70'
                        : 'border-slate-100'
                  "
                ></div>
              </div>

              <!-- Vacation bars (gray, full-day width, lane 0 position) -->
              <div
                v-for="vacBar in getVacationBars(row.member.id)"
                :key="`vac-${row.member.id}-${vacBar.date}`"
                class="absolute rounded-full bg-slate-400/50 shadow-sm ring-1 ring-slate-300/40"
                :class="showLabels ? 'h-3' : 'h-4'"
                :style="{
                  top: getBarTop(0),
                  left: `${vacBar.leftPercent}%`,
                  width: `${vacBar.widthPercent}%`,
                }"
                :title="`${row.member.name}: отпуск (${formatDate(vacBar.date)})`"
              ></div>
              <!-- Vacation label (labeled mode) -->
              <template v-if="showLabels">
                <div
                  v-for="vacBar in getVacationBars(row.member.id)"
                  :key="`vac-label-${row.member.id}-${vacBar.date}`"
                  class="absolute h-11 overflow-hidden rounded-md border border-slate-200 bg-slate-50/95 px-2 py-1.5 text-left text-xs text-slate-500 shadow-sm"
                  :style="{
                    top: getLabelTop(0),
                    left: getLabelLeft(vacBar.leftPercent),
                    width: getLabelWidth(vacBar.widthPercent),
                  }"
                >
                  <p class="truncate font-semibold text-slate-600">Отпуск</p>
                  <p class="mt-0.5 truncate text-slate-400">{{ formatDate(vacBar.date) }}</p>
                </div>
              </template>

              <div v-for="bar in row.bars" :key="bar.slot.id">
                <!-- Bar pill -->
                <div
                  class="absolute rounded-full shadow-sm transition-opacity"
                  :class="[
                    bar.toneClass,
                    showLabels ? 'h-3 cursor-pointer' : 'h-4',
                    bar.isOverflow ? 'outline outline-2 outline-offset-2 outline-red-300' : '',
                    hasSelection && !isBarSelected(bar) ? 'opacity-20' : 'ring-1 ring-black/5',
                    hasSelection && isBarSelected(bar) ? 'ring-2 ring-white/80' : '',
                  ]"
                  :style="{
                    top: getBarTop(bar.laneIndex),
                    left: `${bar.leftPercent}%`,
                    width: `${bar.widthPercent}%`,
                  }"
                  :tabindex="-1"
                  :title="`${bar.title}: ${formatMinutes(bar.slot.minutes)}`"
                  @click.stop="selectBar(bar)"
                ></div>

                <!-- Compact mode: hit zone + tooltip -->
                <button
                  v-if="!showLabels"
                  type="button"
                  class="absolute z-20 cursor-pointer rounded-full bg-transparent"
                  :style="{
                    top: '10px',
                    left: `${bar.leftPercent}%`,
                    width: getCompactHitWidth(bar.widthPercent),
                    height: '28px',
                  }"
                  :title="`${bar.title}: ${formatMinutes(bar.slot.minutes)}`"
                  @blur="hideTooltip(bar.slot.id)"
                  @click.stop="selectBar(bar); showTooltip(bar.slot.id)"
                  @focus="showTooltip(bar.slot.id)"
                  @mouseenter="showTooltip(bar.slot.id)"
                  @mouseleave="hideTooltip(bar.slot.id)"
                >
                  <span class="sr-only">
                    {{ bar.title }}: {{ formatMinutes(bar.slot.minutes) }}
                  </span>
                </button>

                <!-- Labeled mode: label card (clickable) -->
                <div
                  v-if="showLabels"
                  class="absolute h-11 cursor-pointer select-none overflow-hidden rounded-md border px-2 py-1.5 text-left text-xs shadow-sm transition-opacity"
                  :class="[
                    hasSelection && isBarSelected(bar)
                      ? 'border-teal-300 bg-white/95 text-slate-700 ring-1 ring-teal-300/60'
                      : 'border-slate-200 bg-white/95 text-slate-700',
                    hasSelection && !isBarSelected(bar) ? 'opacity-25' : '',
                  ]"
                  :style="{
                    top: getLabelTop(bar.laneIndex),
                    left: getLabelLeft(bar.labelLeftPercent),
                    width: getLabelWidth(bar.labelWidthPercent),
                  }"
                  @click.stop="selectBar(bar)"
                >
                  <p class="truncate font-semibold text-slate-950">{{ bar.title }}</p>
                  <p class="mt-0.5 truncate text-slate-500">
                    {{ bar.directionLabel }} · {{ formatMinutes(bar.slot.minutes) }}
                  </p>
                </div>

                <!-- Compact tooltip -->
                <div
                  v-else-if="activeTooltipSlotId === bar.slot.id"
                  class="pointer-events-none absolute z-30 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-700 shadow-lg ring-1 ring-slate-950/5"
                  :style="{
                    top: compactTooltipTop,
                    left: getLabelLeft(bar.labelLeftPercent),
                    width: getLabelWidth(bar.labelWidthPercent),
                  }"
                >
                  <p class="truncate font-semibold text-slate-950">{{ bar.title }}</p>
                  <p class="mt-1 truncate text-slate-500">
                    {{ bar.directionLabel }} · {{ formatMinutes(bar.slot.minutes) }}
                  </p>
                </div>
              </div>

              <p
                v-if="!row.bars.length && !getVacationBars(row.member.id).length"
                class="relative p-3 text-xs text-slate-400"
              >
                Нет назначений
              </p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes hint-shimmer {
  0%, 40%, 100% {
    color: #94a3b8; /* slate-400 */
  }
  60%, 80% {
    color: #0f766e; /* teal-700 */
  }
}

.hint-shimmer {
  animation: hint-shimmer 3s ease-in-out infinite;
  color: #94a3b8;
}

.hint-shimmer.shimmer-off {
  animation: none;
  color: #94a3b8;
}
</style>






