// Rasterizes pixelarticons path data (24×24 grid, axis-aligned `M/H/V/Z`
// commands only, even-odd fill) into filled rectangles, so `PixelIcon` can
// draw them with plain `View`s. Keeping `react-native-svg` out of HighScore
// keeps the iOS runtime version at 1.0.1 (new native module ⇒ new binary).

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PIXEL_GRID = 24;

type Point = readonly [number, number];

/** Parses one `d` string into closed rectilinear polygons (absolute coords). */
export function parseRectilinearPath(d: string): Point[][] {
  const polygons: Point[][] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  let start: Point = [0, 0];
  const close = () => {
    if (current.length >= 3) polygons.push(current);
    current = [];
    [x, y] = start;
  };
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const num = () => Number(tokens[i++]);
    switch (cmd) {
      case "M":
      case "m": {
        if (current.length) close();
        const nx = num();
        const ny = num();
        [x, y] = cmd === "M" ? [nx, ny] : [x + nx, y + ny];
        start = [x, y];
        current = [[x, y]];
        // Subsequent pairs after a moveto are implicit linetos.
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i] ?? "")) {
          const lx = num();
          const ly = num();
          [x, y] = cmd === "M" ? [lx, ly] : [x + lx, y + ly];
          current.push([x, y]);
        }
        break;
      }
      case "H":
      case "h":
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i] ?? "")) {
          const v = num();
          x = cmd === "H" ? v : x + v;
          current.push([x, y]);
        }
        break;
      case "V":
      case "v":
        while (i < tokens.length && !/[A-Za-z]/.test(tokens[i] ?? "")) {
          const v = num();
          y = cmd === "V" ? v : y + v;
          current.push([x, y]);
        }
        break;
      case "Z":
      case "z":
        close();
        break;
      default:
        throw new Error(`unsupported path command in pixel icon: ${cmd}`);
    }
  }
  if (current.length) close();
  return polygons;
}

function insideEvenOdd(polygons: Point[][], px: number, py: number): boolean {
  let inside = false;
  for (const poly of polygons) {
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      const [xj, yj] = poly[j] as Point;
      const [xk, yk] = poly[k] as Point;
      if (yj > py !== yk > py && px < ((xk - xj) * (py - yj)) / (yk - yj) + xj) inside = !inside;
    }
  }
  return inside;
}

/** Fills the 24×24 grid for a set of `d` strings and merges cells into rects. */
export function rasterizePixelIcon(paths: readonly string[]): PixelRect[] {
  const grid: boolean[][] = Array.from({ length: PIXEL_GRID }, () =>
    new Array<boolean>(PIXEL_GRID).fill(false),
  );
  for (const d of paths) {
    const polygons = parseRectilinearPath(d);
    for (let y = 0; y < PIXEL_GRID; y++) {
      const row = grid[y] as boolean[];
      for (let x = 0; x < PIXEL_GRID; x++) {
        if (insideEvenOdd(polygons, x + 0.5, y + 0.5)) row[x] = true;
      }
    }
  }
  // Horizontal runs per row, then merge identical runs on consecutive rows.
  const rects: PixelRect[] = [];
  for (let y = 0; y < PIXEL_GRID; y++) {
    const row = grid[y] as boolean[];
    let x = 0;
    while (x < PIXEL_GRID) {
      if (!row[x]) {
        x++;
        continue;
      }
      const startX = x;
      while (x < PIXEL_GRID && row[x]) x++;
      const w = x - startX;
      const above = rects.find((r) => r.x === startX && r.w === w && r.y + r.h === y);
      if (above) above.h += 1;
      else rects.push({ x: startX, y, w, h: 1 });
    }
  }
  return rects;
}
