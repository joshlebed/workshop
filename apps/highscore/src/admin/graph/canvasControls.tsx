// Small DOM-only building blocks shared by the three `.web.tsx` canvases:
// a legend row and the floating zoom/action buttons. Plain HTML so they can
// sit inside the absolutely-positioned canvas chrome.

import type { CSSProperties, ReactNode } from "react";
import type { GraphPalette } from "./model";

export function LegendRow({
  items,
  palette,
}: {
  items: { color: string; label: string; shape?: "dot" | "line" | "dashed" }[];
  palette: GraphPalette;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "center" }}>
      {items.map((it) => (
        <span
          key={it.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: palette.muted,
          }}
        >
          {it.shape === "line" || it.shape === "dashed" ? (
            <span
              style={{
                width: 18,
                borderTop: `2px ${it.shape === "dashed" ? "dashed" : "solid"} ${it.color}`,
              }}
            />
          ) : (
            <span style={{ width: 10, height: 10, borderRadius: 5, background: it.color }} />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function CanvasButton({
  onClick,
  children,
  palette,
  title,
  active,
}: {
  onClick: () => void;
  children: ReactNode;
  palette: GraphPalette;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        minWidth: 30,
        height: 30,
        padding: "0 10px",
        borderRadius: 8,
        border: `1px solid ${active ? palette.accent : palette.border}`,
        background: active ? `${palette.accent}22` : palette.surface,
        color: palette.text,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

export const canvasFrame = (palette: GraphPalette, height: number): CSSProperties => ({
  position: "relative",
  height,
  width: "100%",
  borderRadius: 14,
  border: `1px solid ${palette.border}`,
  background: palette.canvas,
  overflow: "hidden",
});

export const overlayTop: CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  right: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 10,
  pointerEvents: "none",
};

export const overlayGroup: CSSProperties = { display: "flex", gap: 6, pointerEvents: "auto" };

export const overlayBottom = (palette: GraphPalette): CSSProperties => ({
  position: "absolute",
  left: 10,
  right: 10,
  bottom: 10,
  padding: "8px 10px",
  borderRadius: 10,
  background: `${palette.surface}E6`,
  border: `1px solid ${palette.border}`,
  display: "flex",
  flexDirection: "column",
  gap: 8,
});
