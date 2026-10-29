import {
  CanvasTexture,
  Color,
  DoubleSide,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";
import type { Texture } from "three";
import type { Renderer } from "three/webgpu";
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from "three/webgpu";

export interface WarehouseMaterials {
  concrete: MeshStandardNodeMaterial;
  wall: MeshStandardNodeMaterial;
  wallTrim: MeshStandardNodeMaterial;
  roof: MeshStandardNodeMaterial;
  steel: MeshStandardNodeMaterial;
  beam: MeshStandardNodeMaterial;
  shelf: MeshStandardNodeMaterial;
  rackBack: MeshStandardNodeMaterial;
  woodCrate: MeshStandardNodeMaterial;
  woodCrateLow: MeshStandardNodeMaterial;
  cardboard: MeshStandardNodeMaterial;
  cardboardLow: MeshStandardNodeMaterial;
  barrel: MeshStandardNodeMaterial;
  barrelLow: MeshStandardNodeMaterial;
  pallet: MeshStandardNodeMaterial;
  palletLow: MeshStandardNodeMaterial;
  rubber: MeshStandardNodeMaterial;
  forklift: MeshStandardNodeMaterial;
  hazard: MeshStandardNodeMaterial;
  lineYellow: MeshStandardNodeMaterial;
  lineWhite: MeshStandardNodeMaterial;
  lampHousing: MeshStandardNodeMaterial;
  lampGlow: MeshBasicNodeMaterial;
  skylight: MeshBasicNodeMaterial;
  doorGlow: MeshBasicNodeMaterial;
  sign(
    name: "dock" | "rowA" | "rowB" | "rowC" | "rowD" | "rowE",
  ): MeshBasicNodeMaterial;
}

/** Small deterministic PRNG so procedural textures stay stable between reloads. */
function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(
  renderer: Renderer,
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D, random: () => number) => void,
  repeatX = 1,
  repeatY = 1,
  seed = 1,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Unable to create a 2D canvas for a warehouse texture");

  draw(context, mulberry32(seed));

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function noise(
  context: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  alpha: number,
  light = false,
): void {
  for (let i = 0; i < count; i++) {
    const shade = light ? 255 : 0;
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${(random() * alpha).toFixed(3)})`;
    const size = 1 + random() * 2;
    context.fillRect(
      random() * context.canvas.width,
      random() * context.canvas.height,
      size,
      size,
    );
  }
}

function buildConcreteTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    512,
    512,
    (context, random) => {
      context.fillStyle = "#6a6a66";
      context.fillRect(0, 0, 512, 512);

      noise(context, random, 9500, 0.12);
      noise(context, random, 5200, 0.08, true);

      for (let i = 0; i < 20; i++) {
        const x = random() * 512;
        const y = random() * 512;
        const radius = 18 + random() * 70;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, "rgba(32, 30, 26, 0.12)");
        gradient.addColorStop(1, "rgba(32, 30, 26, 0)");
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }

      // Expansion joints: a faint grid keeps scale readable in wide shots.
      context.strokeStyle = "rgba(28, 28, 27, 0.34)";
      context.lineWidth = 2;
      for (let i = 0; i <= 512; i += 128) {
        context.beginPath();
        context.moveTo(i, 0);
        context.lineTo(i, 512);
        context.stroke();
        context.beginPath();
        context.moveTo(0, i);
        context.lineTo(512, i);
        context.stroke();
      }

      // Hairline cracks.
      context.strokeStyle = "rgba(24, 24, 22, 0.28)";
      context.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        let x = random() * 512;
        let y = random() * 512;
        context.beginPath();
        context.moveTo(x, y);
        for (let step = 0; step < 8; step++) {
          x += (random() - 0.5) * 22;
          y += (random() - 0.5) * 22;
          context.lineTo(x, y);
        }
        context.stroke();
      }
    },
    12,
    8,
    7,
  );
}

function buildWallTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    512,
    512,
    (context, random) => {
      const gradient = context.createLinearGradient(0, 0, 512, 0);
      gradient.addColorStop(0, "#3c4650");
      gradient.addColorStop(0.5, "#46525e");
      gradient.addColorStop(1, "#343d47");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 512, 512);

      // Corrugation ribs.
      for (let x = 0; x < 512; x += 16) {
        context.fillStyle = "rgba(8, 12, 16, 0.22)";
        context.fillRect(x, 0, 3, 512);
        context.fillStyle = "rgba(210, 225, 235, 0.06)";
        context.fillRect(x + 3, 0, 2, 512);
      }

      // Rust runs and grime near the bottom.
      for (let i = 0; i < 30; i++) {
        const x = random() * 512;
        const y = 300 + random() * 210;
        const length = 20 + random() * 120;
        const rust = context.createLinearGradient(x, y, x, y + length);
        rust.addColorStop(0, "rgba(98, 56, 28, 0.2)");
        rust.addColorStop(1, "rgba(98, 56, 28, 0)");
        context.fillStyle = rust;
        context.fillRect(x, y, 2 + random() * 4, length);
      }

      noise(context, random, 1800, 0.08);
    },
    6,
    2,
    13,
  );
}

function buildRoofTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#20262b";
      context.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 24) {
        context.fillStyle = "rgba(255, 255, 255, 0.035)";
        context.fillRect(x, 0, 2, 256);
        context.fillStyle = "rgba(0, 0, 0, 0.35)";
        context.fillRect(x + 2, 0, 2, 256);
      }
      noise(context, random, 1200, 0.07, true);
    },
    10,
    8,
    21,
  );
}

function buildSteelTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#747c84";
      context.fillRect(0, 0, 256, 256);
      noise(context, random, 2200, 0.2);
      noise(context, random, 900, 0.13, true);
      for (let i = 0; i < 30; i++) {
        context.strokeStyle = `rgba(30, 36, 40, ${0.05 + random() * 0.12})`;
        context.lineWidth = 1;
        context.beginPath();
        const y = random() * 256;
        context.moveTo(0, y);
        context.lineTo(256, y + (random() - 0.5) * 4);
        context.stroke();
      }
    },
    2,
    2,
    31,
  );
}

function buildWoodTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#9a6437";
      context.fillRect(0, 0, 256, 256);

      // Horizontal plank seams.
      for (let y = 0; y < 256; y += 42) {
        context.fillStyle = "rgba(52, 27, 12, 0.5)";
        context.fillRect(0, y, 256, 3);
        context.fillStyle = "rgba(255, 215, 160, 0.06)";
        context.fillRect(0, y + 3, 256, 2);
      }

      // Grain.
      for (let i = 0; i < 420; i++) {
        const y = random() * 256;
        context.strokeStyle = `rgba(62, 31, 13, ${0.03 + random() * 0.1})`;
        context.lineWidth = 0.6 + random() * 1.1;
        context.beginPath();
        context.moveTo(0, y);
        for (let x = 0; x <= 256; x += 16) {
          context.lineTo(
            x,
            y + Math.sin((x + i) * 0.08) * 1.8 + (random() - 0.5) * 1.2,
          );
        }
        context.stroke();
      }

      // Stencilled crate mark.
      context.save();
      context.translate(128, 128);
      context.rotate(-0.035);
      context.strokeStyle = "rgba(30, 22, 16, 0.56)";
      context.lineWidth = 3;
      context.strokeRect(-44, -28, 88, 56);
      context.fillStyle = "rgba(30, 22, 16, 0.62)";
      context.font = 'bold 18px "Arial Narrow", sans-serif';
      context.textAlign = "center";
      context.fillText("N-LINE", 0, -2);
      context.font = '11px "Arial Narrow", sans-serif';
      context.fillText("WAREHOUSE 07", 0, 17);
      context.restore();

      // Metal corner straps.
      context.fillStyle = "rgba(60, 63, 64, 0.6)";
      context.fillRect(0, 0, 10, 256);
      context.fillRect(246, 0, 10, 256);
    },
    1,
    1,
    47,
  );
}

function buildCardboardTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#b6854d";
      context.fillRect(0, 0, 256, 256);
      noise(context, random, 2800, 0.09);

      // Corrugated flute hint.
      for (let x = 0; x < 256; x += 9) {
        context.fillStyle = "rgba(83, 51, 24, 0.06)";
        context.fillRect(x, 0, 2, 256);
      }

      // Tape and shipping label.
      context.fillStyle = "rgba(218, 203, 174, 0.7)";
      context.fillRect(104, 0, 44, 256);
      context.strokeStyle = "rgba(72, 45, 20, 0.5)";
      context.lineWidth = 2;
      context.strokeRect(104, 0, 44, 256);

      context.fillStyle = "rgba(238, 231, 214, 0.9)";
      context.fillRect(24, 164, 110, 62);
      context.fillStyle = "rgba(40, 34, 28, 0.78)";
      context.font = 'bold 14px "Arial Narrow", sans-serif';
      context.fillText("FRAGILE", 34, 185);
      context.font = "11px monospace";
      context.fillText("W07 · 24 UNITS", 34, 204);
      context.strokeStyle = "rgba(40, 34, 28, 0.55)";
      context.strokeRect(24, 164, 110, 62);

      // Barcode.
      for (let i = 0; i < 26; i++) {
        context.fillStyle = "rgba(38, 31, 24, 0.8)";
        context.fillRect(38 + i * 3, 214, i % 3 === 0 ? 2 : 1, 8);
      }
    },
    1,
    1,
    61,
  );
}

function buildBarrelTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#c8ced2";
      context.fillRect(0, 0, 256, 256);
      noise(context, random, 1800, 0.11);

      // Hoops wrap around the cylinder.
      for (const y of [42, 86, 170, 214]) {
        context.fillStyle = "rgba(42, 48, 52, 0.45)";
        context.fillRect(0, y, 256, 10);
        context.fillStyle = "rgba(255, 255, 255, 0.16)";
        context.fillRect(0, y + 2, 256, 2);
      }

      // Weathering and a painted band; instance tint supplies the final color.
      for (let i = 0; i < 20; i++) {
        const x = random() * 256;
        context.fillStyle = `rgba(40, 42, 40, ${0.03 + random() * 0.08})`;
        context.fillRect(x, 0, 1 + random() * 5, 256);
      }
      context.fillStyle = "rgba(246, 205, 92, 0.18)";
      context.fillRect(0, 116, 256, 38);
    },
    1,
    1,
    71,
  );
}

function buildPalletTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context, random) => {
      context.fillStyle = "#8d7a5e";
      context.fillRect(0, 0, 256, 256);
      noise(context, random, 3600, 0.15);
      for (let y = 0; y < 256; y += 36) {
        context.fillStyle = "rgba(45, 35, 25, 0.24)";
        context.fillRect(0, y, 256, 2);
      }
      for (let i = 0; i < 240; i++) {
        context.strokeStyle = `rgba(48, 38, 27, ${0.04 + random() * 0.08})`;
        context.lineWidth = 0.7;
        const y = random() * 256;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(256, y + (random() - 0.5) * 6);
        context.stroke();
      }
    },
    1,
    1,
    83,
  );
}

function buildHazardTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    256,
    256,
    (context) => {
      context.fillStyle = "#e3aa24";
      context.fillRect(0, 0, 256, 256);
      context.fillStyle = "#1d1d1c";
      context.save();
      context.translate(128, 128);
      context.rotate(-Math.PI / 4);
      for (let x = -384; x < 384; x += 96) {
        context.fillRect(x, -384, 46, 768);
      }
      context.restore();
      context.strokeStyle = "rgba(36, 30, 17, 0.5)";
      context.lineWidth = 4;
      context.strokeRect(2, 2, 252, 252);
    },
    3,
    1,
    97,
  );
}

/** Exterior daylight backdrop seen through the dock opening. */
function buildDockViewTexture(renderer: Renderer): Texture {
  return canvasTexture(
    renderer,
    512,
    256,
    (context) => {
      const sky = context.createLinearGradient(0, 0, 0, 256);
      sky.addColorStop(0, "#8fb2cc");
      sky.addColorStop(0.48, "#cfd9d6");
      sky.addColorStop(0.6, "#f0dfb8");
      sky.addColorStop(0.66, "#b9a67d");
      sky.addColorStop(0.74, "#5b5b54");
      sky.addColorStop(1, "#33352f");
      context.fillStyle = sky;
      context.fillRect(0, 0, 512, 256);

      const haze = context.createRadialGradient(392, 96, 6, 392, 96, 130);
      haze.addColorStop(0, "rgba(255, 247, 220, 0.85)");
      haze.addColorStop(1, "rgba(255, 247, 220, 0)");
      context.fillStyle = haze;
      context.fillRect(250, 0, 262, 220);

      // Distant warehouse skyline.
      context.fillStyle = "rgba(89, 104, 110, 0.65)";
      context.fillRect(0, 142, 200, 30);
      context.fillRect(14, 126, 54, 16);
      context.fillRect(120, 132, 42, 10);
      context.fillStyle = "rgba(89, 104, 110, 0.45)";
      context.fillRect(0, 164, 512, 6);

      // Trailer parked at the dock, back-lit by the sky.
      context.fillStyle = "#5c6467";
      context.fillRect(292, 96, 172, 96);
      context.fillStyle = "#464e51";
      context.fillRect(292, 96, 14, 96);
      context.fillStyle = "#394144";
      context.fillRect(456, 84, 36, 108);
      context.fillStyle = "#2b3134";
      context.fillRect(462, 96, 24, 36);
      context.fillStyle = "#1d2225";
      for (const x of [318, 362, 406, 440]) {
        context.beginPath();
        context.arc(x, 196, 11, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = "rgba(255, 255, 255, 0.14)";
      context.fillRect(306, 104, 148, 3);

      // Apron and painted dock guide.
      context.fillStyle = "#6c6a61";
      context.fillRect(0, 198, 512, 58);
      context.fillStyle = "rgba(226, 178, 62, 0.7)";
      context.fillRect(44, 216, 132, 5);
      context.fillRect(44, 229, 92, 3);
      context.strokeStyle = "rgba(30, 33, 31, 0.32)";
      context.lineWidth = 2;
      for (let x = 0; x < 512; x += 64) {
        context.beginPath();
        context.moveTo(x, 198);
        context.lineTo(x + 0, 256);
        context.stroke();
      }
    },
    1,
    1,
    131,
  );
}

function buildSignTexture(
  title: string,
  subtitle: string,
  accent: string,
  code: string,
): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Unable to create a 2D canvas for a warehouse sign");

  context.fillStyle = "#121619";
  context.fillRect(0, 0, 512, 256);
  context.fillStyle = accent;
  context.fillRect(0, 0, 12, 256);
  context.fillRect(0, 0, 512, 10);

  context.fillStyle = "rgba(255, 255, 255, 0.08)";
  for (let x = 26; x < 500; x += 22) context.fillRect(x, 12, 1, 232);

  context.fillStyle = "#f4f0e6";
  context.font = 'bold 74px "Arial Narrow", "Segoe UI", sans-serif';
  context.fillText(title, 36, 116);
  context.fillStyle = accent;
  context.font = 'bold 30px "Arial Narrow", "Segoe UI", sans-serif';
  context.fillText(subtitle, 38, 162);
  context.fillStyle = "rgba(244, 240, 230, 0.58)";
  context.font = "20px monospace";
  context.fillText(code, 38, 210);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function standard(
  parameters: ConstructorParameters<typeof MeshStandardNodeMaterial>[0],
): MeshStandardNodeMaterial {
  return new MeshStandardNodeMaterial(parameters);
}

export function createWarehouseMaterials(
  renderer: Renderer,
): WarehouseMaterials {
  const concreteTexture = buildConcreteTexture(renderer);
  const wallTexture = buildWallTexture(renderer);
  const roofTexture = buildRoofTexture(renderer);
  const steelTexture = buildSteelTexture(renderer);
  const woodTexture = buildWoodTexture(renderer);
  const cardboardTexture = buildCardboardTexture(renderer);
  const barrelTexture = buildBarrelTexture(renderer);
  const palletTexture = buildPalletTexture(renderer);
  const hazardTexture = buildHazardTexture(renderer);
  const dockViewTexture = buildDockViewTexture(renderer);

  const signCache = new Map<string, MeshBasicNodeMaterial>();
  const createSign = (
    key: "dock" | "rowA" | "rowB" | "rowC" | "rowD" | "rowE",
  ): MeshBasicNodeMaterial => {
    const cached = signCache.get(key);
    if (cached) return cached;

    const definitions = {
      dock: ["DOCK 01", "INBOUND / OUTBOUND", "#f0b43c", "NL-W07 · GATE 01"],
      rowA: ["ROW A", "AMBIENT STORAGE", "#6bd3e8", "AISLE 01 · CAP 480"],
      rowB: ["ROW B", "PICK FACE", "#f0b43c", "AISLE 02 · CAP 480"],
      rowC: ["ROW C", "BULK GOODS", "#b4d87a", "AISLE 03 · CAP 480"],
      rowD: ["ROW D", "PICK FACE", "#f0b43c", "AISLE 04 · CAP 480"],
      rowE: ["ROW E", "AMBIENT STORAGE", "#6bd3e8", "AISLE 05 · CAP 480"],
    } as const;

    const [title, subtitle, accent, code] = definitions[key];
    const material = new MeshBasicNodeMaterial({
      map: buildSignTexture(title, subtitle, accent, code),
      toneMapped: false,
      side: DoubleSide,
    });
    signCache.set(key, material);
    return material;
  };

  return {
    concrete: standard({
      map: concreteTexture,
      roughness: 0.92,
      metalness: 0.02,
    }),
    wall: standard({ map: wallTexture, roughness: 0.72, metalness: 0.18 }),
    wallTrim: standard({ color: 0x1c2226, roughness: 0.6, metalness: 0.3 }),
    roof: standard({ map: roofTexture, roughness: 0.88, metalness: 0.12 }),
    steel: standard({ map: steelTexture, roughness: 0.48, metalness: 0.55 }),
    beam: standard({ color: 0xe08a28, roughness: 0.5, metalness: 0.38 }),
    shelf: standard({ map: palletTexture, roughness: 0.82, metalness: 0.02 }),
    rackBack: standard({
      map: steelTexture,
      color: new Color(0.5, 0.54, 0.56),
      roughness: 0.6,
      metalness: 0.45,
    }),
    woodCrate: standard({ map: woodTexture, roughness: 0.76, metalness: 0.02 }),
    woodCrateLow: standard({
      color: 0x9a6437,
      roughness: 0.82,
      metalness: 0.02,
    }),
    cardboard: standard({
      map: cardboardTexture,
      roughness: 0.86,
      metalness: 0,
    }),
    cardboardLow: standard({ color: 0xb6854d, roughness: 0.88, metalness: 0 }),
    barrel: standard({ map: barrelTexture, roughness: 0.42, metalness: 0.38 }),
    barrelLow: standard({ color: 0xb9c2c7, roughness: 0.48, metalness: 0.3 }),
    pallet: standard({ map: palletTexture, roughness: 0.9, metalness: 0 }),
    palletLow: standard({ color: 0x8d7a5e, roughness: 0.92, metalness: 0 }),
    rubber: standard({ color: 0x141516, roughness: 0.92, metalness: 0 }),
    forklift: standard({ color: 0xe7a51f, roughness: 0.52, metalness: 0.28 }),
    hazard: standard({ map: hazardTexture, roughness: 0.78, metalness: 0 }),
    lineYellow: standard({ color: 0xd9a228, roughness: 0.78, metalness: 0 }),
    lineWhite: standard({ color: 0xc9ccc7, roughness: 0.8, metalness: 0 }),
    lampHousing: standard({ color: 0x22282b, roughness: 0.45, metalness: 0.6 }),
    lampGlow: new MeshBasicNodeMaterial({ color: 0xffd9a3, toneMapped: false }),
    skylight: new MeshBasicNodeMaterial({ color: 0xcfe6ff, toneMapped: false }),
    doorGlow: new MeshBasicNodeMaterial({
      map: dockViewTexture,
      color: 0xffffff,
      toneMapped: false,
    }),
    sign: createSign,
  };
}
