import activeWorld from 'virtual-active-world';
import type { WorldConfig } from './types';

/**
 * Config dunia aktif untuk build ini, dipilih oleh VITE_WORLD_ID.
 * vite.config.ts meng-alias 'virtual-active-world' ke src/configs/worlds/<VITE_WORLD_ID>.ts
 * sehingga 9 dunia lain tidak ikut di-bundle. (Daftar lengkap: ./registry.ts, dipakai skrip seed.)
 */
export const WORLD: WorldConfig = activeWorld;

export * from './types';
