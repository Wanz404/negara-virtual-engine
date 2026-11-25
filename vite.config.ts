import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Aset emote mentah (JPG ~1MB/file) hanya bahan scripts/process-emotes.py — jangan ikut ter-deploy. */
function stripRawEmotes(): Plugin {
  let outDir = 'dist';
  return {
    name: 'strip-raw-emotes',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, 'assets/emotes/raw'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const worldId = (env.VITE_WORLD_ID || 'republik-konoha').trim();
  const worldFile = fileURLToPath(new URL(`./src/configs/worlds/${worldId}.ts`, import.meta.url));
  if (!/^[a-z0-9-]+$/.test(worldId) || !existsSync(worldFile)) {
    throw new Error(`VITE_WORLD_ID "${worldId}" tidak punya file src/configs/worlds/${worldId}.ts`);
  }

  return {
    plugins: [react(), tailwindcss(), stripRawEmotes()],
    resolve: {
      // Hanya config dunia aktif yang masuk bundle (1 codebase → 10 build berbeda).
      alias: { 'virtual-active-world': worldFile },
    },
    server: { port: 5173, host: true },
    build: {
      target: 'es2020',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
    },
  };
});
