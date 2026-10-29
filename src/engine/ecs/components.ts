import { Box3, Color, Matrix4, Quaternion, Sphere, Vector3 } from "three";
import type { BufferGeometry, Euler } from "three";
import type { NodeMaterial } from "three/webgpu";

/**
 * One draw variant of a renderable. Higher `minScreenSize` values are more
 * detailed and only selected while the prop covers enough pixels.
 */
export interface RenderableLod {
  geometry: BufferGeometry;
  material: NodeMaterial;
  /** Minimum projected radius in CSS pixels. Use 0 for a non-LOD mesh. */
  minScreenSize: number;
}

export interface RenderableComponent {
  /** Sorted from most detailed to least detailed. */
  lods: readonly RenderableLod[];
  /** Multiplied with the material color through per-instance color. */
  tint: Color;
  castShadow: boolean;
  receiveShadow: boolean;
  /** Structural proxies are excluded from the Hi-Z test to avoid self-culling. */
  occlusionTest: boolean;
}

export interface TransformComponent {
  matrix: Matrix4;
  dirty: boolean;
}

export interface BoundsComponent {
  localBox: Box3;
  localSphere: Sphere;
  worldBox: Box3;
  worldSphere: Sphere;
  dirty: boolean;
}

export interface InteractiveComponent {
  label: string;
  detail: string;
  category: string;
}

const _positions = {
  position: new Vector3(),
  rotation: new Quaternion(),
  scale: new Vector3(),
};

/** Builds a transform from position/euler/scale without retaining caller-owned data. */
export function createTransform(
  position: Vector3,
  euler: Euler,
  scale: Vector3 = new Vector3(1, 1, 1),
): TransformComponent {
  _positions.position.copy(position);
  _positions.rotation.setFromEuler(euler);
  _positions.scale.copy(scale);

  const matrix = new Matrix4().compose(
    _positions.position,
    _positions.rotation,
    _positions.scale,
  );

  return { matrix, dirty: false };
}

/** Builds local/world bounds from the most detailed geometry. */
export function createBounds(geometry: BufferGeometry): BoundsComponent {
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();

  const localBox = geometry.boundingBox?.clone() ?? new Box3();
  const localSphere = geometry.boundingSphere?.clone() ?? new Sphere();

  return {
    localBox,
    localSphere,
    worldBox: localBox.clone(),
    worldSphere: localSphere.clone(),
    dirty: true,
  };
}

/** Refreshes cached world-space bounds when the transform or bounds changed. */
export function refreshWorldBounds(
  transform: TransformComponent,
  bounds: BoundsComponent,
): void {
  if (!transform.dirty && !bounds.dirty) return;

  bounds.worldBox.copy(bounds.localBox).applyMatrix4(transform.matrix);
  bounds.worldSphere.copy(bounds.localSphere).applyMatrix4(transform.matrix);
  transform.dirty = false;
  bounds.dirty = false;
}

export function createRenderable(
  lods: readonly RenderableLod[],
  options: {
    tint?: number | Color;
    castShadow?: boolean;
    receiveShadow?: boolean;
    occlusionTest?: boolean;
  } = {},
): RenderableComponent {
  return {
    lods,
    tint: new Color(options.tint ?? 0xffffff),
    castShadow: options.castShadow ?? true,
    receiveShadow: options.receiveShadow ?? true,
    occlusionTest: options.occlusionTest ?? true,
  };
}

/** Convenience used by the warehouse builder for single-detail structural meshes. */
export function singleLod(
  geometry: BufferGeometry,
  material: NodeMaterial,
): RenderableLod {
  return { geometry, material, minScreenSize: 0 };
}
