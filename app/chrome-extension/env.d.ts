/// <reference types="unplugin-icons/types/vue" />

/** ISO timestamp of the build, injected by wxt.config.ts. */
declare const __BUILD_TIME__: string;
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  type Props = Record<string, never>;
  type RawBindings = Record<string, never>;
  const component: DefineComponent<Props, RawBindings, any>;
  export default component;
}
