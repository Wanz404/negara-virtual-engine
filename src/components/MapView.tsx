import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { WORLD, type LandmarkKind } from '../configs';
import { MapEngine, type MapData, type TapTarget } from '../engine';
import type { EmoteKey } from '../services/types';

export interface MapViewHandle {
  locateCitizen(id: string): boolean;
  locatePlot(code: string): boolean;
  flyNear(meId: string | null): void;
  frameAll(): void;
  frameCore(): void;
  setHighlight(code: string | null): void;
  locateLandmark(kind: LandmarkKind, zoom?: number): void;
  setPresentation(on: boolean): void;
  /** Emote di atas kepala warga; false bila warga tidak tampil di peta. */
  showEmote(citizenId: string, key: EmoteKey): boolean;
}

/**
 * Pembungkus tipis MapEngine. Loop render (requestAnimationFrame) hidup di engine, terisolasi dari
 * re-render React: props hanya meneruskan data lewat engine.setData().
 */
export const MapView = forwardRef<MapViewHandle, { data: MapData; onTap: (t: TapTarget) => void; onVisibleRings: (rings: number[]) => void }>(
  function MapView({ data, onTap, onVisibleRings }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<MapEngine | null>(null);
    const tapRef = useRef(onTap);
    const ringsRef = useRef(onVisibleRings);
    tapRef.current = onTap;
    ringsRef.current = onVisibleRings;

    useEffect(() => {
      const engine = new MapEngine(canvasRef.current!, WORLD);
      engine.onTap = (t) => tapRef.current(t);
      engine.onVisibleRings = (r) => ringsRef.current(r);
      engineRef.current = engine;
      return () => {
        engine.destroy();
        engineRef.current = null;
      };
    }, []);

    useEffect(() => {
      engineRef.current?.setData(data);
    }, [data]);

    useImperativeHandle(ref, () => ({
      locateCitizen: (id) => engineRef.current?.locateCitizen(id) ?? false,
      locatePlot: (code) => engineRef.current?.locatePlot(code) ?? false,
      flyNear: (meId) => engineRef.current?.flyNear(meId),
      frameAll: () => engineRef.current?.frameAll(),
      frameCore: () => engineRef.current?.frameCore(true),
      setHighlight: (code) => engineRef.current?.setHighlight(code),
      locateLandmark: (kind, zoom) => engineRef.current?.locateLandmark(kind, zoom),
      setPresentation: (on) => engineRef.current?.setPresentation(on),
      showEmote: (id, key) => engineRef.current?.showEmote(id, key) ?? false,
    }));

    return <canvas ref={canvasRef} className="block h-full w-full touch-none select-none" aria-label={`Peta ${WORLD.copy.nationName}`} />;
  },
);
