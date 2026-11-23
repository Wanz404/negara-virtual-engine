/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORLD_ID?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_REGISTER_VIA?: 'edge' | 'rpc';
  readonly VITE_DEV_MOCK_MODE?: string;
  readonly VITE_ENABLE_SANDBOX_SEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'virtual-active-world' {
  const world: import('./configs/types').WorldConfig;
  export default world;
}
