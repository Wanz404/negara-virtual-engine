import type { BuildingType, WorldTheme } from '../../configs/types';
import { PLOT } from '../geometry';
import { drawEmoji, shade } from '../sprites';

const HEIGHTS: Record<BuildingType['category'], number[]> = {
  residential: [0, 18, 26, 34, 42, 60],
  commercial: [0, 14, 24, 38, 58, 88],
  government: [0, 20, 28, 36, 46, 58],
  community: [0, 14, 18, 22, 28, 34],
};

export interface PlotVisual {
  x: number;
  y: number;
  owned: boolean;
  mine: boolean;
  level: number;
  building: BuildingType | undefined;
  highlighted: boolean;
}

/** Alas kavling: rumput "Dijual", tanah ber-pagar milik warga, atau fondasi bangunan. */
export function drawPlotBase(ctx: CanvasRenderingContext2D, p: PlotVisual, theme: WorldTheme, lod: number): void {
  const h = PLOT / 2;
  const x0 = p.x - h;
  const y0 = p.y - h;
  if (!p.owned) {
    ctx.fillStyle = shade(theme.ground, 0.3);
    ctx.fillRect(x0, y0, PLOT, PLOT);
    if (lod >= 0.3) {
      ctx.strokeStyle = 'rgba(15,23,42,0.22)';
      ctx.lineWidth = lod >= 0.5 ? 1.5 : 3;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x0 + 3, y0 + 3, PLOT - 6, PLOT - 6);
      ctx.setLineDash([]);
    }
    if (lod >= 0.5) {
      // papan "Dijual"
      ctx.fillStyle = '#92400e';
      ctx.fillRect(p.x + 10, p.y - 2, 2.5, 16);
      ctx.fillStyle = '#fff';
      ctx.fillRect(p.x + 2, p.y - 10, 20, 10);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(p.x + 4, p.y - 8, 16, 2);
      ctx.fillRect(p.x + 4, p.y - 4.5, 10, 1.5);
    }
  } else {
    ctx.fillStyle = p.level > 0 ? shade(theme.road, 0.45) : '#d6b48a';
    ctx.fillRect(x0, y0, PLOT, PLOT);
    if (p.level === 0 && lod >= 0.5) {
      ctx.strokeStyle = '#92400e';
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 3, y0 + 3, PLOT - 6, PLOT - 6);
      ctx.fillStyle = '#92400e';
      for (let i = 0; i <= 6; i++) {
        ctx.fillRect(x0 + 2 + i * 10, y0 + 1, 2, 5);
        ctx.fillRect(x0 + 2 + i * 10, y0 + PLOT - 6, 2, 5);
      }
      // papan nama pemilik
      ctx.fillRect(p.x - 1, p.y - 2, 2.5, 14);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(p.x - 13, p.y - 12, 28, 11);
    }
  }
  if (p.mine) {
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 3;
    ctx.strokeRect(x0 + 1.5, y0 + 1.5, PLOT - 3, PLOT - 3);
  }
  if (p.highlighted) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 4;
    ctx.strokeRect(x0 - 2, y0 - 2, PLOT + 4, PLOT + 4);
  }
}

/**
 * Bangunan bergaya flat 2D: makin tinggi & lebar per level (1–5). Atap berbeda per kategori.
 * Bangunan menjulang ke atas kavling, jadi digambar urut Y agar tumpang-tindih benar.
 */
export function drawBuilding(ctx: CanvasRenderingContext2D, x: number, y: number, b: BuildingType, level: number, lod: number, t: number): void {
  const lv = Math.max(1, Math.min(5, level));
  const height = HEIGHTS[b.category][lv];
  const w = Math.min(PLOT - 8, 26 + lv * 6);
  const baseY = y + PLOT / 2 - 7;
  const x0 = x - w / 2;
  const top = baseY - height;
  const body = b.color;

  // bayangan
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(x0 + 4, baseY - 2, w, 6);

  if (lod < 0.45) {
    ctx.fillStyle = body;
    ctx.fillRect(x0, top, w, height);
    return;
  }

  // badan + sisi gelap
  ctx.fillStyle = body;
  ctx.fillRect(x0, top, w, height);
  ctx.fillStyle = shade(body, -0.22);
  ctx.fillRect(x0 + w - 5, top, 5, height);

  // jendela
  const rows = Math.max(1, Math.floor((height - 10) / 11));
  const cols = Math.max(1, Math.floor((w - 8) / 9));
  const glass = b.category === 'commercial' && lv >= 4 ? '#bae6fd' : '#fef9c3';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lit = (r * 7 + c * 3 + lv) % 5 !== 0;
      ctx.fillStyle = lit ? glass : shade(body, -0.35);
      ctx.fillRect(x0 + 4 + c * 9, top + 6 + r * 11, 5, 6);
    }
  }
  // pintu
  ctx.fillStyle = shade(body, -0.45);
  ctx.fillRect(x - 4, baseY - 9, 8, 9);

  // atap per kategori
  switch (b.category) {
    case 'residential': {
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.moveTo(x0 - 4, top + 1);
      ctx.lineTo(x, top - 10 - lv * 2);
      ctx.lineTo(x0 + w + 4, top + 1);
      ctx.closePath();
      ctx.fill();
      if (lv === 5) {
        // helipad di atap mansion
        ctx.fillStyle = '#374151';
        ctx.beginPath();
        ctx.ellipse(x, top - 20, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      break;
    }
    case 'commercial': {
      if (lv <= 2) {
        // tenda/awning bergaris
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 ? '#fff' : shade(body, 0.1);
          ctx.fillRect(x0 - 3 + (i * (w + 6)) / 6, top - 6, (w + 6) / 6 + 0.5, 8);
        }
      } else {
        ctx.fillStyle = shade(body, -0.3);
        ctx.fillRect(x0 - 2, top - 4, w + 4, 5);
        if (lv === 5) {
          ctx.fillStyle = '#64748b';
          ctx.fillRect(x - 1, top - 18, 2, 14);
          ctx.fillStyle = Math.sin(t * 4) > 0 ? '#ef4444' : '#7f1d1d';
          ctx.beginPath();
          ctx.arc(x, top - 19, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'government': {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.moveTo(x0 - 3, top + 1);
      ctx.lineTo(x, top - 9);
      ctx.lineTo(x0 + w + 3, top + 1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < 4; i++) ctx.fillRect(x0 + 3 + (i * (w - 6)) / 3 - 1.5, top + 3, 3, height - 12);
      // bendera kecil
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(x - 0.5, top - 22, 1.5, 14);
      const wave = Math.sin(t * 5) * 1.5;
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(x + 1, top - 22 + wave * 0.2, 8, 3);
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 1, top - 19 + wave * 0.2, 8, 3);
      break;
    }
    case 'community': {
      ctx.fillStyle = '#16a34a';
      ctx.beginPath();
      ctx.arc(x0 + 4, top, 8, 0, Math.PI * 2);
      ctx.arc(x0 + w - 4, top, 8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  if (lod >= 0.7) drawEmoji(ctx, b.emoji, x0 + w - 2, top - 2, 14);
}
