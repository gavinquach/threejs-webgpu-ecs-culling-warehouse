import { Timer, Vector3 } from "three";
import { EntitiesManager } from "./ecs/EntitiesManager";
import { createWarehouseMaterials } from "./world/materials";
import { WarehouseWorld } from "./world/WarehouseWorld";
import { HiZSystem } from "./systems/HiZSystem";
import { MeshInstanceSystem } from "./systems/MeshInstanceSystem";
import { SpatialSystem } from "./systems/SpatialSystem";
import { Interaction3DSystem } from "./systems/Interaction3DSystem";
import { RenderControl } from "./render/RenderControl";
import type {
  CullingToggle,
  EngineCallbacks,
  GameStats,
  ViewPreset,
} from "./types";

const CAMERA_PRESETS: Record<
  ViewPreset,
  { position: Vector3; target: Vector3 }
> = {
  overview: {
    position: new Vector3(6, 7.4, 21),
    target: new Vector3(5, 2.2, -6),
  },
  aisle: {
    position: new Vector3(6, 2.7, 19.4),
    target: new Vector3(6, 3.4, -14),
  },
  dock: {
    position: new Vector3(0, 4.6, 36),
    target: new Vector3(0, 4.2, 20),
  },
  racks: {
    position: new Vector3(-17.4, 4.6, 9.5),
    target: new Vector3(-13.1, 4.3, -1.5),
  },
};

/** Engine composition root: owns the world, systems and frame pipeline. */
export class GameEngine {
  private readonly renderControl: RenderControl;
  private readonly entities: EntitiesManager;
  private readonly world: WarehouseWorld;
  private readonly hiZ: HiZSystem;
  private readonly meshInstances: MeshInstanceSystem;
  private readonly spatial: SpatialSystem;
  private readonly interaction: Interaction3DSystem;
  private readonly callbacks: EngineCallbacks;
  private readonly timer = new Timer();

  private running = false;
  private disposed = false;
  private statsElapsed = 0;
  private smoothedFps = 60;
  private smoothedFrameMs = 16.7;

  private constructor(
    renderControl: RenderControl,
    entities: EntitiesManager,
    world: WarehouseWorld,
    hiZ: HiZSystem,
    meshInstances: MeshInstanceSystem,
    spatial: SpatialSystem,
    interaction: Interaction3DSystem,
    callbacks: EngineCallbacks,
  ) {
    this.renderControl = renderControl;
    this.entities = entities;
    this.world = world;
    this.hiZ = hiZ;
    this.meshInstances = meshInstances;
    this.spatial = spatial;
    this.interaction = interaction;
    this.callbacks = callbacks;
    this.timer.connect(document);
  }

  static async create(
    container: HTMLElement,
    callbacks: EngineCallbacks,
  ): Promise<GameEngine> {
    const renderControl = await RenderControl.create(container);
    const entities = new EntitiesManager();
    const materials = createWarehouseMaterials(renderControl.renderer);
    const world = new WarehouseWorld(entities, renderControl.scene, materials);
    world.build();

    const hiZ = new HiZSystem(renderControl.renderer, world.occluderScene);
    const meshInstances = new MeshInstanceSystem(
      renderControl.scene,
      entities,
      hiZ,
    );
    const spatial = new SpatialSystem(entities);
    spatial.rebuild();

    const interaction = new Interaction3DSystem(
      renderControl.renderer.domElement,
      renderControl.camera,
      renderControl.scene,
      entities,
      spatial,
      meshInstances,
      {
        onHover: callbacks.onHover,
        onSelect: callbacks.onSelect,
      },
    );

    const engine = new GameEngine(
      renderControl,
      entities,
      world,
      hiZ,
      meshInstances,
      spatial,
      interaction,
      callbacks,
    );

    callbacks.onBackend(renderControl.backend);
    return engine;
  }

  get backend() {
    return this.renderControl.backend;
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.timer.reset();
    this.renderControl.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderControl.renderer.setAnimationLoop(null);
  }

  setCulling(toggle: CullingToggle, enabled: boolean): void {
    if (toggle === "frustum")
      this.meshInstances.frustumCullingEnabled = enabled;
    if (toggle === "lod") this.meshInstances.lodEnabled = enabled;
    if (toggle === "occlusion") {
      this.meshInstances.occlusionCullingEnabled = enabled;
      if (enabled) this.hiZ.invalidate();
    }
  }

  setViewPreset(preset: ViewPreset): void {
    const view = CAMERA_PRESETS[preset];
    this.renderControl.flyTo(view.position, view.target);
    this.hiZ.invalidate();
  }

  clearSelection(): void {
    this.interaction.clearSelection();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.interaction.dispose();
    this.meshInstances.dispose();
    this.spatial.dispose();
    this.hiZ.dispose();
    this.world.dispose();
    this.renderControl.dispose();
    this.timer.dispose();
  }

  private readonly tick = (time?: number): void => {
    if (!this.running || this.disposed) return;

    this.timer.update(time);
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const frameMs = delta * 1000;
    this.smoothedFrameMs = this.smoothedFrameMs * 0.9 + frameMs * 0.1;
    this.smoothedFps =
      this.smoothedFps * 0.9 + (delta > 0 ? 1 / delta : 60) * 0.1;

    this.renderControl.resetInfo();
    this.renderControl.update(delta);
    if (this.renderControl.isFlying) this.hiZ.invalidate();

    this.meshInstances.setHighlight(
      this.interaction.hoveredEntity,
      this.interaction.selectedEntity,
    );
    this.meshInstances.update(
      this.renderControl.camera,
      this.renderControl.viewportHeight,
    );
    this.interaction.update(delta);

    this.renderControl.render();
    this.hiZ.update(this.renderControl.camera);

    this.statsElapsed += delta;
    if (this.statsElapsed >= 0.22) {
      this.statsElapsed = 0;
      this.callbacks.onStats(this.buildStats());
    }
  };

  private buildStats(): GameStats {
    const meshStats = this.meshInstances.stats;
    const available = this.hiZ.isAvailable;

    return {
      fps: this.smoothedFps,
      frameMs: this.smoothedFrameMs,
      entities: this.entities.entityCount,
      visibleInstances: meshStats.visibleInstances,
      frustumCulled: meshStats.frustumCulled,
      occlusionCulled: meshStats.occlusionCulled,
      lodCounts: [...meshStats.lodCounts] as [number, number, number],
      batchCount: meshStats.batchCount,
      drawCalls: this.renderControl.drawCalls,
      triangles: this.renderControl.triangles,
      spatialCells: this.spatial.cellCount,
      backend: this.renderControl.backend,
      hiZ: {
        available,
        levels: this.hiZ.levels,
        readbackSize: `${this.hiZ.readbackWidth}×${this.hiZ.readbackHeight}`,
        lastReadbackMs: this.hiZ.lastReadbackDuration,
        tested: meshStats.occlusionTested,
        occluded: meshStats.occlusionCulled,
        preview: available ? this.buildHiZPreview() : null,
      },
    };
  }

  /** Converts the coarse max-depth level into a compact RGBA heat-map. */
  private buildHiZPreview() {
    const width = this.hiZ.readbackWidth;
    const height = this.hiZ.readbackHeight;
    const depth = this.hiZ.getDepthData();
    const preview = new Uint8ClampedArray(width * height * 4);

    // Warehouse depth only spans a fraction of the camera frustum, so
    // normalizing to the observed range makes the pyramid readable.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < depth.length; i++) {
      const value = depth[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = Math.max(0.0001, max - min);

    for (let i = 0; i < depth.length; i++) {
      const near = 1 - Math.min(1, Math.max(0, (depth[i] - min) / range));
      const offset = i * 4;
      preview[offset] = 8 + near * 30;
      preview[offset + 1] = 22 + near * 205;
      preview[offset + 2] = 54 + near * 186;
      preview[offset + 3] = 255;
    }

    return { width, height, data: preview };
  }
}
