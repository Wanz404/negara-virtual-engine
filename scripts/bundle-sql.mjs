// Gabungkan semua migrasi + seed jadi 1 file untuk copy-paste ke Supabase SQL Editor
// (fallback bila `supabase db push` terkendala).   npm run db:bundle
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mig = resolve(root, 'supabase/migrations');
const files = readdirSync(mig).filter((f) => f.endsWith('.sql')).sort();
const parts = [
  '-- =============================================================================',
  '-- DEPLOY_ALL_SQL.sql — GENERATED oleh scripts/bundle-sql.mjs. Jalankan SEKALI di Supabase SQL Editor.',
  `-- Isi: ${files.join(', ')} + seed.sql (10 dunia, 0 warga). Aman diulang (idempotent).`,
  '-- =============================================================================',
  '',
];
for (const f of files) parts.push(`-- >>> migrations/${f}`, readFileSync(resolve(mig, f), 'utf8'), '');
parts.push('-- >>> seed.sql', readFileSync(resolve(root, 'supabase/seed.sql'), 'utf8'));
writeFileSync(resolve(root, 'supabase/DEPLOY_ALL_SQL.sql'), parts.join('\n'), 'utf8');
console.log(`✓ supabase/DEPLOY_ALL_SQL.sql (${files.length} migrasi + seed)`);
