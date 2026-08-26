#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const ASSET_ROOT = join(REPO_ROOT, "assets", "appstore", "highscore");
const RAW_ROOT = join(ASSET_ROOT, "raw");

const sizes = [
  { name: "6.9-inch", width: 1320, height: 2868 },
  { name: "6.5-inch", width: 1284, height: 2778 },
];

const shots = [
  {
    input: "01-standings.png",
    output: "01-daily-standings.png",
    eyebrow: "DAILY GAMES, TOGETHER",
    headline: ["Your daily games,", "together."],
    subtitle: "Standings, streaks, and reactions in one calm view.",
  },
  {
    input: "02-paste.png",
    output: "02-paste-a-result.png",
    eyebrow: "PASTE. POST. RANKED.",
    headline: ["Paste a result.", "See your place."],
    subtitle: "HighScore reads the score you already share.",
  },
  {
    input: "03-friends.png",
    output: "03-play-with-friends.png",
    eyebrow: "FRIENDS MAKE IT BETTER",
    headline: ["Play is better", "with friends."],
    subtitle: "Invite friends, compare games, and discover their lineup.",
  },
  {
    input: "04-share.png",
    output: "04-share-extension.png",
    eyebrow: "BUILT FOR IOS",
    headline: ["Share straight", "into HighScore."],
    subtitle: "The share extension finds the game and today’s score.",
  },
];

function escapeXml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function svgFor({ width, height, shot, imageData }) {
  const unit = width / 1320;
  const px = (value) => Math.round(value * unit);
  const screenWidth = width - px(256);
  const screenHeight = Math.round((screenWidth * 956) / 440);
  const bezel = px(16);
  const frameWidth = screenWidth + bezel * 2;
  const frameHeight = screenHeight + bezel * 2;
  const frameX = Math.round((width - frameWidth) / 2);
  const frameY = height - frameHeight - px(40);
  const screenX = frameX + bezel;
  const screenY = frameY + bezel;
  const headlineX = px(104);
  const headlineY = px(162);
  const headlineSize = px(78);
  const headlineLineHeight = px(88);
  const subtitleY = headlineY + headlineLineHeight * shot.headline.length + px(16);
  const markX = width - px(180);
  const markY = px(78);
  const markCell = px(15);
  const markGap = px(7);
  const square = (column, row, fill, opacity = 1) =>
    `<rect x="${markX + column * (markCell + markGap)}" y="${markY + row * (markCell + markGap)}" width="${markCell}" height="${markCell}" rx="${px(3)}" fill="${fill}" opacity="${opacity}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <filter id="shadow" x="-20%" y="-10%" width="140%" height="130%">
      <feDropShadow dx="0" dy="${px(18)}" stdDeviation="${px(28)}" flood-color="#080706" flood-opacity="0.72"/>
    </filter>
    <clipPath id="screen-clip">
      <rect x="${screenX}" y="${screenY}" width="${screenWidth}" height="${screenHeight}" rx="${px(56)}"/>
    </clipPath>
  </defs>

  <rect width="${width}" height="${height}" fill="#15120F"/>
  <circle cx="${width - px(70)}" cy="${px(330)}" r="${px(250)}" fill="#F5A524" opacity="0.035"/>
  <circle cx="${px(90)}" cy="${height - px(260)}" r="${px(280)}" fill="#F5A524" opacity="0.025"/>

  <text x="${headlineX}" y="${px(94)}" fill="#F5A524" font-family="DejaVu Sans, sans-serif" font-size="${px(24)}" font-weight="700" letter-spacing="${px(3)}">${escapeXml(shot.eyebrow)}</text>
  ${square(0, 0, "#F5A524")}${square(1, 0, "#F5A524", 0.42)}${square(2, 0, "#F5A524")}
  ${square(0, 1, "#F5A524", 0.42)}${square(1, 1, "#F5A524")}${square(2, 1, "#F5A524", 0.42)}
  ${square(0, 2, "#F5A524")}${square(1, 2, "#F5A524", 0.42)}${square(2, 2, "#F5A524")}

  <text x="${headlineX}" y="${headlineY}" fill="#F2F0ED" font-family="DejaVu Sans, sans-serif" font-size="${headlineSize}" font-weight="700" letter-spacing="${px(-2)}">
    ${shot.headline.map((line, index) => `<tspan x="${headlineX}" dy="${index === 0 ? 0 : headlineLineHeight}">${escapeXml(line)}</tspan>`).join("")}
  </text>
  <text x="${headlineX}" y="${subtitleY}" fill="#A7A29E" font-family="DejaVu Sans, sans-serif" font-size="${px(30)}" font-weight="400">${escapeXml(shot.subtitle)}</text>

  <rect x="${frameX}" y="${frameY}" width="${frameWidth}" height="${frameHeight}" rx="${px(72)}" fill="#24221F" stroke="#3C3835" stroke-width="${px(2)}" filter="url(#shadow)"/>
  <g clip-path="url(#screen-clip)">
    <image x="${screenX}" y="${screenY}" width="${screenWidth}" height="${screenHeight}" preserveAspectRatio="none" xlink:href="data:image/png;base64,${imageData}"/>
  </g>
  <rect x="${screenX}" y="${screenY}" width="${screenWidth}" height="${screenHeight}" rx="${px(56)}" fill="none" stroke="#55504C" stroke-width="${px(2)}"/>
</svg>`;
}

function assertFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    throw new Error("ffmpeg is required to rasterize the composed SVG assets");
  }
}

async function main() {
  assertFfmpeg();
  const tempRoot = mkdtempSync(join(tmpdir(), "highscore-appstore-"));

  try {
    for (const size of sizes) {
      const outputRoot = join(ASSET_ROOT, size.name);
      await mkdir(outputRoot, { recursive: true });

      for (const shot of shots) {
        const inputPath = join(RAW_ROOT, shot.input);
        const imageData = readFileSync(inputPath).toString("base64");
        const svgPath = join(tempRoot, `${size.name}-${basename(shot.output, ".png")}.svg`);
        const outputPath = join(outputRoot, shot.output);

        await writeFile(svgPath, svgFor({ ...size, shot, imageData }), "utf8");
        execFileSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            svgPath,
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            outputPath,
          ],
          { stdio: "inherit" },
        );
        console.log(`${size.name}: ${shot.output}`);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
