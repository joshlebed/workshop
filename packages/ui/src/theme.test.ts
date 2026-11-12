import { describe, expect, it } from "vitest";
import { alpha, darkTokens, lightTokens, tokens } from "./theme";

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
          "control": "#726E6A",
          "default": "#3C3835",
          "strong": "#55504C",
          "subtle": "#2D2926",
        },
        "font": {
          "lineHeight": {
            "lg": 24,
            "md": 22,
            "sm": 18,
            "xl": 28,
            "xs": 16,
            "xxl": 34,
            "xxxl": 40,
          },
          "size": {
            "lg": 18,
            "md": 16,
            "sm": 13,
            "xl": 22,
            "xs": 12,
            "xxl": 28,
            "xxxl": 34,
          },
          "tracking": {
            "display": -0.6,
            "eyebrow": 0.8,
            "heading": -0.2,
            "title": -0.4,
          },
          "weight": {
            "bold": "700",
            "medium": "500",
            "regular": "400",
            "semibold": "600",
          },
        },
        "hit": 44,
        "list": {
          "forest": "#3DD68C",
          "grape": "#A78BFA",
          "ocean": "#4CA7E8",
          "rose": "#F472B6",
          "sand": "#D4B896",
          "slate": "#94A3B8",
          "sunset": "#F5A524",
        },
        "motion": {
          "base": 220,
          "easeOut": [
            0.16,
            1,
            0.3,
            1,
          ],
          "fast": 150,
          "slow": 320,
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
          "xsm": 6,
          "xxl": 32,
          "xxs": 2,
        },
        "status": {
          "danger": "#F05252",
          "success": "#3DD68C",
          "warning": "#F5A524",
        },
        "text": {
          "muted": "#908B87",
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
          "control": "#847F7B",
          "default": "#D4CEC9",
          "strong": "#AFA8A1",
          "subtle": "#E3DFDA",
        },
        "font": {
          "lineHeight": {
            "lg": 24,
            "md": 22,
            "sm": 18,
            "xl": 28,
            "xs": 16,
            "xxl": 34,
            "xxxl": 40,
          },
          "size": {
            "lg": 18,
            "md": 16,
            "sm": 13,
            "xl": 22,
            "xs": 12,
            "xxl": 28,
            "xxxl": 34,
          },
          "tracking": {
            "display": -0.6,
            "eyebrow": 0.8,
            "heading": -0.2,
            "title": -0.4,
          },
          "weight": {
            "bold": "700",
            "medium": "500",
            "regular": "400",
            "semibold": "600",
          },
        },
        "hit": 44,
        "list": {
          "forest": "#3DD68C",
          "grape": "#A78BFA",
          "ocean": "#4CA7E8",
          "rose": "#F472B6",
          "sand": "#D4B896",
          "slate": "#94A3B8",
          "sunset": "#F5A524",
        },
        "motion": {
          "base": 220,
          "easeOut": [
            0.16,
            1,
            0.3,
            1,
          ],
          "fast": 150,
          "slow": 320,
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
          "xsm": 6,
          "xxl": 32,
          "xxs": 2,
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

describe("alpha()", () => {
  it("appends an 8-bit alpha to a 6-digit hex", () => {
    expect(alpha("#F5A524", 0.2)).toBe("#F5A52433");
    expect(alpha("#f5a524", 0.12)).toBe("#F5A5241F");
    expect(alpha("#F5A524", 0)).toBe("#F5A52400");
    expect(alpha("#F5A524", 1)).toBe("#F5A524FF");
  });

  it("expands 3-digit hex", () => {
    expect(alpha("#abc", 0.5)).toBe("#AABBCC80");
  });

  it("multiplies an existing alpha instead of corrupting it", () => {
    expect(alpha("#F5A52480", 0.5)).toBe("#F5A52440");
  });

  it("clamps the level and passes non-hex colors through", () => {
    expect(alpha("#000000", 2)).toBe("#000000FF");
    expect(alpha("#000000", -1)).toBe("#00000000");
    expect(alpha("rgba(0,0,0,0.5)", 0.2)).toBe("rgba(0,0,0,0.5)");
  });
});
