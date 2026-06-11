<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    size?: 'md' | 'lg' | 'xl'
  }>(),
  {
    size: 'lg',
  },
)

const emit = defineEmits<{
  close: []
}>()

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.open) {
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', handleKeydown)
    } else {
      document.removeEventListener('keydown', handleKeydown)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-5"
        @click.self="emit('close')"
      >
        <section
          class="max-h-[min(820px,92vh)] w-full overflow-hidden rounded-lg bg-white shadow-2xl"
          :class="
            props.size === 'xl' ? 'max-w-5xl' : props.size === 'md' ? 'max-w-xl' : 'max-w-3xl'
          "
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header
            class="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4"
          >
            <h2 class="text-lg font-semibold text-slate-950">{{ title }}</h2>
            <button
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              @click="emit('close')"
            >
              Закрыть
            </button>
          </header>
          <div class="max-h-[calc(min(820px,92vh)-74px)] overflow-y-auto p-5">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
