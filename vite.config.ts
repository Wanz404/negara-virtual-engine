import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const worldId = (env.VITE_WORLD_ID || 'republik-konoha').trim();
  const worldFile = fileURLToPath(new URL(`./src/configs/worlds/${worldId}.ts`, import.meta.url));
  if (!/^[a-z0-9-]+$/.test(worldId) || !existsSync(worldFile)) {
    throw new Error(`VITE_WORLD_ID "${worldId}" tidak punya file src/configs/worlds/${worldId}.ts`);
  }

  return {
    plugins: [react(), tailwindcss()],
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
