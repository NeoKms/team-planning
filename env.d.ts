/// <reference types="vite/client" />

declare module '@fontsource-variable/inter'

interface ImportMetaEnv {
  readonly APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  ym?: (counterId: number, action: string, ...args: unknown[]) => void
  dataLayer?: Record<string, unknown>[]
}

