#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [, , inputArg, outputArg] = process.argv;

if (!inputArg || !outputArg) {
  console.error(
    "Usage: node scripts/normalize-highscore-native-screenshot.mjs <input.png> <output.png>",
  );
  process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);

mkdirSync(dirname(output), { recursive: true });

execFileSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    input,
    "-vf",
    "scale=1284:2778:force_original_aspect_ratio=increase:flags=lanczos,crop=1284:2778:(iw-ow)/2:(ih-oh)/2,setsar=1,format=rgb24",
    "-frames:v",
    "1",
    output,
  ],
  { stdio: "inherit" },
);

const dimensions = execFileSync(
  "ffprobe",
  [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=s=x:p=0",
    output,
  ],
  { encoding: "utf8" },
).trim();

if (dimensions !== "1284x2778") {
  throw new Error(`unexpected output dimensions: ${dimensions}`);
}

console.log(`${output} (${dimensions})`);
