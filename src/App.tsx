import { useEffect, useRef, useState } from "react";
import { GameEngine } from "./engine/GameEngine";
import type {
  CullingToggle,
  EntityInfo,
  GameStats,
  HiZPreview as HiZPreviewData,
  ViewPreset,
} from "./engine/types";
import "./App.css";

const number = new Intl.NumberFormat("en-US");

const PRESETS: Array<{ id: ViewPreset; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "aisle", label: "Aisle" },
  { id: "racks", label: "Rack face" },
  { id: "dock", label: "Dock" },
];

function HiZPreview({ data }: { data: HiZPreviewData | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#070b0e";
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!data) return;

    const image = new ImageData(
      new Uint8ClampedArray(data.data),
      data.width,
      data.height,
    );
    context.putImageData(image, 0, 0);
  }, [data]);

  return (
    <canvas
      ref={canvasRef}
      className="hiz-preview"
      width={data?.width ?? 64}
      height={data?.height ?? 36}
      aria-label="Conservative Hi-Z depth preview"
    />
  );
}

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [stats, setStats] = useState<GameStats | null>(null);
  const [hover, setHover] = useState<EntityInfo | null>(null);
  const [selected, setSelected] = useState<EntityInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [culling, setCulling] = useState<Record<CullingToggle, boolean>>({
    frustum: true,
    lod: true,
    occlusion: true,
  });

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    GameEngine.create(container, {
      onStats: (next) => {
        if (!cancelled) setStats(next);
      },
      onHover: (next) => {
        if (!cancelled) setHover(next);
      },
      onSelect: (next) => {
        if (!cancelled) setSelected(next);
      },
      onBackend: () => undefined,
    })
      .then((engine) => {
        if (cancelled) {
          engine.dispose();
          return;
        }
        engineRef.current = engine;
        engine.start();
        setReady(true);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const message =
          reason instanceof Error
            ? reason.message
            : "Unknown initialisation error";
        setError(message);
      });

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const toggleCulling = (key: CullingToggle) => {
    setCulling((current) => {
      const enabled = !current[key];
      engineRef.current?.setCulling(key, enabled);
      return { ...current, [key]: enabled };
    });
  };

  const applyPreset = (preset: ViewPreset) => {
    engineRef.current?.setViewPreset(preset);
  };

  const clearSelection = () => {
    engineRef.current?.clearSelection();
    setSelected(null);
  };

  const backend = stats?.backend ?? "WEBGPU";
  const culled = stats ? stats.frustumCulled + stats.occlusionCulled : 0;
  const visibleRatio = stats
    ? Math.min(
        100,
        (stats.visibleInstances / Math.max(1, stats.entities)) * 100,
      )
    : 0;

  return (
    <main className="warehouse-app">
      <div
        ref={containerRef}
        className="viewport"
        aria-hidden={error !== null}
      />
      <div className="vignette" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">NL</span>
          <span className="brand-copy">
            <strong>NORTHLINE</strong>
            <span>WAREHOUSE 07 · DIGITAL TWIN</span>
          </span>
        </div>

        <nav className="preset-nav" aria-label="Camera presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-button"
              onClick={() => applyPreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </nav>

        <div
          className={`backend-chip ${backend === "WEBGPU" ? "is-gpu" : "is-fallback"}`}
        >
          <span className="backend-dot" />
          {backend === "WEBGPU" ? "WEBGPU" : "WEBGL2 FALLBACK"}
        </div>
      </header>

      <div className="hud">
        <aside className="panel telemetry">
          <div className="panel-heading">
            <span>Render telemetry</span>
            <span className="live">
              <i />
              live
            </span>
          </div>

          <div className="fps-block">
            <strong>{stats ? Math.round(stats.fps) : "—"}</strong>
            <div>
              <span>frames / sec</span>
              <small>
                {stats ? `${stats.frameMs.toFixed(1)} ms` : "waiting"}
              </small>
            </div>
          </div>

          <div className="visible-meter" aria-hidden="true">
            <span style={{ width: `${visibleRatio}%` }} />
          </div>

          <dl className="metric-grid">
            <div>
              <dt>Entities</dt>
              <dd>{stats ? number.format(stats.entities) : "—"}</dd>
            </div>
            <div>
              <dt>Drawn</dt>
              <dd>{stats ? number.format(stats.visibleInstances) : "—"}</dd>
            </div>
            <div>
              <dt>Draw calls</dt>
              <dd>{stats ? number.format(stats.drawCalls) : "—"}</dd>
            </div>
            <div>
              <dt>Triangles</dt>
              <dd>{stats ? number.format(stats.triangles) : "—"}</dd>
            </div>
            <div>
              <dt>Culled</dt>
              <dd className="accent">{stats ? number.format(culled) : "—"}</dd>
            </div>
            <div>
              <dt>Spatial cells</dt>
              <dd>{stats ? number.format(stats.spatialCells) : "—"}</dd>
            </div>
          </dl>

          <div className="lod-strip">
            <span className="lod-title">LOD mix</span>
            <div className="lod-bars">
              <span className="lod hi" style={lodWidth(stats, 0)}>
                hi
              </span>
              <span className="lod mid" style={lodWidth(stats, 1)}>
                mid
              </span>
              <span className="lod lo" style={lodWidth(stats, 2)}>
                low
              </span>
            </div>
          </div>
        </aside>

        <aside className="panel pipeline">
          <div className="panel-heading">
            <span>Culling pipeline</span>
            <span className="micro">
              {stats ? `${stats.backend} · ECS` : "boot"}
            </span>
          </div>

          <button
            type="button"
            className={`cull-row ${culling.frustum ? "is-on" : ""}`}
            onClick={() => toggleCulling("frustum")}
            aria-pressed={culling.frustum}
          >
            <span className="cull-copy">
              <strong>Frustum</strong>
              <small>6-plane sphere test</small>
            </span>
            <span className="cull-value">
              {stats ? number.format(stats.frustumCulled) : "—"}
            </span>
            <span className="switch" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`cull-row ${culling.lod ? "is-on" : ""}`}
            onClick={() => toggleCulling("lod")}
            aria-pressed={culling.lod}
          >
            <span className="cull-copy">
              <strong>LOD</strong>
              <small>projected pixel radius</small>
            </span>
            <span className="cull-value">
              {stats
                ? `${stats.lodCounts[0]}·${stats.lodCounts[1]}·${stats.lodCounts[2]}`
                : "—"}
            </span>
            <span className="switch" aria-hidden="true" />
          </button>

          <button
            type="button"
            className={`cull-row is-important ${culling.occlusion ? "is-on" : ""}`}
            onClick={() => toggleCulling("occlusion")}
            aria-pressed={culling.occlusion}
          >
            <span className="cull-copy">
              <strong>Hi-Z occlusion</strong>
              <small>async conservative max-depth</small>
            </span>
            <span className="cull-value">
              {stats ? number.format(stats.occlusionCulled) : "—"}
            </span>
            <span className="switch" aria-hidden="true" />
          </button>

          <div className="hiz-block">
            <div className="hiz-heading">
              <span>Depth pyramid</span>
              <span
                className={stats?.hiZ.available ? "status-ok" : "status-warm"}
              >
                {stats?.hiZ.available ? "active" : "warming"}
              </span>
            </div>
            <HiZPreview data={stats?.hiZ.preview ?? null} />
            <div className="hiz-meta">
              <span>{stats ? `${stats.hiZ.levels} mips` : "— mips"}</span>
              <span>{stats?.hiZ.readbackSize ?? "—"}</span>
              <span>
                {stats ? `${stats.hiZ.lastReadbackMs.toFixed(1)} ms` : "—"}
              </span>
            </div>
            <div className="hiz-foot">
              <span>
                {stats ? `${stats.hiZ.tested} tests` : "no depth buffer"}
              </span>
              <span>{stats ? `${stats.hiZ.occluded} culled` : "standby"}</span>
            </div>
          </div>
        </aside>

        {selected ? (
          <section className="selection-card">
            <div className="selection-top">
              <span className="selection-category">{selected.category}</span>
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Clear selection"
              >
                ×
              </button>
            </div>
            <h2>{selected.label}</h2>
            <p>{selected.detail}</p>
            <div className="selection-meta">
              <span>Entity #{selected.entity}</span>
              <span>
                {selected.position[0].toFixed(1)},{" "}
                {selected.position[2].toFixed(1)}
              </span>
            </div>
          </section>
        ) : null}

        <div className="footer-bar">
          <span className="hover-readout">
            {hover ? (
              <>
                <b>{hover.label}</b>
                <i>{hover.detail}</i>
              </>
            ) : (
              "Drag to orbit · Scroll to zoom · Click a prop to inspect"
            )}
          </span>
          <span className="footer-systems">
            ECS · MeshInstance → Spatial → Interaction → Hi-Z
          </span>
        </div>
      </div>

      {!ready && !error ? (
        <div className="loading-overlay">
          <div className="loader-card">
            <span className="loader-kicker">
              Northline Engine / Boot sequence
            </span>
            <strong>Waking the warehouse</strong>
            <div className="loader-track">
              <span />
            </div>
            <small>WebGPU adapter · ECS world · Hi-Z depth pyramid</small>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="loading-overlay">
          <div className="loader-card error-card">
            <span className="loader-kicker">Renderer unavailable</span>
            <strong>Could not start the scene</strong>
            <p>{error}</p>
            <small>This demo needs WebGPU or a WebGL2-capable browser.</small>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function lodWidth(
  stats: GameStats | null,
  index: 0 | 1 | 2,
): { flexGrow: number } {
  const total = stats
    ? stats.lodCounts[0] + stats.lodCounts[1] + stats.lodCounts[2]
    : 0;
  const value = stats ? stats.lodCounts[index] : 0;
  return { flexGrow: total > 0 ? Math.max(0.08, value / total) : 1 / 3 };
}

export default App;
