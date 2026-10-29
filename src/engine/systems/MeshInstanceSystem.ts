import {
  Color,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
} from "three";
import type { BufferGeometry, Material, PerspectiveCamera, Scene } from "three";
import type { Entity } from "../ecs/EntitiesManager";
import { EntitiesManager } from "../ecs/EntitiesManager";
import type { RenderableLod } from "../ecs/components";
import { refreshWorldBounds } from "../ecs/components";
import type { HiZSystem } from "./HiZSystem";

const INITIAL_BATCH_CAPACITY = 256;

interface Batch {
  key: string;
  mesh: InstancedMesh;
  capacity: number;
  count: number;
  geometry: BufferGeometry;
  material: Material;
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface MeshInstanceStats {
  visibleInstances: number;
  frustumCulled: number;
  occlusionCulled: number;
  occlusionTested: number;
  lodCounts: [number, number, number];
  batchCount: number;
}

const _color = new Color();
const _selectedColor = new Color(0xffb23e);
const _hoverColor = new Color(0x8ce7ff);

/**
 * Turns ECS renderables into a small set of instanced draw batches.
 *
 * Per entity it performs:
 *   1. world-bounds refresh
 *   2. frustum culling
 *   3. LOD selection by projected pixel radius
 *   4. conservative Hi-Z occlusion testing
 *
 * Only survivors are written into their LOD batch's matrix/color streams.
 */
export class MeshInstanceSystem {
  readonly stats: MeshInstanceStats = {
    visibleInstances: 0,
    frustumCulled: 0,
    occlusionCulled: 0,
    occlusionTested: 0,
    lodCounts: [0, 0, 0],
    batchCount: 0,
  };

  private readonly scene: Scene;
  private readonly entities: EntitiesManager;
  private readonly hiZ: HiZSystem;
  private readonly renderEntities: Entity[];
  private readonly batches = new Map<string, Batch>();
  private readonly visibleEntities = new Set<Entity>();

  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly viewMatrix = new Matrix4();

  private hovered: Entity | null = null;
  private selected: Entity | null = null;

  frustumCullingEnabled = true;
  lodEnabled = true;
  occlusionCullingEnabled = true;

  constructor(scene: Scene, entities: EntitiesManager, hiZ: HiZSystem) {
    this.scene = scene;
    this.entities = entities;
    this.hiZ = hiZ;
    this.renderEntities = entities.query("transform", "renderable", "bounds");
  }

  setHighlight(hovered: Entity | null, selected: Entity | null): void {
    this.hovered = hovered;
    this.selected = selected;
  }

  isEntityVisible(entity: Entity): boolean {
    return this.visibleEntities.has(entity);
  }

  update(camera: PerspectiveCamera, viewportHeight: number): void {
    this.stats.visibleInstances = 0;
    this.stats.frustumCulled = 0;
    this.stats.occlusionCulled = 0;
    this.stats.occlusionTested = 0;
    this.stats.lodCounts[0] = 0;
    this.stats.lodCounts[1] = 0;
    this.stats.lodCounts[2] = 0;
    this.stats.batchCount = 0;
    this.visibleEntities.clear();

    this.viewMatrix.copy(camera.matrixWorldInverse);
    this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      this.viewMatrix,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    const cameraPosition = camera.position;
    const projectionScale =
      viewportHeight * camera.projectionMatrix.elements[5] * 0.5;

    for (const entity of this.renderEntities) {
      const transform = this.entities.requireComponent(entity, "transform");
      const bounds = this.entities.requireComponent(entity, "bounds");
      const renderable = this.entities.requireComponent(entity, "renderable");

      if (transform.dirty || bounds.dirty) {
        refreshWorldBounds(transform, bounds);
      }

      if (
        this.frustumCullingEnabled &&
        !this.frustum.intersectsSphere(bounds.worldSphere)
      ) {
        this.stats.frustumCulled++;
        continue;
      }

      const distance = Math.max(
        cameraPosition.distanceTo(bounds.worldSphere.center),
        bounds.worldSphere.radius * 0.5,
      );
      const pixelRadius =
        (bounds.worldSphere.radius / distance) * projectionScale;

      if (
        this.occlusionCullingEnabled &&
        this.hiZ.isAvailable &&
        renderable.occlusionTest &&
        distance > 4 &&
        pixelRadius < viewportHeight * 0.35
      ) {
        this.stats.occlusionTested++;
        if (
          this.hiZ.isOccluded(
            bounds.worldBox.min,
            bounds.worldBox.max,
            this.viewProjection,
            this.viewMatrix,
            camera,
          )
        ) {
          this.stats.occlusionCulled++;
          continue;
        }
      }

      const lodIndex = this.selectLod(renderable.lods, pixelRadius);
      const lod = renderable.lods[lodIndex];

      this.stats.lodCounts[Math.min(lodIndex, 2)]++;
      this.stats.visibleInstances++;
      this.visibleEntities.add(entity);

      this.writeInstance(
        entity,
        renderable.tint,
        lod,
        renderable,
        transform.matrix,
      );
    }

    this.finishFrame();
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.mesh);
      batch.mesh.dispose();
    }
    this.batches.clear();
    this.visibleEntities.clear();
  }

  private selectLod(
    lods: readonly RenderableLod[],
    pixelRadius: number,
  ): number {
    if (!this.lodEnabled || lods.length === 1) return 0;

    for (let i = 0; i < lods.length; i++) {
      if (pixelRadius >= lods[i].minScreenSize) return i;
    }

    return lods.length - 1;
  }

  private writeInstance(
    entity: Entity,
    tint: Color,
    lod: RenderableLod,
    renderable: {
      castShadow: boolean;
      receiveShadow: boolean;
    },
    matrix: Matrix4,
  ): void {
    const key = `${lod.geometry.uuid}|${lod.material.uuid}|${renderable.castShadow ? 1 : 0}${renderable.receiveShadow ? 1 : 0}`;
    let batch = this.batches.get(key);

    if (!batch) {
      batch = this.createBatch(
        key,
        lod,
        renderable.castShadow,
        renderable.receiveShadow,
      );
      this.batches.set(key, batch);
    }

    if (batch.count >= batch.capacity) this.growBatch(batch);

    const slot = batch.count++;
    matrix.toArray(batch.mesh.instanceMatrix.array, slot * 16);

    _color.copy(tint);
    if (entity === this.selected) {
      _color.lerp(_selectedColor, 0.72);
    } else if (entity === this.hovered) {
      _color.lerp(_hoverColor, 0.55).multiplyScalar(1.25);
    }

    const colors = batch.mesh.instanceColor;
    if (colors) _color.toArray(colors.array, slot * 3);
  }

  private createBatch(
    key: string,
    lod: RenderableLod,
    castShadow: boolean,
    receiveShadow: boolean,
  ): Batch {
    const mesh = new InstancedMesh(
      lod.geometry,
      lod.material,
      INITIAL_BATCH_CAPACITY,
    );
    mesh.name = `Batch.${lod.geometry.name || lod.geometry.uuid.slice(0, 6)}`;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(INITIAL_BATCH_CAPACITY * 3),
      3,
    );
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    // CPU culling already decided what is visible; do not test the combined
    // batch bounds against the frustum again.
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;

    this.scene.add(mesh);

    return {
      key,
      mesh,
      capacity: INITIAL_BATCH_CAPACITY,
      count: 0,
      geometry: lod.geometry,
      material: lod.material,
      castShadow,
      receiveShadow,
    };
  }

  private growBatch(batch: Batch): void {
    const nextCapacity = batch.capacity * 2;
    const mesh = new InstancedMesh(
      batch.geometry,
      batch.material,
      nextCapacity,
    );
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceMatrix.array.set(
      batch.mesh.instanceMatrix.array.subarray(0, batch.count * 16),
    );
    mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(nextCapacity * 3),
      3,
    );
    mesh.instanceColor.setUsage(DynamicDrawUsage);
    if (batch.mesh.instanceColor) {
      mesh.instanceColor.array.set(
        batch.mesh.instanceColor.array.subarray(0, batch.count * 3),
      );
    }
    mesh.castShadow = batch.castShadow;
    mesh.receiveShadow = batch.receiveShadow;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;

    this.scene.remove(batch.mesh);
    batch.mesh.dispose();
    this.scene.add(mesh);

    batch.mesh = mesh;
    batch.capacity = nextCapacity;
  }

  private finishFrame(): void {
    for (const batch of this.batches.values()) {
      const count = batch.count;
      if (count === 0) {
        batch.mesh.visible = false;
        batch.mesh.count = 0;
        batch.mesh.instanceMatrix.clearUpdateRanges();
        batch.mesh.instanceColor?.clearUpdateRanges();
        continue;
      }

      batch.mesh.count = count;
      batch.mesh.visible = true;
      batch.mesh.instanceMatrix.clearUpdateRanges();
      batch.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      batch.mesh.instanceMatrix.needsUpdate = true;

      if (batch.mesh.instanceColor) {
        batch.mesh.instanceColor.clearUpdateRanges();
        batch.mesh.instanceColor.addUpdateRange(0, count * 3);
        batch.mesh.instanceColor.needsUpdate = true;
      }

      this.stats.batchCount++;
      batch.count = 0;
    }
  }
}
