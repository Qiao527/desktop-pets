#!/usr/bin/env node
// Generates the original "Pip" theme artwork (themes/pip/assets/*.svg) and the
// app/tray icons (assets/icon*.png, assets/tray-*.png, assets/icons/*).
//
// Pip is drawn from plain pixel rectangles + CSS keyframes so the artwork is
// fully reproducible from this file. Released under the repository MIT license.
//
// Usage: node tools/pip-theme/build.js [--icons]
//   --icons also rasterizes icons (requires `rsvg-convert` and `magick` on PATH).

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "themes", "pip", "assets");

const C = {
  body: "#4FB3A2",
  shade: "#3D8F81",
  light: "#86D3C6",
  eye: "#1E2B2A",
  cheek: "#F09A9A",
  sprout: "#67B84F",
  ink: "#2E3440",
  paper: "#FFFFFF",
  gold: "#F5C542",
  red: "#E5625C",
  grey: "#9AA3AD",
};

const r = (x, y, w, h, fill, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra ? " " + extra : ""}/>`;

// 3x3 pixel "z" glyph
const zGlyph = (x, y, fill) => [r(x, y, 3, 1, fill), r(x + 1, y + 1, 1, 1, fill), r(x, y + 2, 3, 1, fill)].join("");

function bodyRects() {
  return [
    r(5, 5, 6, 1, C.body),
    r(4, 6, 8, 1, C.body),
    r(3, 7, 10, 6, C.body),
    r(4, 13, 8, 1, C.shade),
    r(4, 7, 1, 2, C.light),
    r(5, 6, 1, 1, C.light),
    r(4, 10, 1, 1, C.cheek),
    r(11, 10, 1, 1, C.cheek),
    // sprout
    r(7, 3, 1, 2, C.sprout),
    r(8, 3, 1, 1, C.sprout),
    r(9, 2, 1, 1, C.sprout),
  ].join("");
}

const feet = () => `<g id="feet" fill="${C.shade}">${r(4, 14, 2, 1, C.shade)}${r(10, 14, 2, 1, C.shade)}</g>`;
const shadow = (id = "shadow-js") => `<g id="${id}">${r(3, 15, 10, 1, "#000000", 'opacity="0.35"')}</g>`;

const EYES = {
  open: () => r(5, 8, 1, 2, C.eye) + r(10, 8, 1, 2, C.eye),
  closed: () => r(5, 9, 2, 1, C.eye) + r(9, 9, 2, 1, C.eye),
  squint: () => r(5, 9, 1, 1, C.eye) + r(10, 9, 1, 1, C.eye),
  wide: () => r(5, 8, 2, 2, C.eye) + r(9, 8, 2, 2, C.eye),
  up: () => r(6, 7, 1, 2, C.eye) + r(11, 7, 1, 2, C.eye),
  down: () => r(5, 9, 1, 2, C.eye) + r(10, 9, 1, 2, C.eye),
  happy: () => r(5, 8, 1, 1, C.eye) + r(4, 9, 1, 1, C.eye) + r(6, 9, 1, 1, C.eye)
    + r(10, 8, 1, 1, C.eye) + r(9, 9, 1, 1, C.eye) + r(11, 9, 1, 1, C.eye),
  cross: () => [5, 10].map((x) => r(x - 1, 8, 1, 1, C.eye) + r(x + 1, 8, 1, 1, C.eye)
    + r(x, 9, 1, 1, C.eye) + r(x - 1, 10, 1, 1, C.eye) + r(x + 1, 10, 1, 1, C.eye)).join(""),
  squeeze: () => r(4, 8, 2, 1, C.eye) + r(5, 9, 1, 1, C.eye) + r(4, 10, 2, 1, C.eye)
    + r(10, 8, 2, 1, C.eye) + r(10, 9, 1, 1, C.eye) + r(10, 10, 2, 1, C.eye),
};

const BASE_CSS = `
  .breathe { transform-origin: 8px 14px; animation: breathe 3.2s infinite ease-in-out; }
  .blink { transform-origin: 8px 9px; animation: blink 4s infinite ease-in-out; }
  @keyframes breathe { 0%,100% { transform: scale(1,1); } 50% { transform: scale(1.03,0.97); } }
  @keyframes blink { 0%,8%,100% { transform: scaleY(1); } 4% { transform: scaleY(0.1); } }
`;

function svg({ css = "", content }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45" width="500" height="500" shape-rendering="crispEdges">
  <defs><style>${BASE_CSS}${css}</style></defs>
  ${content}
</svg>
`;
}

// Standard pose: shadow, feet, then the body group (optionally wrapped in an animation class).
function pose({ eyes = EYES.open(), eyeClass = "blink", bodyClass = "breathe", over = "", under = "", wrapClass = "" }) {
  const inner = `<g class="${bodyClass}">${bodyRects()}<g class="${eyeClass}">${eyes}</g>${over}</g>`;
  const figure = `${under}${feet()}${inner}`;
  return `${shadow()}${wrapClass ? `<g class="${wrapClass}">${figure}</g>` : figure}`;
}

const files = {};

// Idle: eye tracking requires #eyes-js / #body-js / #shadow-js
files["pip-idle-follow.svg"] = svg({
  css: `#eyes-js, #body-js, #shadow-js { transition: transform 0.2s ease-out; }
  #shadow-js { transform-origin: 8px 15px; }`,
  content: `${shadow()}${feet()}<g id="body-js"><g class="breathe">${bodyRects()}<g id="eyes-js"><g class="blink">${EYES.open()}</g></g></g></g>`,
});

files["pip-idle-look.svg"] = svg({
  css: `.look { animation: look 6.5s infinite steps(1); }
  @keyframes look { 0%,15% { transform: translate(0,0); } 20%,40% { transform: translate(-1px,0); }
    45%,65% { transform: translate(1px,0); } 70%,85% { transform: translate(0,-1px); } 90%,100% { transform: translate(0,0); } }`,
  content: pose({ eyeClass: "look" }),
});

files["pip-thinking.svg"] = svg({
  css: `.dot { animation: dot 1.5s infinite ease-in-out; opacity: 0.2; }
  .d2 { animation-delay: 0.25s; } .d3 { animation-delay: 0.5s; }
  @keyframes dot { 0%,100% { opacity: 0.2; } 40% { opacity: 1; } }`,
  content: pose({ eyes: EYES.up(), eyeClass: "" })
    + `<g fill="${C.ink}">${r(13, 2, 1, 1, C.ink, 'class="dot"')}${r(15, 0, 1, 1, C.ink, 'class="dot d2"')}${r(17, -2, 2, 2, C.ink, 'class="dot d3"')}</g>`,
});

files["pip-working.svg"] = svg({
  css: `.bob { animation: bob 0.5s infinite steps(2); }
  @keyframes bob { 0% { transform: translateY(0); } 50% { transform: translateY(0.4px); } }
  .key { animation: key 0.6s infinite steps(1); }
  .k2 { animation-delay: 0.2s; } .k3 { animation-delay: 0.4s; }
  @keyframes key { 0%,49% { fill: ${C.paper}; } 50%,100% { fill: ${C.grey}; } }`,
  content: pose({ eyes: EYES.down(), eyeClass: "", bodyClass: "bob" })
    + r(1, 13, 14, 2, C.ink)
    + r(3, 13, 2, 1, C.paper, 'class="key"') + r(7, 13, 2, 1, C.paper, 'class="key k2"') + r(11, 13, 2, 1, C.paper, 'class="key k3"'),
});

files["pip-listening.svg"] = svg({
  css: `.sway { transform-origin: 8px 15px; animation: sway 1.6s infinite ease-in-out; }
  @keyframes sway { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
  .note { animation: note 2.4s infinite linear; opacity: 0; }
  .n2 { animation-delay: 1.2s; }
  @keyframes note { 0% { opacity: 0; transform: translate(0,0); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(2px,-6px); } }`,
  content: shadow() + `<g class="sway">${feet()}<g>${bodyRects()}<g class="blink">${EYES.closed()}</g>`
    + r(4, 4, 8, 1, C.ink) + r(3, 5, 1, 2, C.ink) + r(12, 5, 1, 2, C.ink)
    + r(2, 7, 2, 3, C.ink) + r(12, 7, 2, 3, C.ink) + `</g></g>`
    + `<g fill="${C.ink}" class="note">${r(15, 5, 1, 3, C.ink)}${r(14, 7, 1, 1, C.ink)}${r(16, 5, 1, 1, C.ink)}</g>`
    + `<g fill="${C.ink}" class="note n2">${r(-1, 6, 1, 3, C.ink)}${r(-2, 8, 1, 1, C.ink)}${r(0, 6, 1, 1, C.ink)}</g>`,
});

files["pip-yawning.svg"] = svg({
  css: `.mouth { transform-origin: 8px 11.5px; animation: yawn 3s 1 ease-in-out forwards; transform: scale(0.3); }
  @keyframes yawn { 0% { transform: scale(0.3); } 40%,70% { transform: scale(1); } 100% { transform: scale(0.3); } }
  .stretch { transform-origin: 8px 14px; animation: stretch 3s 1 ease-in-out; }
  @keyframes stretch { 0%,100% { transform: scale(1,1); } 50% { transform: scale(0.96,1.06); } }`,
  content: pose({ eyes: EYES.squint(), eyeClass: "", bodyClass: "stretch", over: r(7, 11, 2, 2, C.eye, 'class="mouth"') }),
});

files["pip-dozing.svg"] = svg({
  css: `.nod { transform-origin: 8px 14px; animation: nod 3s infinite ease-in-out; }
  @keyframes nod { 0%,100% { transform: rotate(0); } 50% { transform: rotate(4deg) translateY(0.5px); } }
  .z { animation: zfloat 3s infinite linear; opacity: 0; }
  @keyframes zfloat { 0% { opacity: 0; transform: translate(0,0); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(2px,-4px); } }`,
  content: pose({ eyes: EYES.closed(), eyeClass: "", bodyClass: "nod" }) + `<g class="z">${zGlyph(13, 1, C.ink)}</g>`,
});

files["pip-sleeping.svg"] = svg({
  css: `.flat { transform-origin: 8px 15px; transform: scale(1.1,0.8); }
  .slowbreathe { transform-origin: 8px 15px; animation: sb 4s infinite ease-in-out; }
  @keyframes sb { 0%,100% { transform: scale(1,1); } 50% { transform: scale(1.03,0.96); } }
  .z { animation: zfloat 4s infinite linear; opacity: 0; }
  .z2 { animation-delay: 1.3s; } .z3 { animation-delay: 2.6s; }
  @keyframes zfloat { 0% { opacity: 0; transform: translate(0,0); } 25% { opacity: 1; } 100% { opacity: 0; transform: translate(4px,-8px); } }`,
  content: shadow() + `<g class="flat"><g class="slowbreathe">${feet()}${bodyRects()}${EYES.closed()}</g></g>`
    + `<g class="z">${zGlyph(12, 3, C.ink)}</g><g class="z z2">${zGlyph(12, 3, C.ink)}</g><g class="z z3">${zGlyph(12, 3, C.ink)}</g>`,
});

files["pip-waking.svg"] = svg({
  css: `.pop { transform-origin: 8px 14px; animation: pop 1.5s 1 ease-out; }
  @keyframes pop { 0% { transform: scale(1.1,0.8); } 25% { transform: translateY(-3px) scale(0.95,1.08); } 50% { transform: translateY(0) scale(1.05,0.95); } 100% { transform: none; } }
  .bang { animation: bang 1.5s 1 steps(1) forwards; opacity: 0; }
  @keyframes bang { 0% { opacity: 0; } 20%,80% { opacity: 1; } 100% { opacity: 0; } }`,
  content: pose({ eyes: EYES.wide(), eyeClass: "", bodyClass: "pop" })
    + `<g class="bang">${r(13, -1, 1, 3, C.red)}${r(13, 3, 1, 1, C.red)}</g>`,
});

files["pip-happy.svg"] = svg({
  css: `.hop { transform-origin: 8px 14px; animation: hop 0.8s infinite ease-in-out; }
  @keyframes hop { 0%,100% { transform: translateY(0) scale(1.04,0.96); } 50% { transform: translateY(-2px) scale(0.97,1.03); } }
  .spark { animation: spark 0.8s infinite steps(1); }
  .s2 { animation-delay: 0.4s; }
  @keyframes spark { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }`,
  content: pose({ eyes: EYES.happy(), eyeClass: "", bodyClass: "hop", wrapClass: "" })
    + [[0, 2, ""], [15, 4, " s2"], [14, -1, ""], [-1, 8, " s2"]].map(([x, y, d]) =>
      `<g class="spark${d}">${r(x, y - 1, 1, 3, C.gold)}${r(x - 1, y, 3, 1, C.gold)}</g>`).join(""),
});

files["pip-notification.svg"] = svg({
  css: `.alert { transform-origin: 8px 14px; animation: alert 0.6s infinite ease-in-out; }
  @keyframes alert { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
  .bubble { animation: pulse 1.2s infinite ease-in-out; transform-origin: 15px 0px; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }`,
  content: pose({ eyes: EYES.wide(), eyeClass: "", bodyClass: "alert" })
    + `<g class="bubble">${r(13, -4, 5, 6, C.paper, 'stroke="#2E3440" stroke-width="0.5"')}${r(15, -3, 1, 2, C.red)}${r(15, 0, 1, 1, C.red)}${r(13, 2, 1, 1, C.paper)}</g>`,
});

files["pip-error.svg"] = svg({
  css: `.shake { animation: shake 0.5s infinite steps(2); }
  @keyframes shake { 0% { transform: translateX(-0.5px); } 50% { transform: translateX(0.5px); } }
  .puff { animation: puff 2s infinite ease-out; opacity: 0; }
  .p2 { animation-delay: 1s; }
  @keyframes puff { 0% { opacity: 0.8; transform: translate(0,0); } 100% { opacity: 0; transform: translate(0,-6px) scale(1.5); } }`,
  content: pose({ eyes: EYES.cross(), eyeClass: "", bodyClass: "shake" })
    + `<g class="puff">${r(4, 1, 2, 2, C.grey)}</g><g class="puff p2">${r(10, 0, 2, 2, C.grey)}</g>`,
});

files["pip-react-squish.svg"] = svg({
  css: `.squish { transform-origin: 8px 15px; animation: squish 0.5s 3 ease-in-out; }
  @keyframes squish { 0%,100% { transform: scale(1,1); } 30% { transform: scale(1.18,0.78); } 60% { transform: scale(0.94,1.08); } }`,
  content: pose({ eyes: EYES.squeeze(), eyeClass: "", bodyClass: "squish" }),
});

files["pip-react-annoyed.svg"] = svg({
  css: `.stomp { animation: stomp 0.35s infinite steps(2); }
  @keyframes stomp { 0% { transform: translateY(0); } 50% { transform: translateY(0.6px); } }
  .vein { animation: vein 0.7s infinite steps(1); }
  @keyframes vein { 0%,49% { opacity: 1; } 50%,100% { opacity: 0.3; } }`,
  content: pose({ eyes: EYES.squeeze(), eyeClass: "", bodyClass: "stomp" })
    + `<g class="vein" fill="${C.red}">${r(12, 3, 1, 1, C.red)}${r(14, 3, 1, 1, C.red)}${r(12, 5, 1, 1, C.red)}${r(14, 5, 1, 1, C.red)}${r(13, 4, 1, 1, C.red)}</g>`,
});

files["pip-react-drag.svg"] = svg({
  css: `.dangle { transform-origin: 8px 2px; animation: dangle 1s infinite ease-in-out; }
  @keyframes dangle { 0%,100% { transform: rotate(-6deg); } 50% { transform: rotate(6deg); } }`,
  content: `<g class="dangle">${r(3, 15, 2, 1, C.shade)}${r(11, 15, 2, 1, C.shade)}<g>${bodyRects()}${EYES.wide()}${r(7, 11, 2, 1, C.eye)}</g></g>`,
});

// ── Icons ──
// App icon: Pip centered on a rounded square. Tray: black silhouette template.
const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="1024" height="1024" shape-rendering="crispEdges">
  <rect x="1" y="1" width="18" height="18" rx="4" fill="#F4EFE6"/>
  <g transform="translate(2,1)">${bodyRects()}${feet()}${EYES.open()}</g>
</svg>
`;
const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 1 12 15" width="18" height="22" shape-rendering="crispEdges">
  <g fill="#000000">
    ${r(5, 5, 6, 1, "#000")}${r(4, 6, 8, 1, "#000")}${r(3, 7, 10, 6, "#000")}${r(4, 13, 8, 1, "#000")}
    ${r(4, 14, 2, 1, "#000")}${r(10, 14, 2, 1, "#000")}${r(7, 3, 1, 2, "#000")}${r(8, 3, 1, 1, "#000")}${r(9, 2, 1, 1, "#000")}
  </g>
  <g fill="#FFFFFF">${r(5, 8, 1, 2, "#FFF")}${r(10, 8, 1, 2, "#FFF")}</g>
</svg>
`;

// ── Sounds ──
// Short sine chimes with an exponential decay, written as 16-bit mono WAV.
function chimeWav(notesHz, noteMs = 110, sampleRate = 22050) {
  const perNote = Math.round((noteMs / 1000) * sampleRate);
  const tail = Math.round(0.18 * sampleRate);
  const total = perNote * notesHz.length + tail;
  const data = Buffer.alloc(total * 2);
  for (let n = 0; n < notesHz.length; n++) {
    const start = n * perNote;
    for (let i = 0; start + i < total; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 9) * Math.min(1, i / 60);
      const s = Math.sin(2 * Math.PI * notesHz[n] * t) * 0.6 + Math.sin(4 * Math.PI * notesHz[n] * t) * 0.15;
      const idx = (start + i) * 2;
      const prev = data.readInt16LE(idx);
      data.writeInt16LE(Math.max(-32768, Math.min(32767, prev + Math.round(s * env * 9000))), idx);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function main() {
  const soundsDir = path.join(ROOT, "assets", "sounds");
  fs.writeFileSync(path.join(soundsDir, "pip-complete.wav"), chimeWav([659.25, 783.99, 1046.5]));
  fs.writeFileSync(path.join(soundsDir, "pip-confirm.wav"), chimeWav([880, 659.25]));
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT, name), content);
  }
  console.log(`wrote ${Object.keys(files).length} SVGs to ${path.relative(ROOT, OUT)}`);

  if (!process.argv.includes("--icons")) return;
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "pip-icons-"));
  const appSrc = path.join(tmp, "icon.svg");
  const traySrc = path.join(tmp, "tray.svg");
  fs.writeFileSync(appSrc, appIconSvg);
  // Template images must be black + alpha; cut the eyes out instead of painting them white.
  fs.writeFileSync(traySrc, traySvg.replace(/<g fill="#FFFFFF">[\s\S]*?<\/g>/, ""));
  const assets = path.join(ROOT, "assets");
  const raster = (src, out, w, h) => execFileSync("rsvg-convert", ["-w", String(w), "-h", String(h), "-o", out, src]);
  raster(appSrc, path.join(assets, "icon.png"), 1024, 1024);
  for (const s of [16, 32, 48, 64, 128, 256, 512]) {
    fs.mkdirSync(path.join(assets, "icons"), { recursive: true });
    raster(appSrc, path.join(assets, "icons", `${s}x${s}.png`), s, s);
  }
  execFileSync("magick", [path.join(assets, "icon.png"), "-define", "icon:auto-resize=256,128,64,48,32,16", path.join(assets, "icon.ico")]);
  raster(appSrc, path.join(assets, "tray-icon.png"), 256, 256);
  raster(traySrc, path.join(assets, "tray-menubarTemplate.png"), 18, 22);
  raster(traySrc, path.join(assets, "tray-menubarTemplate@2x.png"), 36, 44);
  raster(traySrc, path.join(assets, "tray-menubar.png"), 36, 44);
  raster(traySrc, path.join(assets, "tray-iconTemplate.png"), 18, 22);
  raster(traySrc, path.join(assets, "tray-iconTemplate@2x.png"), 36, 44);
  console.log("wrote icons to assets/");
}

main();
