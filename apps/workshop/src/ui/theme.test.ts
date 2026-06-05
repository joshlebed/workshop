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
          "canvas": "#0E0C0B",
          "elevated": "#24221F",
          "surface": "#191715",
        },
        "border": {
          "default": "#3C3835",
          "strong": "#55504C",
          "subtle": "#2D2926",
        },
        "font": {
          "size": {
            "lg": 18,
            "md": 16,
            "sm": 13,
            "xl": 22,
            "xs": 12,
            "xxl": 28,
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
          "muted": "#86817C",
          "onAccent": "#0E0C0B",
          "primary": "#F2F0ED",
          "secondary": "#A7A29E",
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
          "canvas": "#FEFCFA",
          "elevated": "#EFECE9",
          "surface": "#F7F4F2",
        },
        "border": {
          "default": "#D4CEC9",
          "strong": "#AFA8A1",
          "subtle": "#E3DFDA",
        },
        "font": {
          "size": {
            "lg": 18,
            "md": 16,
            "sm": 13,
            "xl": 22,
            "xs": 12,
            "xxl": 28,
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
          "muted": "#726C66",
          "onAccent": "#0E0C0B",
          "primary": "#1F1B17",
          "secondary": "#554F49",
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
