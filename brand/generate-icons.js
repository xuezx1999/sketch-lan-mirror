// LAN brand icons 生成器（零依赖：node zlib 手写 PNG 编码）
// 用法：node brand/generate-icons.js
// 绘制 docs/BRAND.md 选定 mark（负形窗台）：
//   上段窗体 rect(6,5,20,17,r3) + 下段 sill rect(2,25,28,3.5,r1.75)，viewBox 32。
// 4×4 supersampling 抗锯齿；深底 #111214 + 白 mark（maskable 版 mark 缩至 60% 居中）。
'use strict'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ── 最小 PNG 编码器（RGBA8，filter 0）──────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 几何：圆角矩形覆盖度（单位方格内 4×4 supersample）──────
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  const cx = Math.max(x + r, Math.min(px, x + w - r))
  const cy = Math.max(y + r, Math.min(py, y + h - r))
  if ((px < x + r || px > x + w - r) && (py < y + r || py > y + h - r)) {
    return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= r * r
  }
  return true
}

// mark 描述（viewBox 32）：窗体 + sill
const MARK = [
  { x: 6, y: 5, w: 20, h: 17, r: 3 },   // 窗体
  { x: 2, y: 25, w: 28, h: 3.5, r: 1.75 }, // sill（左右挑出）
]

function renderIcon(size, opts) {
  opts = opts || {}
  const bg = opts.transparent ? [0, 0, 0, 0] : [17, 18, 20, 255] // #111214
  const fg = [255, 255, 255, 255]
  const scale = size / 32
  const markScale = opts.markScale || 1
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 4 // supersample
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) / scale
          const uy = (py + (sy + 0.5) / SS) / scale
          // mark 居中缩放（maskable 用）
          const mx = 16 + (ux - 16) * markScale
          const my = 16 + (uy - 16) * markScale
          for (const s of MARK) {
            if (insideRoundRect(mx, my, s.x, s.y, s.w, s.h, s.r)) {
              hit++
              break
            }
          }
        }
      }
      const a = hit / (SS * SS)
      const o = (py * size + px) * 4
      rgba[o] = Math.round(bg[0] * (1 - a) + fg[0] * a)
      rgba[o + 1] = Math.round(bg[1] * (1 - a) + fg[1] * a)
      rgba[o + 2] = Math.round(bg[2] * (1 - a) + fg[2] * a)
      rgba[o + 3] = opts.transparent ? Math.round(a * 255) : 255
    }
  }
  return encodePng(size, size, rgba)
}

const targets = [
  ['icon-16.png', 16, {}],
  ['icon-32.png', 32, {}],
  ['icon-180.png', 180, {}],
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { markScale: 0.6 }], // 20% 安全区
]
for (const [name, size, opts] of targets) {
  const out = path.join(__dirname, name)
  fs.writeFileSync(out, renderIcon(size, opts))
  console.log('wrote', name, size + 'x' + size)
}
// 服务器静态资源副本
const pub = path.join(__dirname, '..', 'server', 'public', 'icons')
fs.mkdirSync(pub, { recursive: true })
for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(pub, name), renderIcon(size, opts))
  console.log('wrote server/public/icons/' + name)
}
