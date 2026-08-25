import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../www/", import.meta.url);

test("prepared mobile dashboard ships shared tokens and video-first hierarchy", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  const tokens = await readFile(new URL("design-tokens.css", root), "utf8");
  const css = await readFile(new URL("dashboard.css", root), "utf8");

  const tokenLink = html.indexOf('<link rel="stylesheet" href="/design-tokens.css">');
  const dashboardLink = html.indexOf('<link rel="stylesheet" href="/dashboard.css">');
  assert.ok(tokenLink >= 0 && dashboardLink > tokenLink,
    "semantic design tokens must load before dashboard styles");

  for (const marker of [
    "--surface-canvas:", "--surface-card:", "--text-primary:", "--brand-primary:",
    "--status-danger:", "--status-success:", "--focus-ring:", "--touch-target:48px",
  ]) assert.ok(tokens.includes(marker), `design tokens missing ${marker}`);

  const video = html.indexOf('id="createBtn" class="tile tilePrimary"');
  const voice = html.indexOf('id="createVoiceBtn" class="tile"');
  const chat = html.indexOf('id="createChatBtn" class="tile"');
  assert.ok(video >= 0 && video < voice && voice < chat,
    "video must be the first activation choice in the prepared app");

  assert.match(css,
    /\.modeGrid\{display:grid;grid-template-columns:minmax\(0,1\.5fr\) minmax\(210px,\.8fr\);grid-template-rows:repeat\(2,minmax\(86px,1fr\)\);gap:10px\}/,
    "larger screens reserve the dominant launch area for video");
  assert.match(css, /\.tilePrimary\{grid-column:1;grid-row:1\/3;min-height:182px/,
    "video spans both launch rows before the phone breakpoint");
  assert.match(css,
    /@media\(max-width:560px\)\{[\s\S]*?\.modeGrid\{grid-template-columns:1fr 1fr;grid-template-rows:auto auto\}[\s\S]*?\.tilePrimary\{grid-column:1\/-1;grid-row:auto;min-height:132px/,
    "phones keep video first and full-width while voice and chat remain adjacent choices");
});
