/**
 * Sketch LAN Mirror — M1 独立 Node 服务
 * 架构依据 docs/ARCHITECTURE.md §4/§6：
 *   GET  /        手机端页面（public/index.html）
 *   GET  /health  健康检查
 *   GET  /current 最新 PNG（无则 404）
 *   POST /frame   插件推帧（PNG body + x-artboard-name/x-width/x-height/x-ts）
 *   WS            连接即补发当前帧；新帧二进制广播（前置一条 JSON 元信息文本帧）
 */

'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { WebSocketServer } = require('ws')

const DEFAULT_PORT = 9777
const MAX_PORT_ATTEMPTS = 20
const HOST = '0.0.0.0'
const SERVICE = 'sketch-lan-mirror'

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

// ── 局域网 IP：os.networkInterfaces()，不硬编码网卡名 ────────
function getLanAddresses() {
  const seen = new Set()
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const net of addresses || []) {
      if (net.family !== 'IPv4' || net.internal) continue
      // 只保留私有网段，过滤掉 VPN/TUN 等异常地址
      if (!/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(net.address)) continue
      seen.add(net.address)
    }
  }
  return [...seen]
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
    res.end(JSON.stringify({ ok: true, service: SERVICE }))
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
    }
  })
  server.listen(port, HOST, () => printBanner(server.address().port))
}

wss.on('connection', (socket) => {
  console.log(`[ws] client connected (${wss.clients.size} online)`)
  sendCurrent(socket) // 没有当前帧则保持连接等待广播
  socket.on('close', () => console.log(`[ws] client left (${wss.clients.size} online)`))
})

function printBanner(port) {
  const lanIPs = getLanAddresses()
  console.log('')
  console.log('Sketch LAN Mirror')
  console.log('')
  console.log('Local:')
  console.log(`  http://localhost:${port}`)
  console.log('')
  console.log('LAN:')
  if (lanIPs.length === 0) console.log('  (no LAN IPv4 address found)')
  for (const ip of lanIPs) console.log(`  http://${ip}:${port}`)
  console.log('')
  console.log('WebSocket:')
  for (const ip of lanIPs.length ? lanIPs : ['<lan-ip>']) console.log(`  ws://${ip}:${port}`)
  console.log('')
  console.log('Waiting for device...')
}

listen(DEFAULT_PORT, MAX_PORT_ATTEMPTS)
