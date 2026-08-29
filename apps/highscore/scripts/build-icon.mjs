import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = join(APP_DIR, "assets", "icon-source.png");
const ICON_BUNDLE_DIR = join(APP_DIR, "assets", "HighScore.icon");
const ICON_BUNDLE_ASSET_PATH = join(ICON_BUNDLE_DIR, "Assets", "icon-source.png");
const BACKGROUND_HEX = "#0E0C0B";
const BACKGROUND_RGB = [14, 12, 11];
const ICON_COMPOSER_ARTWORK_SCALE = 1.6;
const RASTER_ARTWORK_SCALE = 0.8;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("Icon source is not a PNG");

  let width;
  let height;
  let channels;
  const idat = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      const colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error("Icon source must be a non-interlaced 8-bit RGB or RGBA PNG");
      }
      channels = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += length + 12;
  }

  if (!width || !height || !channels || width !== height || idat.length === 0) {
    throw new Error("Icon source must be a complete square PNG");
  }

  const encoded = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = Buffer.alloc(width * height * 4);
  let encodedOffset = 0;
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = encoded[encodedOffset];
    encodedOffset += 1;
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const byte = encoded[encodedOffset + x];
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upLeft);
      else throw new Error(`Unsupported PNG row filter: ${filter}`);
      current[x] = (byte + predictor) & 0xff;
    }
    encodedOffset += stride;

    for (let x = 0; x < width; x += 1) {
      const sourceOffset = x * channels;
      const targetOffset = (y * width + x) * 4;
      rgba[targetOffset] = current[sourceOffset];
      rgba[targetOffset + 1] = current[sourceOffset + 1];
      rgba[targetOffset + 2] = current[sourceOffset + 2];
      rgba[targetOffset + 3] = channels === 4 ? current[sourceOffset + 3] : 255;
    }
    previous = current;
  }

  return { width, height, rgba };
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function resizeRgba(source, size) {
  const output = Buffer.alloc(size * size * 4);
  const sourceScale = source.width / size;
  for (let y = 0; y < size; y += 1) {
    const sourceY = (y + 0.5) * sourceScale - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const yMix = Math.max(0, sourceY - y0);
    for (let x = 0; x < size; x += 1) {
      const sourceX = (x + 0.5) * sourceScale - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const xMix = Math.max(0, sourceX - x0);
      const samples = [
        [x0, y0, (1 - xMix) * (1 - yMix)],
        [x1, y0, xMix * (1 - yMix)],
        [x0, y1, (1 - xMix) * yMix],
        [x1, y1, xMix * yMix],
      ];
      let alpha = 0;
      const premultiplied = [0, 0, 0];
      for (const [sampleX, sampleY, weight] of samples) {
        const offset = (sampleY * source.width + sampleX) * 4;
        const sampleAlpha = source.rgba[offset + 3] / 255;
        alpha += sampleAlpha * weight;
        for (let channel = 0; channel < 3; channel += 1) {
          premultiplied[channel] += source.rgba[offset + channel] * sampleAlpha * weight;
        }
      }
      const outputOffset = (y * size + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        output[outputOffset + channel] =
          alpha === 0 ? 0 : Math.round(premultiplied[channel] / alpha);
      }
      output[outputOffset + 3] = Math.round(alpha * 255);
    }
  }
  return output;
}

function compositeIcon(source, { path, size, alpha, scale = RASTER_ARTWORK_SCALE }) {
  const artworkSize = Math.round(size * scale);
  const artwork = resizeRgba(source, artworkSize);
  const offset = Math.round((size - artworkSize) / 2);
  const channels = alpha ? 4 : 3;
  const output = Buffer.alloc(size * size * channels);
  if (!alpha) {
    for (let index = 0; index < size * size; index += 1) {
      output[index * 3] = BACKGROUND_RGB[0];
      output[index * 3 + 1] = BACKGROUND_RGB[1];
      output[index * 3 + 2] = BACKGROUND_RGB[2];
    }
  }

  for (let y = 0; y < artworkSize; y += 1) {
    for (let x = 0; x < artworkSize; x += 1) {
      const sourceOffset = (y * artworkSize + x) * 4;
      const targetOffset = ((y + offset) * size + x + offset) * channels;
      const sourceAlpha = artwork[sourceOffset + 3] / 255;
      for (let channel = 0; channel < 3; channel += 1) {
        output[targetOffset + channel] = alpha
          ? artwork[sourceOffset + channel]
          : Math.round(
              artwork[sourceOffset + channel] * sourceAlpha +
                BACKGROUND_RGB[channel] * (1 - sourceAlpha),
            );
      }
      if (alpha) output[targetOffset + 3] = artwork[sourceOffset + 3];
    }
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(size, size, output, alpha));
  console.log(`generated ${path.slice(APP_DIR.length + 1)} (${size}x${size})`);
}

function encodePng(width, height, pixels, alpha) {
  const channels = alpha ? 4 : 3;
  const rows = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * channels + 1);
    rows[rowOffset] = 0;
    pixels.copy(rows, rowOffset + 1, y * width * channels, (y + 1) * width * channels);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildIconComposerBundle() {
  mkdirSync(dirname(ICON_BUNDLE_ASSET_PATH), { recursive: true });
  copyFileSync(SOURCE_PATH, ICON_BUNDLE_ASSET_PATH);
  const manifest = {
    fill: "system-dark",
    groups: [
      {
        layers: [
          {
            fill: "none",
            glass: false,
            "image-name": "icon-source.png",
            name: "icon-source",
            position: {
              scale: ICON_COMPOSER_ARTWORK_SCALE,
              "translation-in-points": [0, 0],
            },
          },
        ],
        shadow: { kind: "neutral", opacity: 0.5 },
        translucency: { enabled: true, value: 0.5 },
      },
    ],
    "supported-platforms": { circles: ["watchOS"], squares: "shared" },
  };
  writeFileSync(join(ICON_BUNDLE_DIR, "icon.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `generated assets/HighScore.icon (Icon Composer layer; ${BACKGROUND_HEX} marketing background)`,
  );
}

function copyWebBrandIcon() {
  const path = join(APP_DIR, "public", "icon-source.png");
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(SOURCE_PATH, path);
  console.log("generated public/icon-source.png (OG brand artwork)");
}

const source = decodePng(readFileSync(SOURCE_PATH));
buildIconComposerBundle();
copyWebBrandIcon();
for (const output of [
  { path: join(APP_DIR, "assets", "icon.png"), size: 1024, alpha: false },
  { path: join(APP_DIR, "assets", "adaptive-icon.png"), size: 1024, alpha: true },
  { path: join(APP_DIR, "assets", "splash-icon.png"), size: 512, alpha: true },
  { path: join(APP_DIR, "public", "favicon.png"), size: 64, alpha: false },
]) {
  compositeIcon(source, output);
}
