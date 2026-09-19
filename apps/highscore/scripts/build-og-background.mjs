// Pre-renders the shared Open Graph card background to
// `public/og-bg.png`. Run with `pnpm --filter highscore-app run og:background`.
//
// Why an offline raster instead of CSS gradients in the Pages function:
// workers-og (Satori + resvg) rasterises `radial-gradient` by interpolating
// in sRGB with two hard stops and no blur, dither, or grain — which is exactly
// the recipe for grey halos and 8-bit banding on a dark card. Doing it here
// lets us (1) blend in OKLab so mid-tones stay clean, (2) use a Gaussian
// falloff so blobs have no visible edge, (3) dither before quantising so a
// 200-level dark ramp doesn't band, and (4) add a whisper of grain. The
// function then just draws this PNG full-bleed under the icon and text.
//
// Zero dependencies on purpose (same as build-icon.mjs): the PNG encoder is
// ~30 lines over node:zlib.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_PATH = join(APP_DIR, "public", "og-bg.png");

const WIDTH = 1200;
const HEIGHT = 630;

// Icon palette (assets/icon-source.png): cabinet purple / magenta, screen
// cyan, Pac-Man yellow. Base is the app's near-black, nudged violet so the
// dark areas read as "night" rather than "off".
const BASE = "#0F0D14";
const BLOBS = [
  // x / y are fractions of the card; sigma is a fraction of the width.
  { color: "#6B3BD6", x: 0.9, y: 0.08, sigma: 0.28, strength: 0.5 }, // purple, top-right
  { color: "#E5307A", x: 0.62, y: 1.1, sigma: 0.26, strength: 0.42 }, // magenta, bottom
  { color: "#12B3CF", x: -0.04, y: 0.2, sigma: 0.22, strength: 0.3 }, // cyan, top-left
  { color: "#F5C81E", x: 0.24, y: 1.12, sigma: 0.16, strength: 0.14 }, // yellow, bottom-left
];
// Keep "mostly dark": cap how far any pixel can climb in OKLab lightness.
const MAX_LIGHTNESS = 0.33;
// Grain: triangular-PDF dither at ±1 LSB kills banding invisibly; the extra
// luminance grain is ~1.5% and reads as texture, not noise, at OG sizes.
const DITHER_LSB = 1.0;
const GRAIN_LSB = 1.6;

// --- colour ---------------------------------------------------------------

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

// Björn Ottosson's OKLab (https://bottosson.github.io/posts/oklab/).
function rgbToOklab([r, g, b]) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

// --- deterministic noise ----------------------------------------------------

// Small xorshift so the output is byte-identical across runs (reviewable diffs).
let seed = 0x9e3779b9;
function rand() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
// Triangular PDF in [-1, 1): the standard dither distribution — no visible
// pattern, and the error is independent of signal level.
function triangular() {
  return rand() - rand();
}

// --- render ----------------------------------------------------------------

function render() {
  const base = rgbToOklab(hexToRgb(BASE));
  const blobs = BLOBS.map((blob) => ({
    lab: rgbToOklab(hexToRgb(blob.color)),
    cx: blob.x * WIDTH,
    cy: blob.y * HEIGHT,
    twoSigmaSq: 2 * (blob.sigma * WIDTH) ** 2,
    strength: blob.strength,
  }));

  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let L = base[0];
      let A = base[1];
      let B = base[2];
      for (const blob of blobs) {
        const dx = x - blob.cx;
        const dy = y - blob.cy;
        const w = blob.strength * Math.exp(-(dx * dx + dy * dy) / blob.twoSigmaSq);
        L += (blob.lab[0] - L) * w;
        A += (blob.lab[1] - A) * w;
        B += (blob.lab[2] - B) * w;
      }
      if (L > MAX_LIGHTNESS) {
        // Soft knee rather than a clamp, so the brightest core still rolls off.
        L = MAX_LIGHTNESS + (L - MAX_LIGHTNESS) * 0.25;
      }
      const [r, g, b] = oklabToRgb([L, A, B]);
      const grain = triangular() * GRAIN_LSB;
      const offset = (y * WIDTH + x) * 3;
      rgb[offset] = quantise(r * 255 + grain);
      rgb[offset + 1] = quantise(g * 255 + grain);
      rgb[offset + 2] = quantise(b * 255 + grain);
    }
  }
  return rgb;
}

function quantise(value) {
  return Math.min(255, Math.max(0, Math.round(value + triangular() * DITHER_LSB)));
}

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(rgb, width, height) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    // Filter type 1 (Sub): predicts each byte from the pixel to its left,
    // which suits smooth horizontal ramps far better than None.
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 3 ? rgb[y * stride + x - 3] : 0;
      raw[y * (stride + 1) + 1 + x] = (rgb[y * stride + x] - left) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const png = encodePng(render(), WIDTH, HEIGHT);
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, png);
console.log(`wrote ${OUTPUT_PATH} (${Math.round(png.length / 1024)} KB)`);
