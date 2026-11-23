/**
 * Menghasilkan supabase/seed.sql dari src/configs/worlds/*.ts (sumber kebenaran tunggal).
 *
 *   npm run db:seed                       → semua 10 dunia
 *   npm run db:seed -- republik-konoha    → hanya dunia tertentu
 *
 * Aman dijalankan berulang: config & handle di-update, counter warga TIDAK disentuh
 * (production tetap mulai dari 0 warga — tidak ada data dummy).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WORLDS, isWorldId } from '../src/configs/registry';
import type { WorldConfig } from '../src/configs/types';
import { PROFANITY_WORDS } from '../src/lib/profanity';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function dollarQuote(json: string): string {
  let tag = 'cfg';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$`;
}

export function buildSeedSql(worlds: WorldConfig[]): string {
  const lines: string[] = [];
  lines.push('-- =============================================================================');
  lines.push('-- GENERATED oleh scripts/generate-seed.ts — JANGAN edit manual.');
  lines.push('-- Edit src/configs/worlds/*.ts lalu jalankan `npm run db:seed`.');
  lines.push('-- Tidak membuat warga dummy: production selalu mulai dari 0 warga (strict FCFS).');
  lines.push('-- =============================================================================');
  lines.push('');
  lines.push('INSERT INTO public.profanity_words (word) VALUES');
  lines.push(PROFANITY_WORDS.map((w) => `  (${sqlString(w)})`).join(',\n'));
  lines.push('ON CONFLICT DO NOTHING;');
  lines.push('');

  for (const w of worlds) {
    const first = w.projects[0];
    lines.push(`-- ${w.copy.nationName} (${w.domain})`);
    lines.push(
      'INSERT INTO public.world_states (world_id, display_name, ig_account_handle, config, active_project_id, active_project_goal)',
    );
    lines.push(
      `VALUES (${sqlString(w.worldId)}, ${sqlString(w.copy.nationName)}, ${sqlString(w.igAccountHandle)}, ${dollarQuote(
        JSON.stringify(w),
      )}::jsonb, ${sqlString(first?.id ?? '')}, ${first?.goal ?? 0})`,
    );
    lines.push('ON CONFLICT (world_id) DO UPDATE SET');
    lines.push('  display_name = EXCLUDED.display_name,');
    lines.push('  ig_account_handle = EXCLUDED.ig_account_handle,');
    lines.push('  config = EXCLUDED.config,');
    lines.push("  active_project_goal = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_goal ELSE public.world_states.active_project_goal END,");
    lines.push("  active_project_id = CASE WHEN public.world_states.active_project_id = '' THEN EXCLUDED.active_project_id ELSE public.world_states.active_project_id END,");
    lines.push('  updated_at = now();');
    lines.push('');
  }

  lines.push('-- Generate kavling untuk ring yang sudah terbuka (idempotent)');
  lines.push(
    `SELECT public.nv_ensure_plots(world_id, current_ring_unlocked) FROM public.world_states WHERE world_id IN (${worlds
      .map((w) => sqlString(w.worldId))
      .join(', ')});`,
  );
  lines.push('');
  return lines.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const unknown = args.filter((a) => !isWorldId(a));
  if (unknown.length) {
    console.error(`world_id tidak dikenal: ${unknown.join(', ')}`);
    process.exit(1);
  }
  const selected = (args.length ? args : Object.keys(WORLDS)).filter(isWorldId).map((id) => WORLDS[id]);
  const out = resolve(root, 'supabase', 'seed.sql');
  writeFileSync(out, buildSeedSql(selected), 'utf8');
  console.log(`✓ ${out} — ${selected.length} dunia, ${PROFANITY_WORDS.length} kata filter.`);
}
