// Generates the PWA icon set from code, so the artwork is reproducible and
// reviewable in the repo rather than being an opaque binary someone once made.
// Writes plain RGBA PNGs — no image dependency, just zlib.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// Catppuccin Macchiato, the same tokens the app itself uses.
const MANTLE = [30, 32, 48];
const MAUVE = [198, 160, 246];
const LAVENDER = [183, 189, 248];
const SUBTEXT0 = [165, 173, 203];

const crc32Table = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = crc32Table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  // One filter byte (0 = none) per scanline, as the PNG format requires.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle — negative inside. */
function roundedRectDistance(px, py, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(px - cx) - (halfW - radius);
  const dy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Three stacked bars of decreasing width: entries stacking up through a day.
 * `padding` is the fraction of the canvas kept clear — maskable icons need a
 * generous safe area because the launcher crops to its own shape.
 */
function drawIcon(size, { maskable }) {
  const rgba = Buffer.alloc(size * size * 4);
  const padding = maskable ? 0.22 : 0.12;
  const cornerRadius = maskable ? 0 : size * 0.22;

  const barHeight = size * 0.1;
  const gap = size * 0.075;
  const left = size * padding;
  const widths = [1, 0.74, 0.48].map((w) => (size - left * 2) * w);
  const colors = [MAUVE, LAVENDER, SUBTEXT0];
  const blockHeight = barHeight * 3 + gap * 2;
  const top = (size - blockHeight) / 2;

  // 3x3 supersampling: enough to keep the rounded ends from looking ragged.
  const samples = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          if (
            cornerRadius === 0 ||
            roundedRectDistance(px, py, size / 2, size / 2, size / 2, size / 2, cornerRadius) <= 0
          ) {
            bg++;
          }
          for (let i = 0; i < 3; i++) {
            const cy = top + i * (barHeight + gap) + barHeight / 2;
            const cx = left + widths[i] / 2;
            const d = roundedRectDistance(
              px, py, cx, cy, widths[i] / 2, barHeight / 2, barHeight / 2,
            );
            if (d <= 0) {
              acc[0] += colors[i][0];
              acc[1] += colors[i][1];
              acc[2] += colors[i][2];
              acc[3] += 1;
            }
          }
        }
      }
      const total = samples * samples;
      const bgAlpha = bg / total;
      const barAlpha = acc[3] / total;
      const offset = (y * size + x) * 4;
      // Composite bars over the background, both anti-aliased by coverage.
      const barColor = acc[3] > 0 ? [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3]] : [0, 0, 0];
      const alpha = Math.max(bgAlpha, barAlpha);
      for (let i = 0; i < 3; i++) {
        rgba[offset + i] = Math.round(
          (MANTLE[i] * bgAlpha * (1 - barAlpha) + barColor[i] * barAlpha) / (alpha || 1),
        );
      }
      rgba[offset + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, rgba);
}

const outDir = path.resolve(import.meta.dirname, "../apps/web/public");
mkdirSync(outDir, { recursive: true });

const targets = [
  ["icon-192.png", 192, { maskable: false }],
  ["icon-512.png", 512, { maskable: false }],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }], // iOS applies its own mask
];

for (const [name, size, options] of targets) {
  const png = drawIcon(size, options);
  writeFileSync(path.join(outDir, name), png);
  console.log(`${name}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
}
