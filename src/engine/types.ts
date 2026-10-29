import type { Entity } from "./ecs/EntitiesManager";

export type BackendName = "WEBGPU" | "WEBGL2";

export interface EntityInfo {
  entity: Entity;
  label: string;
  detail: string;
  category: string;
  /** World-space anchor used by the selection marker. */
  position: [number, number, number];
}

export interface HiZPreview {
  width: number;
  height: number;
  /** RGBA heat-map of the conservative CPU copy of the coarse Hi-Z level. */
  data: Uint8ClampedArray;
}

export interface GameStats {
  fps: number;
  frameMs: number;
  entities: number;
  visibleInstances: number;
  frustumCulled: number;
  occlusionCulled: number;
  /** Number of rendered entities per LOD level. */
  lodCounts: [number, number, number];
  batchCount: number;
  drawCalls: number;
  triangles: number;
  spatialCells: number;
  backend: BackendName;
  hiZ: {
    available: boolean;
    levels: number;
    readbackSize: string;
    lastReadbackMs: number;
    tested: number;
    occluded: number;
    preview: HiZPreview | null;
  };
}

export interface EngineCallbacks {
  onStats: (stats: GameStats) => void;
  onHover: (info: EntityInfo | null) => void;
  onSelect: (info: EntityInfo | null) => void;
  onBackend: (backend: BackendName) => void;
}

export type CullingToggle = "frustum" | "lod" | "occlusion";
export type ViewPreset = "overview" | "aisle" | "dock" | "racks";
