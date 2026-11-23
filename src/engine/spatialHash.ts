/** Spatial hash grid sederhana untuk culling & hit-test karakter (O(1) per sel). */
export class SpatialHash<T> {
  private cells = new Map<number, T[]>();
  private readonly size: number;

  constructor(cellSize = 96) {
    this.size = cellSize;
  }

  private key(cx: number, cy: number): number {
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  clear(): void {
    this.cells.clear();
  }

  insert(x: number, y: number, item: T): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size));
    const list = this.cells.get(k);
    if (list) list.push(item);
    else this.cells.set(k, [item]);
  }

  query(x0: number, y0: number, x1: number, y1: number, out: T[] = []): T[] {
    const cx0 = Math.floor(x0 / this.size);
    const cy0 = Math.floor(y0 / this.size);
    const cx1 = Math.floor(x1 / this.size);
    const cy1 = Math.floor(y1 / this.size);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const list = this.cells.get(this.key(cx, cy));
        if (list) for (const it of list) out.push(it);
      }
    }
    return out;
  }
}
