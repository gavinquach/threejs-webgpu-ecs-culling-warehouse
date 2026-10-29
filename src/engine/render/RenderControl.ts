import {
  ACESFilmicToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import type { RenderTarget } from "three";
import { WebGPURenderer } from "three/webgpu";
import { PMREMGenerator } from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { BackendName } from "../types";

const _size = new Vector2();

interface CameraFlight {
  position: Vector3;
  target: Vector3;
}

/** Owns the WebGPU renderer, scene, camera, controls, atmosphere and resize. */
export class RenderControl {
  readonly renderer: WebGPURenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly backend: BackendName;

  private readonly container: HTMLElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly environmentTarget: RenderTarget;
  private flight: CameraFlight | null = null;
  private disposed = false;

  static async create(container: HTMLElement): Promise<RenderControl> {
    const renderer = new WebGPURenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    await renderer.init();
    return new RenderControl(container, renderer);
  }

  constructor(container: HTMLElement, renderer: WebGPURenderer) {
    this.container = container;
    this.renderer = renderer;
    this.backend = "isWebGPUBackend" in renderer.backend ? "WEBGPU" : "WEBGL2";

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.info.autoReset = false;

    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive WebGPU warehouse",
    );
    container.appendChild(renderer.domElement);

    this.scene = new Scene();
    this.scene.background = new Color(0x0a0e12);
    this.scene.fog = new Fog(0x0a0e12, 42, 138);

    this.camera = new PerspectiveCamera(52, 1, 0.1, 240);
    this.camera.position.set(6, 7.4, 21);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.target.set(5, 2.2, -6);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.065;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 46;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.screenSpacePanning = true;
    this.controls.update();

    this.addLighting();
    this.environmentTarget = this.createEnvironment(renderer);
    this.scene.environment = this.environmentTarget.texture;
    this.scene.environmentIntensity = 0.6;

    const rect = container.getBoundingClientRect();
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    this.camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    this.camera.updateProjectionMatrix();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  get viewportHeight(): number {
    this.renderer.getDrawingBufferSize(_size);
    return _size.y;
  }

  get isFlying(): boolean {
    return this.flight !== null;
  }

  get drawCalls(): number {
    return this.renderer.info.render.drawCalls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  resetInfo(): void {
    this.renderer.info.reset();
  }

  flyTo(position: Vector3, target: Vector3): void {
    this.flight = {
      position: position.clone(),
      target: target.clone(),
    };
    this.controls.enabled = false;
  }

  update(delta: number): void {
    if (this.flight) {
      const factor = 1 - Math.exp(-delta * 4.2);
      this.camera.position.lerp(this.flight.position, factor);
      this.controls.target.lerp(this.flight.target, factor);
      this.camera.lookAt(this.controls.target);

      if (
        this.camera.position.distanceToSquared(this.flight.position) < 0.0025 &&
        this.controls.target.distanceToSquared(this.flight.target) < 0.0025
      ) {
        this.camera.position.copy(this.flight.position);
        this.controls.target.copy(this.flight.target);
        this.flight = null;
        this.controls.enabled = true;
        this.controls.update();
      }
    } else {
      this.controls.update();
    }

    this.camera.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.environment = null;
    this.environmentTarget.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    if (this.disposed) return;
    const rect = this.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private addLighting(): void {
    const hemisphere = new HemisphereLight(0xc7d8ea, 0x3b2c1e, 1.1);
    this.scene.add(hemisphere);

    const key = new DirectionalLight(0xfff0d5, 4.2);
    key.position.set(26, 44, 20);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -38;
    key.shadow.camera.right = 38;
    key.shadow.camera.top = 38;
    key.shadow.camera.bottom = -38;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 120;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.035;
    this.scene.add(key);
    this.scene.add(key.target);

    const fill = new DirectionalLight(0x7fa3cf, 1.3);
    fill.position.set(-30, 18, -34);
    this.scene.add(fill);
  }

  private createEnvironment(renderer: WebGPURenderer): RenderTarget {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Unable to build the warehouse environment map");

    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#33536f");
    gradient.addColorStop(0.42, "#8fa5b8");
    gradient.addColorStop(0.55, "#e2c79a");
    gradient.addColorStop(0.62, "#5c5144");
    gradient.addColorStop(1, "#171a1c");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 256);

    const glow = context.createRadialGradient(365, 120, 4, 365, 120, 100);
    glow.addColorStop(0, "rgba(255, 242, 210, 0.95)");
    glow.addColorStop(1, "rgba(255, 242, 210, 0)");
    context.fillStyle = glow;
    context.fillRect(265, 20, 200, 200);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.mapping = EquirectangularReflectionMapping;

    const generator = new PMREMGenerator(renderer);
    const target = generator.fromEquirectangular(texture);
    texture.dispose();
    return target;
  }
}
