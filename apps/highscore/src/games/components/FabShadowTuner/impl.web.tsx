// TEMPORARY: floating slider panel for tuning the home "+" button's shadow in
// the web preview. Raw DOM controls on purpose — throwaway dev UI.

import { useState } from "react";
import { FAB_SHADOW_DEFAULTS, type FabShadow, setFabShadow, useFabShadow } from "./store";

type NumKey = { [K in keyof FabShadow]: FabShadow[K] extends number ? K : never }[keyof FabShadow];

const SLIDERS: { key: NumKey; label: string; min: number; max: number; step: number }[] = [
  { key: "keyOpacity", label: "Key opacity", min: 0, max: 1, step: 0.05 },
  { key: "keyRadius", label: "Key blur", min: 0, max: 40, step: 1 },
  { key: "keyOffsetX", label: "Key offset X", min: -20, max: 20, step: 1 },
  { key: "keyOffsetY", label: "Key offset Y", min: -10, max: 40, step: 1 },
  { key: "ambientOpacity", label: "Contact opacity", min: 0, max: 1, step: 0.05 },
  { key: "ambientRadius", label: "Contact blur", min: 0, max: 20, step: 1 },
  { key: "ambientOffsetY", label: "Contact offset Y", min: 0, max: 12, step: 1 },
  { key: "pixelOffset", label: "Pixel shadow offset", min: 0, max: 15, step: 3 },
  { key: "pixelOpacity", label: "Pixel shadow opacity", min: 0, max: 1, step: 0.05 },
  { key: "casterInset", label: "Caster inset", min: 0, max: 12, step: 1 },
  { key: "pressedScale", label: "Pressed shadow scale", min: 0, max: 1, step: 0.05 },
];

const PRESETS: Record<string, Partial<FabShadow>> = {
  Original: {
    keyOpacity: 0.6,
    keyRadius: 10,
    keyOffsetX: 0,
    keyOffsetY: 6,
    ambientOpacity: 0,
    pixelOffset: 0,
    casterInset: 3,
    pressedScale: 0.5,
  },
  Deeper: FAB_SHADOW_DEFAULTS,
  Floating: {
    keyOpacity: 0.9,
    keyRadius: 24,
    keyOffsetY: 20,
    ambientOpacity: 0.4,
    ambientRadius: 6,
    ambientOffsetY: 4,
    pixelOffset: 0,
  },
  "Pixel hard": {
    keyOpacity: 0.5,
    keyRadius: 10,
    keyOffsetY: 10,
    ambientOpacity: 0,
    pixelOffset: 6,
    pixelOpacity: 0.7,
  },
  "Pink glow": { keyColor: "#DE689F", keyOpacity: 0.7, keyRadius: 22, keyOffsetY: 4 },
};

const box = {
  position: "fixed",
  top: 12,
  left: 12,
  zIndex: 9999,
  width: 260,
  maxHeight: "80vh",
  overflowY: "auto",
  background: "rgba(20,14,30,0.94)",
  color: "#eee",
  font: "12px/1.3 system-ui, sans-serif",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #444",
} as const;

export function FabShadowTuner() {
  const s = useFabShadow();
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  if (!open) {
    return (
      <button type="button" style={{ ...box, width: "auto" }} onClick={() => setOpen(true)}>
        + shadow tuner
      </button>
    );
  }
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>+ button shadow (temp)</strong>
        <button type="button" onClick={() => setOpen(false)}>
          hide
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {Object.entries(PRESETS).map(([name, p]) => (
          <button
            key={name}
            type="button"
            onClick={() => setFabShadow({ ...FAB_SHADOW_DEFAULTS, ...p })}
          >
            {name}
          </button>
        ))}
      </div>
      {SLIDERS.map(({ key, label, min, max, step }) => (
        <label key={key} style={{ display: "block", marginBottom: 6 }}>
          <span style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{label}</span>
            <span>{s[key]}</span>
          </span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={s[key]}
            style={{ width: "100%" }}
            onChange={(e) => setFabShadow({ [key]: Number(e.currentTarget.value) })}
          />
        </label>
      ))}
      <label style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span>Key color</span>
        <input
          type="color"
          value={s.keyColor}
          onChange={(e) => setFabShadow({ keyColor: e.currentTarget.value })}
        />
      </label>
      <button
        type="button"
        style={{ width: "100%" }}
        onClick={() => {
          void navigator.clipboard?.writeText(JSON.stringify(s, null, 2));
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied!" : "Copy values (paste to Claude)"}
      </button>
    </div>
  );
}
