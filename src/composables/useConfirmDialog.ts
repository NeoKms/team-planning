import { readonly, ref } from 'vue'

type ConfirmDialogTone = 'default' | 'danger'

interface ConfirmDialogOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmDialogTone
}

interface ConfirmDialogAction {
  label: string
  value: string
  tone?: ConfirmDialogTone
}

interface ChoiceDialogOptions {
  title: string
  message: string
  cancelLabel?: string
  actions: ConfirmDialogAction[]
}

interface ActiveConfirmDialog extends Required<ConfirmDialogOptions> {
  id: string
  actions: ConfirmDialogAction[]
}

const activeDialog = ref<ActiveConfirmDialog | null>(null)
let activeResolver: ((value: string | null) => void) | null = null

const createDialogId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `confirm-${crypto.randomUUID()}`
  }

  return `confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const closeDialog = (value: string | null) => {
  if (!activeResolver) {
    activeDialog.value = null
    return
  }

  const resolve = activeResolver
  activeResolver = null
  activeDialog.value = null
  resolve(value)
}

export const useConfirmDialog = () => {
  const confirm = (options: ConfirmDialogOptions) =>
    new Promise<boolean>((resolve) => {
      if (activeResolver) {
        closeDialog(null)
      }

      activeResolver = (value) => resolve(value === 'confirm')
      activeDialog.value = {
        id: createDialogId(),
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Подтвердить',
        cancelLabel: options.cancelLabel ?? 'Отмена',
        tone: options.tone ?? 'default',
        actions: [
          {
            label: options.confirmLabel ?? 'Подтвердить',
            value: 'confirm',
            tone: options.tone ?? 'default',
          },
        ],
      }
    })

  const choose = (options: ChoiceDialogOptions) =>
    new Promise<string | null>((resolve) => {
      if (activeResolver) {
        closeDialog(null)
      }

      activeResolver = resolve
      activeDialog.value = {
        id: createDialogId(),
        title: options.title,
        message: options.message,
        confirmLabel: options.actions[0]?.label ?? 'Подтвердить',
        cancelLabel: options.cancelLabel ?? 'Отмена',
        tone: options.actions[0]?.tone ?? 'default',
        actions: options.actions,
      }
    })

  return {
    dialog: readonly(activeDialog),
    confirm,
    choose,
    cancel: () => closeDialog(null),
    accept: () => closeDialog('confirm'),
    select: (value: string) => closeDialog(value),
  }
}
