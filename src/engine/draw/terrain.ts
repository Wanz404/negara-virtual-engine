import type { WorldTheme } from '../../configs/types';
import type { ViewRect } from '../camera';
import { WATER_AFTER_RING, type Geometry } from '../geometry';
import { shade } from '../sprites';

/** Isi pita persegi (cincin) antara setengah-lebar inner dan outer. */
function band(ctx: CanvasRenderingContext2D, inner: number, outer: number): void {
  ctx.fillRect(-outer, -outer, outer * 2, outer - inner);
  ctx.fillRect(-outer, inner, outer * 2, outer - inner);
  ctx.fillRect(-outer, -inner, outer - inner, inner * 2);
  ctx.fillRect(inner, -inner, outer - inner, inner * 2);
}

function dashedSquare(ctx: CanvasRenderingContext2D, half: number): void {
  ctx.strokeRect(-half, -half, half * 2, half * 2);
}

export function drawTerrain(ctx: CanvasRenderingContext2D, geo: Geometry, theme: WorldTheme, unlocked: number, view: ViewRect, t: number, lod: number): void {
  // Rumput
  ctx.fillStyle = theme.ground;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);

  // Laut di luar wilayah (sampai ring berikutnya yang belum dibuka)
  ctx.fillStyle = '#7dd3fc';
  const sea = geo.ringOuterHalf(unlocked + 1) + 40;
  if (view.x0 < -sea || view.x1 > sea || view.y0 < -sea || view.y1 > sea) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    ctx.rect(-sea, -sea, sea * 2, sea * 2);
    ctx.fill('evenodd');
    ctx.restore();
  }

  // Selat "Pulau Reklamasi" di luar Ring 2 + 4 jembatan
  if (unlocked >= WATER_AFTER_RING) {
    const b = geo.boundaryBand(WATER_AFTER_RING);
    const wi = b.inner + 26;
    const wo = b.outer - 26;
    ctx.fillStyle = '#7dd3fc';
    band(ctx, wi, wo);
    if (lod >= 0.5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const s = wi + ((wo - wi) * (i + 1)) / 4 + Math.sin(t * 1.3 + i) * 3;
        ctx.setLineDash([14, 22]);
        ctx.lineDashOffset = -t * 12;
        dashedSquare(ctx, s);
      }
      ctx.setLineDash([]);
    }
    ctx.fillStyle = shade(theme.road, -0.1);
    const bw = 44;
    ctx.fillRect(-bw / 2, -wo, bw, wo - wi);
    ctx.fillRect(-bw / 2, wi, bw, wo - wi);
    ctx.fillRect(-wo, -bw / 2, wo - wi, bw);
    ctx.fillRect(wi, -bw / 2, wo - wi, bw);
    ctx.fillStyle = '#a16207';
    for (const [x, y, w, h] of [
      [-bw / 2 - 3, -wo, 3, wo - wi],
      [bw / 2, -wo, 3, wo - wi],
      [-bw / 2 - 3, wi, 3, wo - wi],
      [bw / 2, wi, 3, wo - wi],
      [-wo, -bw / 2 - 3, wo - wi, 3],
      [-wo, bw / 2, wo - wi, 3],
      [wi, -bw / 2 - 3, wo - wi, 3],
      [wi, bw / 2, wo - wi, 3],
    ])
      ctx.fillRect(x, y, w, h);
  }

  // Jalan lingkar di setiap batas ring (0 = jalan lingkar inti)
  for (let r = 0; r <= unlocked; r++) {
    const b = geo.boundaryBand(r);
    const water = r === WATER_AFTER_RING;
    const segs: Array<[number, number]> = water ? [[b.inner, b.inner + 26], [b.outer - 26, b.outer]] : [[b.inner, b.outer]];
    for (const [i, o] of segs) {
      ctx.fillStyle = theme.road;
      band(ctx, i, o);
      if (lod >= 0.45 && o - i > 20) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([10, 10]);
        dashedSquare(ctx, (i + o) / 2);
        ctx.setLineDash([]);
      }
    }
  }

  // Pelataran inti (Ring 0) + boulevard silang
  const ch = geo.coreHalf;
  ctx.fillStyle = shade(theme.ground, 0.35);
  ctx.fillRect(-ch, -ch, ch * 2, ch * 2);
  ctx.fillStyle = shade(theme.road, 0.25);
  ctx.fillRect(-16, -ch, 32, ch * 2);
  ctx.fillRect(-ch, -16, ch * 2, 32);

  // Kabut zona ekspansi berikutnya (belum terbuka)
  const fogIn = geo.boundaryBand(unlocked).outer;
  const fogOut = geo.ringOuterHalf(unlocked + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  band(ctx, fogIn, fogOut);
  ctx.strokeStyle = 'rgba(15,23,42,0.35)';
  ctx.lineWidth = 3;
  ctx.setLineDash([16, 12]);
  dashedSquare(ctx, fogOut);
  ctx.setLineDash([]);
}
