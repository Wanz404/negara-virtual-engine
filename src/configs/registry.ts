import type { WorldConfig, WorldId } from './types';
import republikKonoha from './worlds/republik-konoha';
import ptVirtual from './worlds/pt-virtual';
import kampusVirtual from './worlds/kampus-virtual';
import kampungMistis from './worlds/kampung-mistis';
import kerajaanNusantara from './worlds/kerajaan-nusantara';
import guildPetualang from './worlds/guild-petualang';
import kotaMafia from './worlds/kota-mafia';
import pulauPenjara from './worlds/pulau-penjara';
import koloniMars from './worlds/koloni-mars';
import kerajaanKucing from './worlds/kerajaan-kucing';

/** Semua dunia. Dipakai frontend (dipilih via VITE_WORLD_ID) dan scripts/generate-seed.ts. */
export const WORLDS: Record<WorldId, WorldConfig> = {
  'republik-konoha': republikKonoha,
  'pt-virtual': ptVirtual,
  'kampus-virtual': kampusVirtual,
  'kampung-mistis': kampungMistis,
  'kerajaan-nusantara': kerajaanNusantara,
  'guild-petualang': guildPetualang,
  'kota-mafia': kotaMafia,
  'pulau-penjara': pulauPenjara,
  'koloni-mars': koloniMars,
  'kerajaan-kucing': kerajaanKucing,
};

export function isWorldId(value: string): value is WorldId {
  return Object.prototype.hasOwnProperty.call(WORLDS, value);
}
