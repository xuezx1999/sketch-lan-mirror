/**
 * Sketch LAN Mirror — LAN server（HTTP + WebSocket）
 * 架构依据 docs/ARCHITECTURE.md §4/§6；M4-C 增加产品化入口（ADR-019/020）：
 *   GET  /        手机端页面（public/index.html，M3-C Viewer，不做改动）
 *   GET  /health  健康检查（+port；插件复用/就绪探测）
 *   GET  /info    端口 + LAN URL 列表 + primary（插件获取访问入口）
 *   GET  /qr      扫码入口页（QR + URL 列表；Mac 浏览器打开供手机扫描）
 *   GET  /current 最新 PNG（无则 404）
 *   POST /frame   插件推帧（PNG body + x-artboard-name/x-width/x-height/x-ts）
 *   GET  /manifest.webmanifest, /icons/*   PWA 静态资源（白名单路由）
 *   WS            连接即补发当前帧；新帧二进制广播（前置一条 JSON 元信息文本帧）
 *
 * 生命周期（ADR-019）：启动成功后写 ~/.sketch-lan-mirror/runtime.json（pid+port），
 * SIGTERM/SIGINT 时清理 runtime 文件并优雅退出——插件只按 PID 精确停止本进程。
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { WebSocketServer } = require('ws')
const qrcode = require('qrcode-generator')

const DEFAULT_PORT = 9777
const MAX_PORT_ATTEMPTS = 20
const HOST = '0.0.0.0'
const SERVICE = 'sketch-lan-mirror'
const RUNTIME_DIR = path.join(os.homedir(), '.sketch-lan-mirror')
const RUNTIME_FILE = path.join(RUNTIME_DIR, 'runtime.json')

// ── 内存态：最新一帧（不落盘）───────────────────────────────
let currentFrame = null // { png: Buffer, meta: { name, width, height, ts } }

// x-artboard-name 含非 ASCII（如中文）时由插件做百分号编码，此处解码；
// 纯 ASCII 名称 decodeURIComponent 原样返回，完全向后兼容
function decodeHeaderName(value) {
  if (!value) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

// ── 静态页面 ──────────────────────────────────────────────
const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'))
const MANIFEST_JSON = fs.readFileSync(path.join(__dirname, 'public', 'manifest.webmanifest'))
const FAVICON_SVG = fs.readFileSync(path.join(__dirname, 'public', 'favicon.svg'))

// ── 局域网 IP：os.networkInterfaces()，不硬编码网卡名（M1 已验证）────
// M4-C（ADR-019）：按网段可信度排序——192.168（家庭/办公 Wi-Fi）>
// 172.16-31（Docker 常见但也是企业内网）> 10.x（也可能是 VPN/Tailscale）。
// 全部返回（多网卡如实展示），primary 取排序第一；手机若连的别的网段，
// 用户可从 /qr 页的 URL 列表选对应地址。
function getLanAddresses() {
  const seen = new Set()
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const net of addresses || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      // 只保留私有网段，过滤 loopback 与公网/虚拟异常地址
      if (!/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(net.address)) continue
      seen.add(net.address)
    }
  }
  const rank = (ip) =>
    ip.startsWith('192.168.') ? 0 : ip.startsWith('172.') ? 1 : 2
  return [...seen].sort((a, b) => rank(a) - rank(b))
}

function lanInfo(port) {
  const lanIPs = getLanAddresses()
  const urls = lanIPs.map((ip) => `http://${ip}:${port}`)
  const primary = urls[0] || `http://localhost:${port}`
  return { urls, primary, lanIPs }
}

// ── HTTP 路由 ─────────────────────────────────────────────
function onRequest(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost')

  // 最小请求日志（探针阶段临时加，便于确认请求是否真的到达 Node）
  console.log(
    `[request] ${req.method} ${pathname} | content-length: ${req.headers['content-length'] ?? '-'} | content-type: ${req.headers['content-type'] ?? '-'}`
  )

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(INDEX_HTML)
    return
  }

  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: SERVICE, port: httpPort }))
    return
  }

  // M4-C（ADR-019）：插件 / 终端获取访问入口（端口 + LAN URL 列表 + primary）
  if (req.method === 'GET' && pathname === '/info') {
    const { urls, primary } = lanInfo(httpPort)
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, service: SERVICE, port: httpPort, urls, primary }))
    return
  }

  // M4-C（ADR-019）：扫码入口页——Mac 浏览器打开，手机扫码直连 Viewer。
  // 独立页面，不改动 M3-C Viewer（/）本身。
  if (req.method === 'GET' && pathname === '/qr') {
    const { urls, primary } = lanInfo(httpPort)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(buildQrPage(primary, urls))
    return
  }

  // PWA 静态资源（白名单路由；public/ 其余文件不暴露）
  if (req.method === 'GET' && pathname === '/manifest.webmanifest') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8' })
    res.end(MANIFEST_JSON)
    return
  }
  if (req.method === 'GET' && pathname === '/favicon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' })
    res.end(FAVICON_SVG)
    return
  }
  if (req.method === 'GET' && pathname.startsWith('/icons/')) {
    const name = pathname.slice('/icons/'.length)
    if (!/^[\w.-]+\.png$/.test(name)) {
      res.writeHead(404).end()
      return
    }
    const file = path.join(__dirname, 'public', 'icons', name)
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' })
      res.end(data)
    })
    return
  }

  if (req.method === 'GET' && pathname === '/current') {
    if (!currentFrame) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'no frame yet' }))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': currentFrame.png.length,
      'Cache-Control': 'no-store',
    })
    res.end(currentFrame.png)
    return
  }

  if (req.method === 'POST' && pathname === '/frame') {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 64 * 1024 * 1024) {
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const png = Buffer.concat(chunks)
      console.log(`[frame] received ${png.length} bytes`)
      // 最小校验：PNG 魔数
      if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'body is not a PNG' }))
        return
      }
      currentFrame = {
        png,
        meta: {
          type: 'meta',
          name: decodeHeaderName(req.headers['x-artboard-name']) || 'Untitled',
          width: Number(req.headers['x-width']) || null,
          height: Number(req.headers['x-height']) || null,
          ts: Number(req.headers['x-ts']) || Date.now(),
          bytes: png.length,
        },
      }
      broadcastFrame(currentFrame)
      console.log(
        `[frame] "${currentFrame.meta.name}" ${png.length} bytes -> ${wss.clients.size} client(s)`
      )
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: true, clients: wss.clients.size }))
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: 'not found' }))
}

// ── WebSocket ─────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true })

function sendCurrent(socket) {
  if (!currentFrame) return
  socket.send(JSON.stringify(currentFrame.meta))
  socket.send(currentFrame.png, { binary: true })
}

function broadcastFrame(frame) {
  const meta = JSON.stringify(frame.meta)
  for (const client of wss.clients) {
    if (client.readyState !== 1 /* OPEN */) continue
    client.send(meta)
    client.send(frame.png, { binary: true })
  }
}

// ── 启动（端口占用自动递增）────────────────────────────────
let httpServer = null
let httpPort = null

function listen(port, attemptsLeft) {
  const server = http.createServer(onRequest)
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname === '/') wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    else socket.destroy()
  })
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`[port] ${port} occupied, trying ${port + 1} ...`)
      listen(port + 1, attemptsLeft - 1)
    } else {
      console.error(`[fatal] ${err.message}`)
      process.exitCode = 1
      removeRuntimeFile()
    }
  })
  server.listen(port, HOST, () => {
    httpServer = server
    httpPort = server.address().port
    writeRuntimeFile(httpPort)
    printBanner(httpPort)
  })
}

// ── 生命周期：runtime 文件 + 优雅退出（ADR-019）──────────────
// 插件通过 runtime.json 找到本进程的 PID 与端口；只按 PID 精确停止本进程，
// 绝不 killall node。
function writeRuntimeFile(port) {
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true })
    fs.writeFileSync(
      RUNTIME_FILE,
      JSON.stringify({ service: SERVICE, pid: process.pid, port, startedAt: Date.now() })
    )
  } catch (err) {
    console.error(`[runtime] cannot write ${RUNTIME_FILE}: ${err.message}`)
  }
}

function removeRuntimeFile() {
  try {
    if (fs.existsSync(RUNTIME_FILE)) {
      const data = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'))
      if (data.pid === process.pid) fs.rmSync(RUNTIME_FILE) // 只清理自己的 runtime
    }
  } catch {
    /* best-effort */
  }
}

function shutdown(signal) {
  console.log(`\n[server] ${signal}, shutting down`)
  removeRuntimeFile()
  for (const client of wss.clients) client.terminate()
  if (httpServer) httpServer.close()
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

wss.on('connection', (socket) => {
  console.log(`[ws] client connected (${wss.clients.size} online)`)
  sendCurrent(socket) // 没有当前帧则保持连接等待广播
  socket.on('close', () => console.log(`[ws] client left (${wss.clients.size} online)`))
})

// ── 终端 QR（半块字符渲染，两行模块合成一行输出）──────────────
function qrMatrix(text) {
  const qr = qrcode(0, 'M') // type auto, 纠错 M
  qr.addData(text)
  qr.make()
  return qr
}

function renderQrToTerminal(text) {
  const qr = qrMatrix(text)
  const n = qr.getModuleCount()
  const quiet = 3
  const size = n + quiet * 2
  const at = (x, y) => x >= quiet && y >= quiet && x < quiet + n && y < quiet + n && qr.isDark(y - quiet, x - quiet)
  const lines = []
  // 上下两行模块合并为一个 Unicode 半块字符（▀▄█ ），密度减半
  for (let y = 0; y < size; y += 2) {
    let line = ''
    for (let x = 0; x < size; x++) {
      const top = at(x, y)
      const bottom = y + 1 < size && at(x, y + 1)
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' '
    }
    lines.push('  ' + line)
  }
  return lines
}

function printBanner(port) {
  const { urls, primary } = lanInfo(port)
  console.log('')
  console.log('LAN — Real-time Sketch preview over LAN')
  console.log('')
  console.log(`Scan to open on iPhone (primary):`)
  for (const line of renderQrToTerminal(primary)) console.log(line)
  console.log(`  ${primary}`)
  if (urls.length > 1) {
    console.log('')
    console.log('More LAN addresses:')
    for (const u of urls.slice(1)) console.log(`  ${u}`)
  }
  console.log('')
  console.log(`Local:      http://localhost:${port}`)
  console.log('Entry page: http://localhost:' + port + '/qr   (QR + all addresses)')
  console.log('')
  console.log('Waiting for device...')
}

// ── /qr 扫码入口页（极简静态 HTML，QR 内联 SVG）──────────────
function buildQrPage(primary, urls) {
  const qr = qrMatrix(primary)
  const svg = qr.createSvgTag({ cellSize: 10, margin: 3 })
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const otherRows = urls
    .slice(1)
    .map((u) => `<li><a href="${esc(u)}">${esc(u)}</a></li>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>览LAN — 扫码打开预览</title>
<style>
  body { font-family: -apple-system, "SF Pro Text", "PingFang SC", sans-serif;
         background: #111214; color: #e8e9ea; display: flex; min-height: 100vh;
         flex-direction: column; align-items: center; justify-content: center;
         gap: 16px; padding: 24px; }
  h1 { font-size: 20px; font-weight: 600; letter-spacing: 0.5px; }
  .qr { background: #fff; padding: 16px; border-radius: 16px; }
  .url { font-size: 15px; color: #9a9c9e; }
  .url a { color: #6db3f2; text-decoration: none; }
  ul { list-style: none; padding: 0; font-size: 13px; color: #9a9c9e; }
  ul a { color: #6db3f2; text-decoration: none; }
  .open a { color: #fff; text-decoration: none; background: #2b2d30;
            padding: 8px 18px; border-radius: 10px; font-size: 14px; }
</style>
</head>
<body>
<h1>览LAN</h1>
<div class="qr">${svg}</div>
<p class="url">手机扫码打开预览 Scan to open the Viewer<br><a href="${esc(primary)}">${esc(primary)}</a></p>
${otherRows ? `<ul>${otherRows}</ul>` : ''}
<p class="open"><a href="/">在本机打开预览 Open Viewer on this Mac</a></p>
</body>
</html>`
}

listen(DEFAULT_PORT, MAX_PORT_ATTEMPTS)
