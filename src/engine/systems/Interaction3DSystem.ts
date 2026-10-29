import {
  AdditiveBlending,
  DoubleSide,
  Raycaster,
  RingGeometry,
  Vector2,
  Vector3,
} from "three";
import type { Camera, Scene } from "three";
import { MeshBasicNodeMaterial, Mesh } from "three/webgpu";
import type { Entity, EntitiesManager } from "../ecs/EntitiesManager";
import type { EntityInfo } from "../types";
import type { MeshInstanceSystem } from "./MeshInstanceSystem";
import type { SpatialSystem } from "./SpatialSystem";

export interface InteractionCallbacks {
  onHover: (info: EntityInfo | null) => void;
  onSelect: (info: EntityInfo | null) => void;
}

const MAX_PICK_DISTANCE = 95;
const CLICK_SLOP = 5;

/**
 * Pointer selection against ECS bounds. A spatial-hash ray walk keeps the
 * candidate set small, then per-entity AABB/ray tests pick the nearest prop.
 * Objects removed by frustum/Hi-Z culling are not selectable.
 */
export class Interaction3DSystem {
  private readonly domElement: HTMLCanvasElement;
  private readonly camera: Camera;
  private readonly entities: EntitiesManager;
  private readonly spatial: SpatialSystem;
  private readonly meshInstances: MeshInstanceSystem;
  private readonly callbacks: InteractionCallbacks;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly hitPoint = new Vector3();
  private readonly center = new Vector3();
  private readonly marker: Mesh;
  private readonly markerMaterial: MeshBasicNodeMaterial;

  private hovered: Entity | null = null;
  private selected: Entity | null = null;
  private pointerDownX = 0;
  private pointerDownY = 0;
  private pointerDownButton = -1;
  private markerBaseScale = 1;
  private markerTime = 0;

  constructor(
    domElement: HTMLCanvasElement,
    camera: Camera,
    scene: Scene,
    entities: EntitiesManager,
    spatial: SpatialSystem,
    meshInstances: MeshInstanceSystem,
    callbacks: InteractionCallbacks,
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.entities = entities;
    this.spatial = spatial;
    this.meshInstances = meshInstances;
    this.callbacks = callbacks;

    this.markerMaterial = new MeshBasicNodeMaterial({
      color: 0xffb23e,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
      side: DoubleSide,
      blending: AdditiveBlending,
    });
    this.marker = new Mesh(new RingGeometry(0.72, 1, 48), this.markerMaterial);
    this.marker.name = "Selection.Marker";
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    this.marker.renderOrder = 10;
    scene.add(this.marker);

    domElement.addEventListener("pointermove", this.handlePointerMove);
    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointerup", this.handlePointerUp);
    domElement.addEventListener("pointerleave", this.handlePointerLeave);
  }

  get hoveredEntity(): Entity | null {
    return this.hovered;
  }

  get selectedEntity(): Entity | null {
    return this.selected;
  }

  clearSelection(): void {
    if (this.selected === null) return;
    this.selected = null;
    this.marker.visible = false;
    this.callbacks.onSelect(null);
  }

  /** Pulse the selection ring and hide it when Hi-Z culls the selected prop. */
  update(delta: number): void {
    if (this.selected === null) {
      this.marker.visible = false;
      return;
    }

    if (!this.meshInstances.isEntityVisible(this.selected)) {
      this.marker.visible = false;
      return;
    }

    const bounds = this.entities.getComponent(this.selected, "bounds");
    if (!bounds) {
      this.marker.visible = false;
      return;
    }

    this.markerTime += delta;
    const pulse = Math.sin(this.markerTime * 3.2) * 0.06;
    this.marker.visible = true;
    this.marker.scale.setScalar(this.markerBaseScale * (1 + pulse));
    this.markerMaterial.opacity = 0.58 + Math.sin(this.markerTime * 3.2) * 0.16;
  }

  dispose(): void {
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener(
      "pointerleave",
      this.handlePointerLeave,
    );
    this.marker.removeFromParent();
    this.marker.geometry.dispose();
    this.markerMaterial.dispose();
    this.domElement.style.cursor = "";
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    this.updateHover(event.clientX, event.clientY);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointerDownX = event.clientX;
    this.pointerDownY = event.clientY;
    this.pointerDownButton = event.button;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (event.button !== 0 || this.pointerDownButton !== 0) return;

    const moved = Math.hypot(
      event.clientX - this.pointerDownX,
      event.clientY - this.pointerDownY,
    );
    this.pointerDownButton = -1;
    if (moved > CLICK_SLOP) return;

    const picked = this.pick(event.clientX, event.clientY);
    if (picked === null) {
      this.clearSelection();
      return;
    }

    this.selected = picked;
    this.updateHover(event.clientX, event.clientY);
    this.updateMarker(picked);

    const info = this.describe(picked);
    if (info) this.callbacks.onSelect(info);
  };

  private readonly handlePointerLeave = (): void => {
    this.setHovered(null);
    this.domElement.style.cursor = "";
  };

  private updateHover(clientX: number, clientY: number): void {
    const picked = this.pick(clientX, clientY);
    if (picked !== this.hovered) this.setHovered(picked);
  }

  private setHovered(entity: Entity | null): void {
    if (this.hovered === entity) return;
    this.hovered = entity;
    this.domElement.style.cursor = entity === null ? "" : "pointer";
    this.callbacks.onHover(entity === null ? null : this.describe(entity));
  }

  private pick(clientX: number, clientY: number): Entity | null {
    const rect = this.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const candidates = this.spatial.queryRay(
      this.raycaster.ray,
      MAX_PICK_DISTANCE,
    );

    let closestEntity: Entity | null = null;
    let closestDistance = Infinity;

    for (const entity of candidates) {
      if (!this.meshInstances.isEntityVisible(entity)) continue;

      const bounds = this.entities.getComponent(entity, "bounds");
      if (!bounds) continue;

      if (!this.raycaster.ray.intersectBox(bounds.worldBox, this.hitPoint)) {
        continue;
      }

      const distance = this.raycaster.ray.origin.distanceTo(this.hitPoint);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEntity = entity;
      }
    }

    return closestEntity;
  }

  private updateMarker(entity: Entity): void {
    const bounds = this.entities.getComponent(entity, "bounds");
    if (!bounds) {
      this.marker.visible = false;
      return;
    }

    bounds.worldBox.getCenter(this.center);
    this.marker.position.set(
      this.center.x,
      bounds.worldBox.min.y + 0.025,
      this.center.z,
    );

    const size = bounds.worldBox.getSize(new Vector3());
    this.markerBaseScale = Math.max(size.x, size.z) * 0.58 + 0.32;
    this.marker.scale.setScalar(this.markerBaseScale);
    this.marker.visible = true;
    this.markerTime = 0;
  }

  private describe(entity: Entity): EntityInfo | null {
    const interactive = this.entities.getComponent(entity, "interactive");
    const bounds = this.entities.getComponent(entity, "bounds");
    if (!interactive || !bounds) return null;

    bounds.worldBox.getCenter(this.center);
    return {
      entity,
      label: interactive.label,
      detail: interactive.detail,
      category: interactive.category,
      position: [this.center.x, this.center.y, this.center.z],
    };
  }
}
