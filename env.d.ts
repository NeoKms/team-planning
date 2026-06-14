/// <reference types="vite/client" />

declare module '@fontsource-variable/inter'

interface ImportMetaEnv {
  readonly APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
