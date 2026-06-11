<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { useConfirmDialog } from '@/composables/useConfirmDialog'

const { dialog, select, cancel } = useConfirmDialog()

const cancelButton = ref<HTMLButtonElement | null>(null)

const actionButtonClasses = (tone: 'default' | 'danger' = 'default') =>
  tone === 'danger'
    ? 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-200'
    : 'bg-slate-950 text-white hover:bg-slate-800 focus:ring-slate-200'

watch(
  () => dialog.value?.id,
  async (dialogId) => {
    if (!dialogId) {
      return
    }

    await nextTick()
    cancelButton.value?.focus()
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="dialog"
        class="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 px-4 py-6"
        role="presentation"
        @click.self="cancel"
      >
        <section
          class="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="`${dialog.id}-title`"
          :aria-describedby="`${dialog.id}-message`"
          @keydown.esc="cancel"
        >
          <h2 :id="`${dialog.id}-title`" class="text-lg font-semibold text-slate-950">
            {{ dialog.title }}
          </h2>
          <p :id="`${dialog.id}-message`" class="mt-3 text-sm leading-6 whitespace-pre-line text-slate-600">
            {{ dialog.message }}
          </p>

          <div class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button
              ref="cancelButton"
              type="button"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 focus:ring-2 focus:ring-slate-200 focus:outline-none"
              @click="cancel"
            >
              {{ dialog.cancelLabel }}
            </button>
            <button
              v-for="action in dialog.actions"
              :key="action.value"
              type="button"
              class="rounded-lg px-3 py-2 text-sm font-medium transition focus:ring-2 focus:outline-none"
              :class="actionButtonClasses(action.tone)"
              @click="select(action.value)"
            >
              {{ action.label }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
