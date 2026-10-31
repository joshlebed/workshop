// Design A — "Growth replay": a d3-force physics layout drawn in SVG, with a
// time scrubber that replays accounts and friendships appearing in the order
// they happened. New nodes spawn beside their first friend so growth visibly
// radiates outward from whoever brought them in. Color = join cohort (month)
// or activity recency; size = scores posted; ring = selected / neighbor.

import { userAvatarImageUrl } from "@workshop/api-client/avatar";
import type { AdminGraphNode } from "@workshop/shared";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { type ZoomTransform, zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasButton,
  canvasFrame,
  LegendRow,
  overlayBottom,
  overlayGroup,
  overlayTop,
} from "./canvasControls";
import {
  ACTIVITY_BAND_LABEL,
  type ActivityBand,
  activityBand,
  adjacency,
  cohortLabel,
  cohortOf,
  cohorts,
  displayName,
  formatDay,
  type GraphViewProps,
  radiusFor,
  timeDomain,
} from "./model";

type SimNode = AdminGraphNode & SimulationNodeDatum & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { createdAt: string; key: string };

type ColorMode = "cohort" | "activity";
type ZoomBehavior = ReturnType<typeof zoom<SVGSVGElement, unknown>>;

const BAND_COLORS: Record<ActivityBand, string> = {
  week: "#3DD68C",
  month: "#F5A524",
  dormant: "#94A3B8",
  never: "#55504C",
};

const PLAY_STEPS = 240;

export function ForceGraphView({
  data,
  selectedId,
  onSelect,
  focus,
  height,
  palette,
}: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(800);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [colorMode, setColorMode] = useState<ColorMode>("cohort");
  const [showLabels, setShowLabels] = useState(true);
  const domain = useMemo(() => timeDomain(data), [data]);
  const [t, setT] = useState(domain.end);
  const [playing, setPlaying] = useState(false);
  const [, setTick] = useState(0);
  const now = useMemo(() => new Date(), []);

  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const cohortList = useMemo(() => cohorts(data.nodes), [data.nodes]);
  const cohortColor = (c: string) =>
    palette.series[cohortList.indexOf(c) % palette.series.length] ?? palette.accent;
  const adj = useMemo(() => adjacency(data.edges), [data.edges]);

  // Visible slice for the current scrubber position.
  const { nodes, links } = useMemo(() => {
    const cutoff = new Date(t).toISOString();
    const visible = data.nodes.filter((n) => n.createdAt <= cutoff);
    const ids = new Set(visible.map((n) => n.id));
    const edges = data.edges.filter(
      (e) => e.createdAt <= cutoff && ids.has(e.source) && ids.has(e.target),
    );
    return { nodes: visible, links: edges };
  }, [data, t]);

  // Measure container.
  useEffect(() => {
    const el = svgRef.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Zoom / pan (ignore gestures that start on a node — those drag the node).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 6])
      .filter((event: Event) => {
        const target = event.target as Element | null;
        if (target?.closest("[data-node]")) return false;
        return !(event instanceof MouseEvent && event.button !== 0);
      })
      .on("zoom", (event) => setTransform(event.transform));
    const sel = select(svg);
    sel.call(z);
    (svg as unknown as { __zoom_behavior?: typeof z }).__zoom_behavior = z;
    return () => {
      sel.on(".zoom", null);
    };
  }, []);

  // (Re)build the simulation when the visible slice changes. Positions persist
  // in `simNodes` so existing users don't jump; newcomers spawn beside their
  // first friend (or at the centre when they have none yet).
  useEffect(() => {
    const cx = width / 2;
    const cy = height / 2;
    const firstFriendOf = new Map<string, string>();
    for (const e of [...links].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (!firstFriendOf.has(e.source)) firstFriendOf.set(e.source, e.target);
      if (!firstFriendOf.has(e.target)) firstFriendOf.set(e.target, e.source);
    }
    const arr: SimNode[] = nodes.map((n) => {
      let sim = simNodes.current.get(n.id);
      if (!sim) {
        const anchor = firstFriendOf.get(n.id);
        const near = anchor ? simNodes.current.get(anchor) : undefined;
        const jitter = () => (Math.random() - 0.5) * 60;
        sim = {
          ...n,
          r: radiusFor(n),
          x: (near?.x ?? cx) + jitter(),
          y: (near?.y ?? cy) + jitter(),
        };
        simNodes.current.set(n.id, sim);
      } else {
        Object.assign(sim, n, { r: radiusFor(n) });
      }
      return sim;
    });
    const byId = new Map(arr.map((n) => [n.id, n]));
    const linkArr: SimLink[] = links
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source) as SimNode,
        target: byId.get(e.target) as SimNode,
        createdAt: e.createdAt,
        key: `${e.source}|${e.target}`,
      }));

    let sim = simRef.current;
    if (!sim) {
      sim = forceSimulation<SimNode, SimLink>(arr)
        .force(
          "link",
          forceLink<SimNode, SimLink>(linkArr)
            .id((d) => d.id)
            .distance((l) => 36 + (l.source as SimNode).r + (l.target as SimNode).r)
            .strength(0.6),
        )
        .force("charge", forceManyBody<SimNode>().strength(-180).distanceMax(420))
        .force("collide", forceCollide<SimNode>((d) => d.r + 10).iterations(2))
        .force("center", forceCenter(cx, cy).strength(0.05))
        .velocityDecay(0.35)
        .on("tick", () => setTick((v) => v + 1));
      simRef.current = sim;
    } else {
      sim.nodes(arr);
      (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>>).links(linkArr);
      (sim.force("center") as ReturnType<typeof forceCenter<SimNode>>).x(cx).y(cy);
      sim.alpha(0.5).restart();
    }
  }, [nodes, links, width, height]);

  useEffect(
    () => () => {
      simRef.current?.stop();
      simRef.current = null;
    },
    [],
  );

  // Replay.
  useEffect(() => {
    if (!playing) return;
    const step = (domain.end - domain.start) / PLAY_STEPS || 1;
    const id = window.setInterval(() => {
      setT((prev) => {
        const next = prev + step;
        if (next >= domain.end) {
          setPlaying(false);
          return domain.end;
        }
        return next;
      });
    }, 40);
    return () => window.clearInterval(id);
  }, [playing, domain]);

  // Node dragging via pointer events, in simulation coordinates.
  const drag = useRef<{ id: string; pointerId: number } | null>(null);
  const toSim = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    return { x: (x - transform.x) / transform.k, y: (y - transform.y) / transform.k };
  };
  const onNodeDown = (id: string) => (e: React.PointerEvent<SVGGElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, pointerId: e.pointerId };
    const n = simNodes.current.get(id);
    if (n) {
      n.fx = n.x;
      n.fy = n.y;
    }
    simRef.current?.alphaTarget(0.3).restart();
  };
  const onNodeMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    const n = simNodes.current.get(drag.current.id);
    if (!n) return;
    const p = toSim(e.clientX, e.clientY);
    n.fx = p.x;
    n.fy = p.y;
  };
  const onNodeUp = (id: string) => (e: React.PointerEvent<SVGGElement>) => {
    const was = drag.current;
    drag.current = null;
    simRef.current?.alphaTarget(0);
    const n = simNodes.current.get(id);
    if (n) {
      const moved =
        was && n.fx !== undefined && n.x !== undefined ? Math.abs((n.fx ?? 0) - n.x) > 2 : false;
      n.fx = undefined;
      n.fy = undefined;
      if (!moved) onSelect(selectedId === id ? null : id);
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const selectedNeighbors = selectedId ? adj.get(selectedId) : undefined;
  const dim = (id: string) =>
    selectedId !== null && id !== selectedId && !selectedNeighbors?.has(id);

  const fillFor = (n: AdminGraphNode) =>
    colorMode === "cohort" ? cohortColor(cohortOf(n)) : BAND_COLORS[activityBand(n, now)];

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const z = (
      svg as unknown as { __zoom_behavior?: ReturnType<typeof zoom<SVGSVGElement, unknown>> } | null
    )?.__zoom_behavior;
    if (svg && z) z.scaleBy(select(svg), factor);
  };
  const resetZoom = () => {
    const svg = svgRef.current;
    const z = (
      svg as unknown as { __zoom_behavior?: ReturnType<typeof zoom<SVGSVGElement, unknown>> } | null
    )?.__zoom_behavior;
    if (svg && z) z.transform(select(svg), zoomIdentity);
  };

  // Locate: pan/zoom so the requested user sits in the middle of the canvas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only re-run on a new locate request
  useEffect(() => {
    if (!focus) return;
    const svg = svgRef.current;
    const z = (svg as unknown as { __zoom_behavior?: ZoomBehavior } | null)?.__zoom_behavior;
    const n = simNodes.current.get(focus.id);
    if (!svg || !z || !n || n.x === undefined || n.y === undefined) return;
    const k = Math.max(1.6, transform.k);
    z.transform(
      select(svg),
      zoomIdentity.translate(width / 2 - n.x * k, height / 2 - n.y * k).scale(k),
    );
  }, [focus?.nonce]);

  const simArr = simRef.current?.nodes() ?? [];
  const simLinks =
    (
      simRef.current?.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined
    )?.links() ?? [];

  const legend =
    colorMode === "cohort"
      ? cohortList.map((c) => ({ color: cohortColor(c), label: cohortLabel(c) }))
      : (Object.keys(BAND_COLORS) as ActivityBand[]).map((b) => ({
          color: BAND_COLORS[b],
          label: ACTIVITY_BAND_LABEL[b],
        }));

  return (
    <div style={canvasFrame(palette, height)} data-testid="admin-graph-force">
      <svg
        ref={svgRef}
        width="100%"
        height={height}
        style={{ display: "block", cursor: "grab", touchAction: "none" }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onSelect(null);
        }}
        role="img"
        aria-label="Force-directed friend graph"
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {simLinks.map((l) => {
            const s = l.source as SimNode;
            const tg = l.target as SimNode;
            const faded = dim(s.id) && dim(tg.id);
            const lit = selectedId !== null && (s.id === selectedId || tg.id === selectedId);
            return (
              <line
                key={l.key}
                x1={s.x}
                y1={s.y}
                x2={tg.x}
                y2={tg.y}
                stroke={lit ? palette.accent : palette.border}
                strokeOpacity={faded ? 0.15 : lit ? 0.95 : 0.7}
                strokeWidth={lit ? 2 : 1.2}
              />
            );
          })}
          {simArr.map((n) => {
            const faded = dim(n.id);
            const isSel = n.id === selectedId;
            const img = userAvatarImageUrl(n.id, n.avatarVersion);
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG node, not a DOM button
              <g
                key={n.id}
                data-node={n.id}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                style={{
                  cursor: "pointer",
                  opacity: faded ? 0.25 : 1,
                  transition: "opacity 120ms",
                }}
                onPointerDown={onNodeDown(n.id)}
                onPointerMove={onNodeMove}
                onPointerUp={onNodeUp(n.id)}
                role="button"
                tabIndex={0}
                aria-label={displayName(n)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(n.id);
                }}
              >
                {img ? (
                  <>
                    <clipPath id={`clip-${n.id}`}>
                      <circle r={n.r} />
                    </clipPath>
                    <circle r={n.r + 2.5} fill={fillFor(n)} />
                    <image
                      href={img}
                      x={-n.r}
                      y={-n.r}
                      width={n.r * 2}
                      height={n.r * 2}
                      clipPath={`url(#clip-${n.id})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </>
                ) : (
                  <circle r={n.r} fill={fillFor(n)} stroke={palette.canvas} strokeWidth={1.5} />
                )}
                {isSel ? (
                  <circle r={n.r + 6} fill="none" stroke={palette.accent} strokeWidth={3} />
                ) : null}
                {n.isAdmin ? (
                  <text y={-n.r - 4} textAnchor="middle" fontSize={10} fill={palette.accent}>
                    ★
                  </text>
                ) : null}
                {showLabels || isSel ? (
                  <text
                    y={n.r + 12}
                    textAnchor="middle"
                    fontSize={11}
                    fill={palette.text}
                    stroke={palette.canvas}
                    strokeWidth={3}
                    paintOrder="stroke"
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {displayName(n)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div style={overlayTop}>
        <div style={overlayGroup}>
          <CanvasButton
            palette={palette}
            title="Color by join cohort"
            active={colorMode === "cohort"}
            onClick={() => setColorMode("cohort")}
          >
            Cohort
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Color by activity recency"
            active={colorMode === "activity"}
            onClick={() => setColorMode("activity")}
          >
            Activity
          </CanvasButton>
          <CanvasButton
            palette={palette}
            title="Toggle labels"
            active={showLabels}
            onClick={() => setShowLabels((v) => !v)}
          >
            Labels
          </CanvasButton>
        </div>
        <div style={overlayGroup}>
          <CanvasButton palette={palette} title="Zoom in" onClick={() => zoomBy(1.4)}>
            +
          </CanvasButton>
          <CanvasButton palette={palette} title="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
            −
          </CanvasButton>
          <CanvasButton palette={palette} title="Reset view" onClick={resetZoom}>
            ⟲
          </CanvasButton>
        </div>
      </div>

      <div style={overlayBottom(palette)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <CanvasButton
            palette={palette}
            title={playing ? "Pause replay" : "Replay growth from the first sign-up"}
            onClick={() => {
              if (playing) setPlaying(false);
              else {
                if (t >= domain.end) setT(domain.start);
                setPlaying(true);
              }
            }}
          >
            {playing ? "❚❚" : "▶"}
          </CanvasButton>
          <input
            type="range"
            min={domain.start}
            max={domain.end}
            step={Math.max(1, Math.floor((domain.end - domain.start) / 1000))}
            value={t}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            style={{ flex: 1, accentColor: palette.accent }}
            aria-label="Timeline"
            data-testid="admin-graph-force-scrubber"
          />
          <span style={{ fontSize: 12, color: palette.text, minWidth: 190, textAlign: "right" }}>
            {formatDay(t)} · {nodes.length} users · {links.length} friendships
          </span>
        </div>
        <LegendRow items={legend} palette={palette} />
      </div>
    </div>
  );
}
