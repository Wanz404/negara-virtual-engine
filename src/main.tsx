import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WORLD } from './configs';
import App from './App';
import './index.css';

// Terapkan tema dunia ke CSS variables (multi-tenant: 1 codebase, 10 tampilan)
const t = WORLD.theme;
const root = document.documentElement;
root.style.setProperty('--w-primary', t.primary);
root.style.setProperty('--w-accent', t.accent);
root.style.setProperty('--w-bg', t.background);
root.style.setProperty('--w-surface', t.surface);
root.style.setProperty('--w-text', t.text);
root.style.setProperty('--w-muted', t.muted);
root.style.setProperty('--w-ground', t.ground);
root.style.setProperty('--w-road', t.road);
document.title = `${WORLD.copy.nationName} — ${WORLD.copy.tagline}`;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.primary);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
