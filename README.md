# Northline Warehouse 07

A dense, fully procedural warehouse digital twin rendered with **Three.js WebGPU**. The scene uses an **entity-component-system** runtime and a built-in culling pipeline combining **frustum culling**, **screen-size LOD**, and **conservative Hi-Z occlusion culling**.

Built with React 19, TypeScript, Three.js `WebGPURenderer`, and Vite. `WebGPURenderer` falls back to WebGL2 automatically when WebGPU is unavailable; the HUD shows the active backend.

## Run

```bash
npm install
npm run dev
```

Other commands:

```bash
npm run lint
npm run build
npm run preview
```

## Controls

- **Drag** to orbit, **scroll** to zoom, **right-drag** to pan.
- **Hover** a carton, tote, pallet, barrel, or rack to inspect it.
- **Click** a prop to select it; the selection ring and card persist until cleared.
- Camera presets: **Overview**, **Aisle**, **Rack Face**, **Dock**.
- Culling toggles in the HUD switch frustum, LOD, and Hi-Z passes individually so their contribution is visible in the telemetry.

The Hi-Z panel shows a live heat-map of the coarse max-depth pyramid, its resolution, readback time, tests, and culled count.

## Architecture

```
GameEngine
├── RenderControl          WebGPU renderer, scene, camera, OrbitControls, lighting, resize
├── EntitiesManager        numeric entity IDs + component records
├── WarehouseWorld         procedural geometry, racks, props, occluders, signage
├── MeshInstanceSystem     instanced batching, frustum/LOD/Hi-Z, per-instance highlight
├── SpatialSystem          XZ uniform hash + 2D DDA ray queries
├── Interaction3DSystem    pointer picking, hover/selection, selection ring
└── HiZSystem              depth prepass, max-depth pyramid, async readback, occlusion test
```

### ECS

`EntitiesManager` stores components in typed record maps keyed by numeric entity IDs:

- `transform` — matrix plus dirty flag
- `renderable` — LOD list, tint, shadow flags, occlusion-test flag
- `bounds` — local/world AABB and sphere
- `interactive` — label, detail, category for the inspector

`WarehouseWorld.build()` spawns every prop through one path, so transforms, bounds, renderables, and spatial registration stay consistent.

### Rendering

`MeshInstanceSystem` groups entities by geometry/material into dynamic `InstancedMesh` batches. Each frame it refreshes dirty world bounds, applies frustum culling, selects an LOD by projected pixel radius, runs the Hi-Z test, and writes survivors into the instance matrix and color streams. Hover and selection are per-instance color tints layered on top of the prop tint.

All materials and textures are generated procedurally at runtime with seeded randomness: concrete, rack steel, timber decking, corrugated walls, cardboard, totes, barrels, hazard markings, signs, and the exterior dock backdrop.

### Hi-Z occlusion culling

The Hi-Z pass is deliberately conservative so it never removes a visible prop:

1. Render merged unit-box **occluder proxies** into a 512×288 linear-depth target.
2. Build a max-depth pyramid down to 8×4 with fullscreen downsample passes.
3. Read back level 2 (**128×72**) asynchronously every second frame; no render-loop stall.
4. The CPU projects each entity AABB into screen space and samples the previous readback over the covered texels with 1-texel padding.
5. Cull only when the entire box lies behind the farthest covering occluder plus a small depth bias.

Because the test requires full screen coverage, partially visible props are kept. Open aisles can legitimately report zero culls; the **Dock** and **Rack Face** views demonstrate the pass with hundreds of culled entities.

## Notes

- No physics or external assets; the entire warehouse is generated from primitives and canvas textures.
- The production bundle is a single chunk above Vite's default size warning because Three.js WebGPU is large. This is expected for the demo.
- React StrictMode double-mounts are handled through explicit engine disposal and cancellation.
