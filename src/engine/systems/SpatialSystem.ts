import type { Box3, Ray } from "three";
import type { Entity, EntitiesManager } from "../ecs/EntitiesManager";
import { refreshWorldBounds } from "../ecs/components";

const CELL_SIZE = 4;
const CELL_OFFSET = 512;
const CELL_STRIDE = 2048;

/**
 * Uniform XZ spatial hash used by selection/ray queries.
 *
 * Only interactive props are inserted. A ray walks the cells with a 2D DDA, so
 * a pointer query touches a handful of buckets instead of the full warehouse.
 */
export class SpatialSystem {
  private readonly entities: EntitiesManager;
  private readonly cells = new Map<number, Set<Entity>>();

  constructor(entities: EntitiesManager) {
    this.entities = entities;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  get indexedEntityCount(): number {
    const unique = new Set<Entity>();
    for (const bucket of this.cells.values()) {
      for (const entity of bucket) unique.add(entity);
    }
    return unique.size;
  }

  rebuild(): void {
    this.cells.clear();

    const entities = this.entities.query("transform", "bounds", "interactive");
    for (const entity of entities) {
      const transform = this.entities.requireComponent(entity, "transform");
      const bounds = this.entities.requireComponent(entity, "bounds");
      refreshWorldBounds(transform, bounds);

      const minX = Math.floor(bounds.worldBox.min.x / CELL_SIZE);
      const maxX = Math.floor(bounds.worldBox.max.x / CELL_SIZE);
      const minZ = Math.floor(bounds.worldBox.min.z / CELL_SIZE);
      const maxZ = Math.floor(bounds.worldBox.max.z / CELL_SIZE);

      for (let cellX = minX; cellX <= maxX; cellX++) {
        for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
          const key = this.cellKey(cellX, cellZ);
          let bucket = this.cells.get(key);
          if (!bucket) {
            bucket = new Set();
            this.cells.set(key, bucket);
          }
          bucket.add(entity);
        }
      }
    }
  }

  queryRay(ray: Ray, maxDistance: number): Entity[] {
    const result = new Set<Entity>();

    let cellX = Math.floor(ray.origin.x / CELL_SIZE);
    let cellZ = Math.floor(ray.origin.z / CELL_SIZE);
    this.collectCell(cellX, cellZ, result);

    const direction = ray.direction;
    const stepX = direction.x >= 0 ? 1 : -1;
    const stepZ = direction.z >= 0 ? 1 : -1;

    const deltaX =
      direction.x === 0 ? Infinity : Math.abs(CELL_SIZE / direction.x);
    const deltaZ =
      direction.z === 0 ? Infinity : Math.abs(CELL_SIZE / direction.z);

    const nextBoundaryX =
      direction.x === 0
        ? Infinity
        : ((cellX + (stepX > 0 ? 1 : 0)) * CELL_SIZE - ray.origin.x) /
          direction.x;
    const nextBoundaryZ =
      direction.z === 0
        ? Infinity
        : ((cellZ + (stepZ > 0 ? 1 : 0)) * CELL_SIZE - ray.origin.z) /
          direction.z;

    let distanceToX = nextBoundaryX > 0 ? nextBoundaryX : Infinity;
    let distanceToZ = nextBoundaryZ > 0 ? nextBoundaryZ : Infinity;
    let distance = 0;
    let steps = 0;

    while (distance <= maxDistance && steps++ < 512) {
      if (distanceToX < distanceToZ) {
        cellX += stepX;
        distance = distanceToX;
        distanceToX += deltaX;
      } else {
        cellZ += stepZ;
        distance = distanceToZ;
        distanceToZ += deltaZ;
      }

      if (distance > maxDistance) break;
      this.collectCell(cellX, cellZ, result);
    }

    return Array.from(result);
  }

  /** Returns all interactive entities whose AABB overlaps `box`. */
  queryBox(box: Box3): Entity[] {
    const result = new Set<Entity>();
    const minX = Math.floor(box.min.x / CELL_SIZE);
    const maxX = Math.floor(box.max.x / CELL_SIZE);
    const minZ = Math.floor(box.min.z / CELL_SIZE);
    const maxZ = Math.floor(box.max.z / CELL_SIZE);

    for (let cellX = minX; cellX <= maxX; cellX++) {
      for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
        this.collectCell(cellX, cellZ, result);
      }
    }

    return Array.from(result);
  }

  dispose(): void {
    this.cells.clear();
  }

  private collectCell(cellX: number, cellZ: number, target: Set<Entity>): void {
    const bucket = this.cells.get(this.cellKey(cellX, cellZ));
    if (!bucket) return;
    for (const entity of bucket) target.add(entity);
  }

  private cellKey(cellX: number, cellZ: number): number {
    return (cellX + CELL_OFFSET) * CELL_STRIDE + (cellZ + CELL_OFFSET);
  }
}
