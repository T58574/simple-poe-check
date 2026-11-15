import type { PoeCheckApi } from '../main/preload'

declare global {
  interface Window {
    poeCheck: PoeCheckApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
