import {
  Color,
  DoubleSide,
  FloatType,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
} from "three";
import type { Matrix4, PerspectiveCamera, Scene } from "three";
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget } from "three/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import {
  cameraFar,
  cameraNear,
  max,
  positionView,
  screenUV,
  texture,
  vec2,
  vec4,
} from "three/tsl";

const BASE_WIDTH = 512;
const BASE_HEIGHT = 288;
const READBACK_LEVEL = 2;
const DEPTH_BIAS = 0.0015;

/**
 * Conservative Hi-Z occlusion culling.
 *
 * A tiny linear-depth occluder pass is rendered on the GPU, then a max-depth
 * pyramid is built with fullscreen downsample passes. The coarse level is read
 * back asynchronously (never stalling the render loop) and used as the
 * conservative CPU depth texture for the next frame's AABB tests.
 *
 * Using max-depth means a box is culled only when every occluder pixel covering
 * it is closer than the box's nearest point. That makes false occlusion
 * impossible, at the cost of occasionally keeping a partially visible box.
 */
export class HiZSystem {
  readonly depthMaterial: MeshBasicNodeMaterial;
  readonly levels: number;
  readonly readbackWidth: number;
  readonly readbackHeight: number;

  private readonly renderer: WebGPURenderer;
  private readonly occluderScene: Scene;
  private readonly targets: RenderTarget[];
  private readonly downsampleMaterials: MeshBasicNodeMaterial[] = [];
  private readonly quadMesh: QuadMesh;
  private readonly savedClearColor = new Color();

  private readonly depthData: Float32Array;
  private available = false;
  private disposed = false;
  private readbackPending = false;
  private frame = 0;
  private lastReadbackMs = 0;

  private readonly _corner = new Vector3();
  private readonly _view = new Vector3();
  private readonly _clip = new Vector4();

  constructor(renderer: WebGPURenderer, occluderScene: Scene) {
    this.renderer = renderer;
    this.occluderScene = occluderScene;

    this.depthMaterial = new MeshBasicNodeMaterial({
      side: DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const normalizedDepth = positionView.z
      .negate()
      .sub(cameraNear)
      .div(cameraFar.sub(cameraNear))
      .saturate();
    this.depthMaterial.colorNode = vec4(
      normalizedDepth,
      normalizedDepth,
      normalizedDepth,
      1,
    );

    occluderScene.overrideMaterial = this.depthMaterial;

    // Build the render-target chain: 512x288 -> 256x144 -> ... -> 8x4.
    this.targets = [];
    let width = BASE_WIDTH;
    let height = BASE_HEIGHT;
    while (width >= 8 && height >= 4) {
      const target = new RenderTarget(width, height, {
        depthBuffer: this.targets.length === 0,
        stencilBuffer: false,
        type: FloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        generateMipmaps: false,
      });
      target.texture.name = `HiZ.level${this.targets.length}`;
      this.targets.push(target);

      width = Math.max(1, Math.floor(width / 2));
      height = Math.max(1, Math.floor(height / 2));
    }
    this.levels = this.targets.length;

    const readbackTarget = this.targets[READBACK_LEVEL];
    this.readbackWidth = readbackTarget.width;
    this.readbackHeight = readbackTarget.height;
    this.depthData = new Float32Array(this.readbackWidth * this.readbackHeight);

    // One max-of-2x2 material per mip level.
    for (let level = 1; level < this.targets.length; level++) {
      const source = this.targets[level - 1];
      const sourceWidth = source.width;
      const sourceHeight = source.height;
      // Keep these as plain numbers: passing a TSL vec2 component into another
      // vec2 node currently constant-folds to NaN in WGSL.
      const halfTexelX = 0.5 / sourceWidth;
      const halfTexelY = 0.5 / sourceHeight;

      const sampleA = texture(
        source.texture,
        screenUV.add(vec2(-halfTexelX, -halfTexelY)),
      ).r;
      const sampleB = texture(
        source.texture,
        screenUV.add(vec2(halfTexelX, -halfTexelY)),
      ).r;
      const sampleC = texture(
        source.texture,
        screenUV.add(vec2(-halfTexelX, halfTexelY)),
      ).r;
      const sampleD = texture(
        source.texture,
        screenUV.add(vec2(halfTexelX, halfTexelY)),
      ).r;

      const material = new MeshBasicNodeMaterial({
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      const maxDepth = max(max(sampleA, sampleB), max(sampleC, sampleD));
      material.colorNode = vec4(maxDepth, maxDepth, maxDepth, 1);
      this.downsampleMaterials.push(material);
    }

    this.quadMesh = new QuadMesh(this.downsampleMaterials[0]);
  }

  get isAvailable(): boolean {
    return this.available && !this.disposed;
  }

  get lastReadbackDuration(): number {
    return this.lastReadbackMs;
  }

  /** Drop the CPU depth copy, e.g. while the camera is flying to a preset. */
  invalidate(): void {
    this.available = false;
  }

  /** Renders the occluder depth pass and builds the Hi-Z mip chain. */
  update(camera: PerspectiveCamera): void {
    if (this.disposed) return;

    const renderer = this.renderer;
    renderer.getClearColor(this.savedClearColor);
    const savedClearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0xffffff, 1);

    renderer.setRenderTarget(this.targets[0]);
    renderer.clear(true, true, true);
    renderer.render(this.occluderScene, camera);

    for (let level = 1; level < this.targets.length; level++) {
      renderer.setRenderTarget(this.targets[level]);
      this.quadMesh.material = this.downsampleMaterials[level - 1];
      this.quadMesh.render(renderer);
    }

    renderer.setRenderTarget(null);
    renderer.setClearColor(this.savedClearColor, savedClearAlpha);

    this.frame++;
    if (this.frame % 2 === 0 && !this.readbackPending) {
      void this.resolveReadback();
    }
  }

  /**
   * Conservative screen-space AABB test against the coarse max-depth pyramid.
   * Returns true only when the whole projected box is behind the occluders.
   */
  isOccluded(
    worldBoxMin: Vector3,
    worldBoxMax: Vector3,
    viewProjection: Matrix4,
    viewMatrix: Matrix4,
    camera: PerspectiveCamera,
  ): boolean {
    if (!this.available) return false;

    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    let nearestDepth = Infinity;

    const near = camera.near;
    const far = camera.far;
    const depthRange = far - near;

    for (let i = 0; i < 8; i++) {
      this._corner.set(
        i & 1 ? worldBoxMax.x : worldBoxMin.x,
        i & 2 ? worldBoxMax.y : worldBoxMin.y,
        i & 4 ? worldBoxMax.z : worldBoxMin.z,
      );

      this._view.copy(this._corner).applyMatrix4(viewMatrix);
      if (this._view.z > -near) return false; // crosses the near plane

      this._clip
        .set(this._corner.x, this._corner.y, this._corner.z, 1)
        .applyMatrix4(viewProjection);
      const inverseW = 1 / this._clip.w;
      const ndcX = this._clip.x * inverseW;
      const ndcY = this._clip.y * inverseW;

      const u = ndcX * 0.5 + 0.5;
      const v = 0.5 - ndcY * 0.5; // WebGPU readback rows are top-down.

      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;

      const depth = (-this._view.z - near) / depthRange;
      if (depth < nearestDepth) nearestDepth = depth;
    }

    if (maxU < 0 || minU > 1 || maxV < 0 || minV > 1) return false;
    if (nearestDepth < 0.012) return false; // too close to trust one-frame-old depth

    const width = this.readbackWidth;
    const height = this.readbackHeight;
    const padding = 1; // texels of tail for camera movement

    const x0 = Math.max(0, Math.floor(Math.min(minU, maxU) * width) - padding);
    const x1 = Math.min(
      width - 1,
      Math.ceil(Math.max(minU, maxU) * width) - 1 + padding,
    );
    const y0 = Math.max(0, Math.floor(Math.min(minV, maxV) * height) - padding);
    const y1 = Math.min(
      height - 1,
      Math.ceil(Math.max(minV, maxV) * height) - 1 + padding,
    );

    const coveredPixels = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (coveredPixels > width * height * 0.42) return false;

    let farthestOccluder = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * width;
      for (let x = x0; x <= x1; x++) {
        const depth = this.depthData[row + x];
        if (depth > farthestOccluder) farthestOccluder = depth;
      }
    }

    // Occluded only if even the farthest occluder in the box's screen region
    // is closer than the box's nearest point.
    return farthestOccluder + DEPTH_BIAS < nearestDepth;
  }

  /** CPU copy of the coarse level, for the telemetry depth preview. */
  getDepthData(): Float32Array {
    return this.depthData;
  }

  dispose(): void {
    this.disposed = true;
    for (const target of this.targets) target.dispose();
    for (const material of this.downsampleMaterials) material.dispose();
    this.depthMaterial.dispose();
  }

  private async resolveReadback(): Promise<void> {
    this.readbackPending = true;
    const started = performance.now();

    try {
      const pixels = await this.renderer.readRenderTargetPixelsAsync(
        this.targets[READBACK_LEVEL],
        0,
        0,
        this.readbackWidth,
        this.readbackHeight,
      );

      if (!(pixels instanceof Float32Array)) {
        throw new Error("Hi-Z readback returned an unexpected buffer type");
      }
      if (this.disposed) return;

      // copyTextureToBuffer aligns rows to 256 bytes. Our readback widths are
      const floatsPerRow = pixels.length / this.readbackHeight;
      for (let y = 0; y < this.readbackHeight; y++) {
        const sourceRow = y * floatsPerRow;
        const destinationRow = y * this.readbackWidth;
        for (let x = 0; x < this.readbackWidth; x++) {
          this.depthData[destinationRow + x] = pixels[sourceRow + x * 4];
        }
      }

      this.available = true;
      this.lastReadbackMs = performance.now() - started;
    } catch (error) {
      // A failed readback must never break the scene. Occlusion culling simply
      // stays off and the rest of the pipeline keeps rendering.
      console.warn(
        "Hi-Z readback unavailable; occlusion culling disabled.",
        error,
      );
      this.available = false;
    } finally {
      this.readbackPending = false;
    }
  }
}
