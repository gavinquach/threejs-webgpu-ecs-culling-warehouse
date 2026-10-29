import {
  BoxGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  Mesh,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import type { BufferGeometry, Material, Object3D } from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { EntitiesManager } from "../ecs/EntitiesManager";
import type { InteractiveComponent, RenderableLod } from "../ecs/components";
import {
  createBounds,
  createRenderable,
  createTransform,
  singleLod,
} from "../ecs/components";
import type { WarehouseMaterials } from "./materials";

const WALL_HEIGHT = 12.5;
const HALF_WIDTH = 32;
const HALF_DEPTH = 22;
const RACK_ROWS = [-24, -12, 0, 12, 24];
const RACK_BAYS = 12;
const RACK_BAY_WIDTH = 3;
const RACK_DEPTH = 2.4;
const RACK_HEIGHT = 9;
const RACK_LEVELS = [1.9, 4.9, 7.9];
const RACK_START_Z = -18;

const _euler = new Euler();
const _scale = new Vector3(1, 1, 1);
const _quaternion = new Quaternion();

interface SpawnOptions {
  lods: readonly RenderableLod[];
  position: Vector3;
  rotation?: Euler;
  scale?: Vector3;
  tint?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  occlusionTest?: boolean;
  interactive?: InteractiveComponent;
}

interface OccluderBox {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotationY?: number;
}

/**
 * Procedural warehouse: shell, high-bay racking, ~1k stored props, lighting and
 * a merged occluder proxy used by the Hi-Z depth pass.
 */
export class WarehouseWorld {
  readonly occluderScene = new Scene();

  private readonly entities: EntitiesManager;
  private readonly scene: Scene;
  private readonly materials: WarehouseMaterials;

  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly plane = new PlaneGeometry(1, 1);
  private readonly crateHigh = new RoundedBoxGeometry(1, 1, 1, 3, 0.045);
  private readonly cartonHigh = new RoundedBoxGeometry(1, 1, 1, 2, 0.025);
  private readonly barrelHigh = new CylinderGeometry(0.5, 0.5, 1, 24, 1);
  private readonly barrelMid = new CylinderGeometry(0.5, 0.5, 1, 12, 1);
  private readonly barrelLow = new CylinderGeometry(0.5, 0.5, 1, 8, 1);
  private readonly bollardGeometry = new CylinderGeometry(0.12, 0.15, 1, 12);
  private readonly wheelGeometry = new CylinderGeometry(0.33, 0.33, 0.24, 16);
  private readonly wireGeometry = new CylinderGeometry(0.015, 0.015, 1, 6);
  private readonly lampHousingGeometry = new CylinderGeometry(
    0.42,
    0.3,
    0.22,
    16,
  );
  private readonly lampGlowGeometry = new CylinderGeometry(
    0.25,
    0.25,
    0.05,
    16,
  );
  private readonly palletHigh = this.createPalletGeometry();

  private readonly occluderBoxes: OccluderBox[] = [];
  private readonly pointLights: PointLight[] = [];
  private readonly propCatalog: {
    crate: RenderableLod[];
    metalCrate: RenderableLod[];
    carton: RenderableLod[];
    barrel: RenderableLod[];
    pallet: RenderableLod[];
  };

  private random = this.createRandom(20261029);

  constructor(
    entities: EntitiesManager,
    scene: Scene,
    materials: WarehouseMaterials,
  ) {
    this.entities = entities;
    this.scene = scene;
    this.materials = materials;

    this.crateHigh.name = "Crate.High";
    this.cartonHigh.name = "Carton.High";
    this.barrelHigh.name = "Barrel.High";
    this.barrelMid.name = "Barrel.Mid";
    this.barrelLow.name = "Barrel.Low";

    this.propCatalog = {
      crate: [
        {
          geometry: this.crateHigh,
          material: materials.woodCrate,
          minScreenSize: 74,
        },
        {
          geometry: this.unitBox,
          material: materials.woodCrate,
          minScreenSize: 24,
        },
        {
          geometry: this.unitBox,
          material: materials.woodCrateLow,
          minScreenSize: 0,
        },
      ],
      metalCrate: [
        {
          geometry: this.crateHigh,
          material: materials.steel,
          minScreenSize: 74,
        },
        {
          geometry: this.unitBox,
          material: materials.steel,
          minScreenSize: 24,
        },
        {
          geometry: this.unitBox,
          material: materials.rackBack,
          minScreenSize: 0,
        },
      ],
      carton: [
        {
          geometry: this.cartonHigh,
          material: materials.cardboard,
          minScreenSize: 68,
        },
        {
          geometry: this.unitBox,
          material: materials.cardboard,
          minScreenSize: 22,
        },
        {
          geometry: this.unitBox,
          material: materials.cardboardLow,
          minScreenSize: 0,
        },
      ],
      barrel: [
        {
          geometry: this.barrelHigh,
          material: materials.barrel,
          minScreenSize: 58,
        },
        {
          geometry: this.barrelMid,
          material: materials.barrel,
          minScreenSize: 20,
        },
        {
          geometry: this.barrelLow,
          material: materials.barrelLow,
          minScreenSize: 0,
        },
      ],
      pallet: [
        {
          geometry: this.palletHigh,
          material: materials.pallet,
          minScreenSize: 52,
        },
        {
          geometry: this.unitBox,
          material: materials.pallet,
          minScreenSize: 18,
        },
        {
          geometry: this.unitBox,
          material: materials.palletLow,
          minScreenSize: 0,
        },
      ],
    };
  }

  build(): void {
    this.buildShell();
    this.buildRacking();
    this.buildStagedFreight();
    this.buildForklift(-17.4, 7.5, 0.38);
    this.buildForklift(16.8, -12.4, -1.2);
    this.buildLighting();
    this.buildFloorMarkings();
    this.buildSignage();
    this.finalizeOccluders();
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();

    for (const entity of this.entities.query("renderable")) {
      const renderable = this.entities.requireComponent(entity, "renderable");
      for (const lod of renderable.lods) {
        geometries.add(lod.geometry);
        materials.add(lod.material);
      }
    }

    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();

    for (const light of this.pointLights) light.removeFromParent();
    this.pointLights.length = 0;

    this.occluderScene.traverse((object: Object3D) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          for (const entry of material) entry.dispose();
        } else {
          material.dispose();
        }
      }
    });
    this.occluderScene.clear();
    this.scene.clear();
  }

  private buildShell(): void {
    // Concrete slab.
    this.spawn({
      lods: [singleLod(this.plane, this.materials.concrete)],
      position: new Vector3(0, 0, 0),
      rotation: new Euler(-Math.PI / 2, 0, 0),
      scale: new Vector3(HALF_WIDTH * 2, HALF_DEPTH * 2, 1),
      receiveShadow: true,
      castShadow: false,
      occlusionTest: false,
    });
    this.addOccluderBox(0, -0.12, 0, HALF_WIDTH * 2, 0.24, HALF_DEPTH * 2);

    // Exterior dock apron so the outside view has a floor instead of a void.
    this.spawn({
      lods: [singleLod(this.plane, this.materials.concrete)],
      position: new Vector3(0, -0.01, HALF_DEPTH + 13),
      rotation: new Euler(-Math.PI / 2, 0, 0),
      scale: new Vector3(HALF_WIDTH * 2, 26, 1),
      receiveShadow: true,
      castShadow: false,
      occlusionTest: false,
    });

    // Roof deck.
    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.roof)],
      position: new Vector3(0, WALL_HEIGHT + 0.14, 0),
      scale: new Vector3(HALF_WIDTH * 2, 0.28, HALF_DEPTH * 2),
      castShadow: false,
      receiveShadow: false,
      occlusionTest: false,
    });
    this.addOccluderBox(
      0,
      WALL_HEIGHT + 0.14,
      0,
      HALF_WIDTH * 2,
      0.28,
      HALF_DEPTH * 2,
    );

    // Back and side walls.
    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.wall)],
      position: new Vector3(0, WALL_HEIGHT / 2, -HALF_DEPTH),
      scale: new Vector3(HALF_WIDTH * 2, WALL_HEIGHT, 0.3),
      receiveShadow: true,
    });
    this.addOccluderBox(
      0,
      WALL_HEIGHT / 2,
      -HALF_DEPTH,
      HALF_WIDTH * 2,
      WALL_HEIGHT,
      0.3,
    );

    for (const side of [-1, 1]) {
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.wall)],
        position: new Vector3(side * HALF_WIDTH, WALL_HEIGHT / 2, 0),
        scale: new Vector3(0.3, WALL_HEIGHT, HALF_DEPTH * 2),
        receiveShadow: true,
      });
      this.addOccluderBox(
        side * HALF_WIDTH,
        WALL_HEIGHT / 2,
        0,
        0.3,
        WALL_HEIGHT,
        HALF_DEPTH * 2,
      );
    }

    // Front wall around the 10m dock opening.
    const frontZ = HALF_DEPTH;
    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.wall)],
      position: new Vector3(-18.5, WALL_HEIGHT / 2, frontZ),
      scale: new Vector3(27, WALL_HEIGHT, 0.3),
      receiveShadow: true,
    });
    this.addOccluderBox(-18.5, WALL_HEIGHT / 2, frontZ, 27, WALL_HEIGHT, 0.3);

    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.wall)],
      position: new Vector3(18.5, WALL_HEIGHT / 2, frontZ),
      scale: new Vector3(27, WALL_HEIGHT, 0.3),
      receiveShadow: true,
    });
    this.addOccluderBox(18.5, WALL_HEIGHT / 2, frontZ, 27, WALL_HEIGHT, 0.3);

    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.wall)],
      position: new Vector3(0, 9.5, frontZ),
      scale: new Vector3(10, 6, 0.3),
      receiveShadow: true,
    });
    this.addOccluderBox(0, 9.5, frontZ, 10, 6, 0.3);

    // Low wall trim.
    for (const side of [-1, 1]) {
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.wallTrim)],
        position: new Vector3(side * (HALF_WIDTH - 0.18), 0.65, 0),
        scale: new Vector3(0.06, 1.25, HALF_DEPTH * 2 - 0.2),
        castShadow: false,
      });
    }

    // Bright dock opening and interior wall windows.
    this.spawn({
      lods: [singleLod(this.plane, this.materials.doorGlow)],
      position: new Vector3(0, 3.25, frontZ + 0.22),
      rotation: new Euler(0, Math.PI, 0),
      scale: new Vector3(9.6, 6.2, 1),
      castShadow: false,
      receiveShadow: false,
      occlusionTest: false,
    });

    for (const side of [-1, 1]) {
      for (const z of [-14, 0, 14]) {
        this.spawn({
          lods: [singleLod(this.plane, this.materials.skylight)],
          position: new Vector3(side * (HALF_WIDTH - 0.18), 10.2, z),
          rotation: new Euler(0, (-Math.PI / 2) * side, 0),
          scale: new Vector3(2.8, 1.25, 1),
          castShadow: false,
          receiveShadow: false,
          occlusionTest: false,
        });
      }
    }

    // Skylight strips.
    for (const x of [-16, 0, 16]) {
      this.spawn({
        lods: [singleLod(this.plane, this.materials.skylight)],
        position: new Vector3(x, WALL_HEIGHT - 0.06, 0),
        rotation: new Euler(Math.PI / 2, 0, 0),
        scale: new Vector3(2.2, 34, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
    }

    this.buildRoofTrusses();
    this.buildWallColumns();
  }

  private buildRoofTrusses(): void {
    for (let z = -20; z <= 20; z += 5) {
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.steel)],
        position: new Vector3(0, 11.9, z),
        scale: new Vector3(HALF_WIDTH * 2 - 0.4, 0.18, 0.18),
        castShadow: false,
        receiveShadow: false,
      });
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.steel)],
        position: new Vector3(0, 10.7, z),
        scale: new Vector3(HALF_WIDTH * 2 - 0.4, 0.12, 0.12),
        castShadow: false,
        receiveShadow: false,
      });

      for (let x = -28; x <= 28; x += 7) {
        this.spawn({
          lods: [singleLod(this.unitBox, this.materials.steel)],
          position: new Vector3(x, 11.3, z),
          scale: new Vector3(0.1, 1.2, 0.1),
          castShadow: false,
          receiveShadow: false,
        });
        this.spawn({
          lods: [singleLod(this.unitBox, this.materials.steel)],
          position: new Vector3(x + 1.75, 11.3, z),
          rotation: new Euler(0, 0, 0.5),
          scale: new Vector3(0.09, 2.6, 0.09),
          castShadow: false,
          receiveShadow: false,
        });
      }
    }
  }

  private buildWallColumns(): void {
    for (const side of [-1, 1]) {
      for (let z = -18; z <= 18; z += 6) {
        this.spawn({
          lods: [singleLod(this.unitBox, this.materials.steel)],
          position: new Vector3(side * (HALF_WIDTH - 0.35), 6, z),
          scale: new Vector3(0.35, 12, 0.5),
          receiveShadow: true,
        });
      }
    }
  }

  private buildRacking(): void {
    const shelfBoardGeometry = new BoxGeometry(
      RACK_DEPTH - 0.16,
      0.06,
      RACK_BAY_WIDTH - 0.12,
    );
    const beamGeometry = new BoxGeometry(0.12, 0.15, RACK_BAY_WIDTH - 0.1);
    const uprightGeometry = new BoxGeometry(0.14, RACK_HEIGHT, 0.14);

    for (let row = 0; row < RACK_ROWS.length; row++) {
      const rowX = RACK_ROWS[row];
      const rowLabel = String.fromCharCode(65 + row);

      for (let bay = 0; bay <= RACK_BAYS; bay++) {
        const z = RACK_START_Z + bay * RACK_BAY_WIDTH;
        for (const xOffset of [-RACK_DEPTH / 2, RACK_DEPTH / 2]) {
          this.spawn({
            lods: [singleLod(uprightGeometry, this.materials.steel)],
            position: new Vector3(rowX + xOffset, RACK_HEIGHT / 2, z),
            receiveShadow: true,
          });
          this.addOccluderBox(
            rowX + xOffset,
            RACK_HEIGHT / 2,
            z,
            0.14,
            RACK_HEIGHT,
            0.14,
          );
        }
      }

      for (let bay = 0; bay < RACK_BAYS; bay++) {
        const bayZ = RACK_START_Z + (bay + 0.5) * RACK_BAY_WIDTH;

        for (const levelY of RACK_LEVELS) {
          for (const xOffset of [
            -RACK_DEPTH / 2 + 0.08,
            RACK_DEPTH / 2 - 0.08,
          ]) {
            this.spawn({
              lods: [singleLod(beamGeometry, this.materials.beam)],
              position: new Vector3(rowX + xOffset, levelY, bayZ),
              receiveShadow: true,
            });
            this.addOccluderBox(
              rowX + xOffset,
              levelY,
              bayZ,
              0.12,
              0.15,
              RACK_BAY_WIDTH - 0.1,
            );
          }

          this.spawn({
            lods: [singleLod(shelfBoardGeometry, this.materials.shelf)],
            position: new Vector3(rowX, levelY - 0.1, bayZ),
            receiveShadow: true,
          });
          this.addOccluderBox(
            rowX,
            levelY - 0.1,
            bayZ,
            RACK_DEPTH - 0.16,
            0.06,
            RACK_BAY_WIDTH - 0.12,
          );

          this.maybeFillBay(rowX, rowLabel, bay, levelY, bayZ);
        }

        if (this.random() < 0.26) {
          // Bulk pallets stored at floor level below the first beam.
          this.spawnPalletStack(
            rowX + (this.random() - 0.5) * 0.55,
            0.02,
            bayZ + (this.random() - 0.5) * 0.55,
            rowLabel,
            bay,
          );
        }
      }
    }

    // Rack row end signs, facing the dock.
    for (let row = 0; row < RACK_ROWS.length; row++) {
      const rowLabel = String.fromCharCode(65 + row);
      const signKey = `row${rowLabel}` as
        "rowA" | "rowB" | "rowC" | "rowD" | "rowE";
      this.spawn({
        lods: [singleLod(this.plane, this.materials.sign(signKey))],
        position: new Vector3(
          RACK_ROWS[row],
          7.2,
          RACK_START_Z + RACK_BAYS * RACK_BAY_WIDTH + 0.12,
        ),
        scale: new Vector3(3.6, 1.8, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
    }
  }

  private maybeFillBay(
    rowX: number,
    rowLabel: string,
    bay: number,
    shelfY: number,
    bayZ: number,
  ): void {
    if (this.random() > 0.68) return;

    const shelfTop = shelfY - 0.07;
    const x = rowX + (this.random() - 0.5) * 0.6;
    const z = bayZ + (this.random() - 0.5) * 0.8;
    const categoryRoll = this.random();

    if (categoryRoll < 0.36) {
      const size = 0.72 + this.random() * 0.26;
      const height = 0.68 + this.random() * 0.22;
      const metal = this.random() < 0.18;
      this.spawn({
        lods: metal ? this.propCatalog.metalCrate : this.propCatalog.crate,
        position: new Vector3(x, shelfTop + height / 2, z),
        rotation: new Euler(0, (this.random() - 0.5) * 0.3, 0),
        scale: new Vector3(size, height, size * (0.86 + this.random() * 0.18)),
        tint: metal ? 0x6e889a : this.pickCrateTint(),
        interactive: {
          label: `${metal ? "Steel case" : "Timber crate"} ${rowLabel}${bay + 1}-L${RACK_LEVELS.indexOf(shelfY) + 1}`,
          detail: metal
            ? "Returnable steel container · 68 kg"
            : "Plywood export crate · 42 kg",
          category: metal ? "Steel case" : "Timber crate",
        },
      });
    } else if (categoryRoll < 0.69) {
      this.spawnPalletStack(x, shelfTop + 0.02, z, rowLabel, bay);
    } else if (categoryRoll < 0.9) {
      const count = this.random() < 0.45 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const tint = this.pickBarrelTint();
        this.spawn({
          lods: this.propCatalog.barrel,
          position: new Vector3(
            x + (i - (count - 1) / 2) * 0.48,
            shelfTop + 0.46,
            z + (this.random() - 0.5) * 0.35,
          ),
          scale: new Vector3(0.76, 0.92, 0.76),
          tint,
          interactive: {
            label: `Chemical drum ${rowLabel}${bay + 1}-L${RACK_LEVELS.indexOf(shelfY) + 1}`,
            detail: "Sealed 200 L drum · hazardous goods class 3",
            category: "Drum",
          },
        });
      }
    }
  }

  private spawnPalletStack(
    x: number,
    y: number,
    z: number,
    rowLabel: string,
    bay: number,
  ): void {
    const palletScale = 0.88 + this.random() * 0.18;
    this.spawn({
      lods: this.propCatalog.pallet,
      position: new Vector3(x, y + 0.08, z),
      rotation: new Euler(0, (this.random() - 0.5) * 0.18, 0),
      scale: new Vector3(palletScale, 1, palletScale),
      tint: this.random() < 0.5 ? 0xffffff : 0xd8c5a4,
      interactive: {
        label: `Pallet ${rowLabel}${bay + 1}`,
        detail: "Heat-treated hardwood · 1.2 × 1.0 m",
        category: "Pallet",
      },
    });

    const stacks = 1 + Math.floor(this.random() * 2);
    let baseY = y + 0.17;
    for (let i = 0; i < stacks; i++) {
      const width = 0.72 + this.random() * 0.18;
      const height = 0.48 + this.random() * 0.18;
      this.spawn({
        lods: this.propCatalog.carton,
        position: new Vector3(
          x + (this.random() - 0.5) * 0.22,
          baseY + height / 2,
          z + (this.random() - 0.5) * 0.22,
        ),
        rotation: new Euler(0, (this.random() - 0.5) * 0.25, 0),
        scale: new Vector3(width, height, width * 0.9),
        tint: this.random() < 0.4 ? 0xc49763 : 0xffffff,
        interactive: {
          label: `Carton ${rowLabel}${bay + 1}-${i + 1}`,
          detail: "Corrugated export carton · 24 units",
          category: "Carton",
        },
      });
      baseY += height + 0.012;
    }
  }

  private buildStagedFreight(): void {
    // Inbound freight in the aisles and near the dock.
    this.spawnPalletStack(5.4, 0.02, 14.2, "S", 1);
    this.spawnPalletStack(-5.2, 0.02, 12.5, "S", 2);
    this.spawnPalletStack(17.6, 0.02, 10.2, "S", 3);
    this.spawnPalletStack(-18.2, 0.02, -5.4, "S", 4);

    const looseCrates = [
      [-18.8, 0.52, 12.4, 1.05, 1.02, 1.0, 0.25],
      [-17.4, 0.42, 13.8, 0.86, 0.82, 0.78, -0.18],
      [-19.6, 0.34, 14.8, 0.66, 0.68, 0.7, 0.48],
      [24.8, 0.5, 16.0, 0.92, 0.98, 0.9, 0.1],
      [22.9, 0.4, 15.4, 0.78, 0.8, 0.74, -0.36],
      [-28.4, 0.55, -15.2, 1.12, 1.08, 1.05, 0.22],
      [-27.2, 0.42, -13.9, 0.84, 0.84, 0.8, 0.52],
    ];

    for (const [x, y, z, sx, sy, sz, rot] of looseCrates) {
      this.spawn({
        lods: this.propCatalog.crate,
        position: new Vector3(x, y, z),
        rotation: new Euler(0, rot, 0),
        scale: new Vector3(sx, sy, sz),
        tint: this.pickCrateTint(),
        interactive: {
          label: `Staged cargo ${Math.abs(Math.round(x))}-${Math.abs(Math.round(z))}`,
          detail: "Awaiting put-away · scanned at dock 01",
          category: "Timber crate",
        },
      });
      this.addOccluderBox(x, y, z, sx, sy, sz, rot);
    }

    // A couple of drums near a spill pallet.
    for (let i = 0; i < 4; i++) {
      this.spawn({
        lods: this.propCatalog.barrel,
        position: new Vector3(
          24.2 + (i % 2) * 0.72,
          0.46,
          18.1 + Math.floor(i / 2) * 0.72,
        ),
        scale: new Vector3(0.78, 0.92, 0.78),
        tint: i % 2 === 0 ? 0x3c6f8c : 0x8a4d36,
        interactive: {
          label: `Drum cluster D-0${i + 1}`,
          detail: "Sealed 200 L drum · quarantine area",
          category: "Drum",
        },
      });
    }

    // Bollards protect the rack row ends.
    for (const rowX of RACK_ROWS) {
      for (const z of [
        RACK_START_Z - 0.7,
        RACK_START_Z + RACK_BAYS * RACK_BAY_WIDTH + 0.7,
      ]) {
        this.spawn({
          lods: [singleLod(this.bollardGeometry, this.materials.hazard)],
          position: new Vector3(rowX + (this.random() - 0.5) * 1.2, 0.5, z),
          tint: 0xffd35a,
          interactive: {
            label: "Safety bollard",
            detail: "Impact protection · rack end",
            category: "Safety",
          },
        });
      }
    }
  }

  private buildForklift(x: number, z: number, rotationY: number): void {
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const world = (localX: number, localY: number, localZ: number): Vector3 =>
      new Vector3(
        x + localX * cos + localZ * sin,
        localY,
        z - localX * sin + localZ * cos,
      );

    const base = 0.48;

    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.forklift)],
      position: world(0, base, 0),
      rotation: new Euler(0, rotationY, 0),
      scale: new Vector3(1.24, 0.62, 2.05),
      tint: 0xf0b52b,
      interactive: {
        label: "Forklift FL-02",
        detail: "2.0 t reach truck · battery 82%",
        category: "Vehicle",
      },
    });
    this.addOccluderBox(x, base, z, 1.24, 0.62, 2.05, rotationY);

    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.rubber)],
      position: world(0, 0.86, 0.38),
      rotation: new Euler(0, rotationY, 0),
      scale: new Vector3(1.02, 0.5, 0.56),
    });

    // Counterweight and mast.
    this.spawn({
      lods: [singleLod(this.unitBox, this.materials.wallTrim)],
      position: world(0, 0.55, 0.82),
      rotation: new Euler(0, rotationY, 0),
      scale: new Vector3(1.18, 0.48, 0.56),
    });

    for (const side of [-0.38, 0.38]) {
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.steel)],
        position: world(side, 1.35, -0.88),
        rotation: new Euler(0, rotationY, 0),
        scale: new Vector3(0.1, 2.45, 0.1),
      });
    }

    // Forks.
    for (const side of [-0.32, 0.32]) {
      this.spawn({
        lods: [singleLod(this.unitBox, this.materials.steel)],
        position: world(side, 0.16, -1.55),
        rotation: new Euler(0, rotationY, 0),
        scale: new Vector3(0.16, 0.08, 1.3),
      });
    }

    // Wheels; the cylinder axis is rotated onto the local X axle.
    for (const side of [-0.64, 0.64]) {
      for (const wheelZ of [-0.64, 0.62]) {
        this.spawn({
          lods: [singleLod(this.wheelGeometry, this.materials.rubber)],
          position: world(side, 0.34, wheelZ),
          rotation: new Euler(0, rotationY, Math.PI / 2),
        });
      }
    }
  }

  private buildLighting(): void {
    const lampPositions = [
      [-18, -8],
      [-6, 8],
      [6, -8],
      [18, 8],
      [-12, 14],
      [12, 14],
    ];

    for (const [x, z] of lampPositions) {
      this.spawn({
        lods: [singleLod(this.wireGeometry, this.materials.wallTrim)],
        position: new Vector3(x, 10.9, z),
        scale: new Vector3(1, 3.1, 1),
        castShadow: false,
        receiveShadow: false,
      });
      this.spawn({
        lods: [singleLod(this.lampHousingGeometry, this.materials.lampHousing)],
        position: new Vector3(x, 9.35, z),
        castShadow: false,
        receiveShadow: false,
      });
      this.spawn({
        lods: [singleLod(this.lampGlowGeometry, this.materials.lampGlow)],
        position: new Vector3(x, 9.22, z),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });

      const light = new PointLight(0xffd7a0, 220, 28, 2);
      light.position.set(x, 9.05, z);
      this.scene.add(light);
      this.pointLights.push(light);
    }

    const dockLight = new PointLight(0xffe2b8, 260, 26, 2);
    dockLight.position.set(0, 5.8, 19.8);
    this.scene.add(dockLight);
    this.pointLights.push(dockLight);
  }

  private buildFloorMarkings(): void {
    // Aisle safety lines.
    for (const rowX of RACK_ROWS) {
      for (const side of [-1, 1]) {
        this.spawn({
          lods: [singleLod(this.plane, this.materials.lineYellow)],
          position: new Vector3(
            rowX + side * (RACK_DEPTH / 2 + 0.55),
            0.012,
            0,
          ),
          rotation: new Euler(-Math.PI / 2, 0, 0),
          scale: new Vector3(0.09, RACK_BAYS * RACK_BAY_WIDTH, 1),
          castShadow: false,
          receiveShadow: false,
          occlusionTest: false,
        });
      }
    }

    // Hazard band at the dock threshold.
    this.spawn({
      lods: [singleLod(this.plane, this.materials.hazard)],
      position: new Vector3(0, 0.013, 19.6),
      rotation: new Euler(-Math.PI / 2, 0, 0),
      scale: new Vector3(9.8, 1.2, 1),
      castShadow: false,
      receiveShadow: false,
      occlusionTest: false,
    });

    // White staging boxes painted on the floor.
    for (const [x, z, w, d] of [
      [5.4, 14.2, 2.2, 2.0],
      [-5.2, 12.5, 2.0, 1.8],
      [17.6, 10.2, 2.0, 1.8],
    ]) {
      this.spawn({
        lods: [singleLod(this.plane, this.materials.lineWhite)],
        position: new Vector3(x, 0.011, z),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(w, 0.07, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
      this.spawn({
        lods: [singleLod(this.plane, this.materials.lineWhite)],
        position: new Vector3(x, 0.011, z - d / 2),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(w, 0.07, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
      this.spawn({
        lods: [singleLod(this.plane, this.materials.lineWhite)],
        position: new Vector3(x, 0.011, z + d / 2),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(w, 0.07, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
      this.spawn({
        lods: [singleLod(this.plane, this.materials.lineWhite)],
        position: new Vector3(x - w / 2, 0.011, z),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(0.07, d, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
      this.spawn({
        lods: [singleLod(this.plane, this.materials.lineWhite)],
        position: new Vector3(x + w / 2, 0.011, z),
        rotation: new Euler(-Math.PI / 2, 0, 0),
        scale: new Vector3(0.07, d, 1),
        castShadow: false,
        receiveShadow: false,
        occlusionTest: false,
      });
    }
  }

  private buildSignage(): void {
    this.spawn({
      lods: [singleLod(this.plane, this.materials.sign("dock"))],
      position: new Vector3(0, 8.65, HALF_DEPTH - 0.18),
      rotation: new Euler(0, Math.PI, 0),
      scale: new Vector3(7.2, 3.6, 1),
      castShadow: false,
      receiveShadow: false,
      occlusionTest: false,
    });

    // Matching sign on the exterior face, readable from the yard.
    this.spawn({
      lods: [singleLod(this.plane, this.materials.sign("dock"))],
      position: new Vector3(0, 8.65, HALF_DEPTH + 0.18),
      scale: new Vector3(7.2, 3.6, 1),
      castShadow: false,
      receiveShadow: false,
      occlusionTest: false,
    });
  }

  private finalizeOccluders(): void {
    if (this.occluderBoxes.length === 0) return;

    const transforms = new Matrix4();
    const rotation = new Euler();
    const position = new Vector3();
    const scale = new Vector3();
    const parts: BufferGeometry[] = [];

    for (const box of this.occluderBoxes) {
      const part = this.unitBox.clone();
      position.set(box.x, box.y, box.z);
      rotation.set(0, box.rotationY ?? 0, 0);
      scale.set(box.sx, box.sy, box.sz);
      _quaternion.setFromEuler(rotation);
      transforms.compose(position, _quaternion, scale);
      part.applyMatrix4(transforms);
      parts.push(part);
    }

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged)
      throw new Error("WarehouseWorld: failed to merge occluder proxies");

    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    merged.name = "HiZ.OccluderProxy";

    const material = new MeshBasicNodeMaterial();
    const mesh = new Mesh(merged, material);
    mesh.name = "HiZ.OccluderProxy";
    this.occluderScene.add(mesh);
  }

  private spawn(options: SpawnOptions): number {
    const entity = this.entities.createEntity();
    const rotation = options.rotation ?? _euler.set(0, 0, 0);
    const scale = options.scale ?? _scale.set(1, 1, 1);

    this.entities.addComponent(
      entity,
      "transform",
      createTransform(options.position, rotation, scale),
    );
    this.entities.addComponent(
      entity,
      "renderable",
      createRenderable(options.lods, {
        tint: options.tint,
        castShadow: options.castShadow,
        receiveShadow: options.receiveShadow,
        occlusionTest: options.occlusionTest,
      }),
    );
    this.entities.addComponent(
      entity,
      "bounds",
      createBounds(options.lods[0].geometry),
    );
    if (options.interactive) {
      this.entities.addComponent(entity, "interactive", options.interactive);
    }

    return entity;
  }

  private addOccluderBox(
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rotationY = 0,
  ): void {
    this.occluderBoxes.push({ x, y, z, sx, sy, sz, rotationY });
  }

  private pickCrateTint(): number {
    const choices = [0xffffff, 0xe8d3b5, 0xcfa37c, 0xb6c4cc, 0xd4b07a];
    return choices[Math.floor(this.random() * choices.length)];
  }

  private pickBarrelTint(): number {
    const choices = [0x3c6f8c, 0x9f4c35, 0xb48b2f, 0x4d6f50, 0x7a7d80];
    return choices[Math.floor(this.random() * choices.length)];
  }

  private createRandom(seed: number): () => number {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private createPalletGeometry(): BufferGeometry {
    const parts: BufferGeometry[] = [];
    const transform = new Matrix4();
    const add = (
      sx: number,
      sy: number,
      sz: number,
      x: number,
      y: number,
      z: number,
    ): void => {
      const part = this.unitBox.clone();
      transform.makeScale(sx, sy, sz);
      transform.setPosition(x, y, z);
      part.applyMatrix4(transform);
      parts.push(part);
    };

    // Bottom deck, blocks and top deck: 22 boxes merged into one LOD mesh.
    for (const z of [-0.43, 0, 0.43]) {
      add(1.2, 0.035, 0.15, 0, -0.068, z);
    }
    for (const x of [-0.5, 0, 0.5]) {
      for (const z of [-0.42, 0, 0.42]) {
        add(0.16, 0.09, 0.16, x, 0, z);
      }
    }
    for (let i = 0; i < 7; i++) {
      add(1.2, 0.035, 0.15, 0, 0.07, -0.45 + i * 0.15);
    }

    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged)
      throw new Error("WarehouseWorld: failed to merge pallet geometry");
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}
