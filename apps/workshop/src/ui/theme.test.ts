import { describe, expect, it } from "vitest";
import { darkTokens, lightTokens, tokens } from "./theme";

describe("theme tokens", () => {
  it("dark and light expose identical semantic key shapes", () => {
    expect(deepKeys(darkTokens)).toEqual(deepKeys(lightTokens));
  });

  it("dark and light differ on color tokens but share layout tokens", () => {
    expect(darkTokens.bg.canvas).not.toBe(lightTokens.bg.canvas);
    expect(darkTokens.text.primary).not.toBe(lightTokens.text.primary);
    expect(darkTokens.border.subtle).not.toBe(lightTokens.border.subtle);

    expect(darkTokens.accent).toEqual(lightTokens.accent);
    expect(darkTokens.status).toEqual(lightTokens.status);
    expect(darkTokens.list).toEqual(lightTokens.list);
    expect(darkTokens.space).toEqual(lightTokens.space);
    expect(darkTokens.radius).toEqual(lightTokens.radius);
    expect(darkTokens.font).toEqual(lightTokens.font);
  });

  it("legacy `tokens` export still points at the dark palette", () => {
    expect(tokens).toBe(darkTokens);
  });

  it("matches snapshot for dark palette", () => {
    expect(darkTokens).toMatchInlineSnapshot(`
      {
        "accent": {
          "default": "#F5A524",
          "hover": "#E89611",
          "muted": "#F5A52422",
        },
        "bg": {
          "canvas": "#0E0E10",
          "elevated": "#1F1F25",
          "surface": "#16161A",
        },
        "border": {
          "default": "#33333D",
          "strong": "#4A4A56",
          "subtle": "#26262E",
        },
        "font": {
          "size": {
            "lg": 20,
            "md": 16,
            "sm": 14,
            "xl": 28,
            "xs": 12,
            "xxl": 36,
          },
          "weight": {
            "bold": "700",
            "medium": "500",
            "regular": "400",
            "semibold": "600",
          },
        },
        "list": {
          "forest": "#3DD68C",
          "grape": "#A78BFA",
          "ocean": "#4CA7E8",
          "rose": "#F472B6",
          "sand": "#D4B896",
          "slate": "#94A3B8",
          "sunset": "#F5A524",
        },
        "radius": {
          "lg": 14,
          "md": 10,
          "pill": 999,
          "sm": 6,
        },
        "space": {
          "lg": 16,
          "md": 12,
          "sm": 8,
          "xl": 24,
          "xs": 4,
          "xxl": 32,
        },
        "status": {
          "danger": "#F05252",
          "success": "#3DD68C",
          "warning": "#F5A524",
        },
        "text": {
          "muted": "#6E6E78",
          "onAccent": "#0E0E10",
          "primary": "#F2F2F5",
          "secondary": "#A8A8B3",
        },
      }
    `);
  });

  it("matches snapshot for light palette", () => {
    expect(lightTokens).toMatchInlineSnapshot(`
      {
        "accent": {
          "default": "#F5A524",
          "hover": "#E89611",
          "muted": "#F5A52422",
        },
        "bg": {
          "canvas": "#FAFAFB",
          "elevated": "#E6E6EC",
          "surface": "#F2F2F5",
        },
        "border": {
          "default": "#C8C8D0",
          "strong": "#A8A8B3",
          "subtle": "#DCDCE2",
        },
        "font": {
          "size": {
            "lg": 20,
            "md": 16,
            "sm": 14,
            "xl": 28,
            "xs": 12,
            "xxl": 36,
          },
          "weight": {
            "bold": "700",
            "medium": "500",
            "regular": "400",
            "semibold": "600",
          },
        },
        "list": {
          "forest": "#3DD68C",
          "grape": "#A78BFA",
          "ocean": "#4CA7E8",
          "rose": "#F472B6",
          "sand": "#D4B896",
          "slate": "#94A3B8",
          "sunset": "#F5A524",
        },
        "radius": {
          "lg": 14,
          "md": 10,
          "pill": 999,
          "sm": 6,
        },
        "space": {
          "lg": 16,
          "md": 12,
          "sm": 8,
          "xl": 24,
          "xs": 4,
          "xxl": 32,
        },
        "status": {
          "danger": "#F05252",
          "success": "#3DD68C",
          "warning": "#F5A524",
        },
        "text": {
          "muted": "#8E8E98",
          "onAccent": "#0E0E10",
          "primary": "#16161A",
          "secondary": "#5A5A66",
        },
      }
    `);
  });
});

function deepKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return typeof obj;
  if (Array.isArray(obj)) return obj.map(deepKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj as Record<string, unknown>).sort()) {
    out[k] = deepKeys((obj as Record<string, unknown>)[k]);
  }
  return out;
}
