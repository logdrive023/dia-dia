// Gera os ícones PNG do PWA sem dependências (mesmo desenho do icon.svg).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function rr(x, y, rx, ry, w, h, r) { // dentro de retângulo arredondado?
  if (x < rx || y < ry || x >= rx + w || y >= ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r), cy = Math.min(Math.max(y, ry + r), ry + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function icon(size) {
  const s = size / 512;
  const shapes = [
    [0, 0, 512, 512, 112, '#2563eb'], [128, 120, 256, 300, 36, '#ffffff'],
    [168, 180, 40, 40, 10, '#22c55e'], [228, 190, 116, 20, 10, '#93c5fd'],
    [168, 250, 40, 40, 10, '#f97316'], [228, 260, 116, 20, 10, '#93c5fd'],
    [168, 320, 40, 40, 10, '#ef4444'], [228, 330, 116, 20, 10, '#93c5fd'],
  ];
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let px = [0, 0, 0, 0];
      for (const [rx, ry, w, h, r, c] of shapes) if (rr((x + 0.5) / s, (y + 0.5) / s, rx, ry, w, h, r)) px = [...hex(c), 255];
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [192, 512]) writeFileSync(`public/icon-${n}.png`, icon(n));
console.log('ícones gerados');
