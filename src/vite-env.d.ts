/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ML_BACKEND_URL?: string;
  /** When "true", skip Google login and use local preview (dev only). */
  readonly VITE_SKIP_AUTH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
