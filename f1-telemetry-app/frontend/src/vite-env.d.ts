/// <reference types="vite/client" />

declare module 'plotly.js-dist-min';

interface ImportMetaEnv {
  /** Dev-only override: base URL of a locally served f1-data tree. */
  readonly VITE_LOCAL_DATA_URL?: string;
}
