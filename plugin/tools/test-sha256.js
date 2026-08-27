// M4-A 验证：从 script.cocoascript 提取纯 JS SHA-256，对拍 node crypto。
// 用法：node plugin/tools/test-sha256.js
// （仅校验兜底实现的正确性/性能；Sketch 内主路径是 CKSHA256 原生哈希）
var fs = require('fs')
var crypto = require('crypto')

var src = fs.readFileSync(__dirname + '/../src/sketch-lan-mirror.sketchplugin/Contents/Sketch/script.cocoascript', 'utf8')

// 提取 SHA256_K / sha256HexBytes / sha256Compress 三个定义
function extract(name) {
  var start = src.indexOf('function ' + name + '(')
  if (start === -1) throw new Error('not found: ' + name)
  var depth = 0, i = src.indexOf('{', start)
  for (var j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  throw new Error('unbalanced: ' + name)
}
var kStart = src.indexOf('var SHA256_K = [')
var kEnd = src.indexOf(']', kStart) + 1

eval(src.slice(kStart, kEnd))
eval(extract('sha256HexBytes'))
eval(extract('sha256Compress'))

// ── 正确性：各种边界长度对拍（覆盖 55/56/57/63/64 分块边界）──
var sizes = [0, 1, 3, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000, 4095, 4096, 65536, 300000]
var pass = 0, fail = 0
sizes.forEach(function (n) {
  var buf = new Uint8Array(n)
  for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256)
  var mine = sha256HexBytes(buf)
  var ref = crypto.createHash('sha256').update(buf).digest('hex')
  if (mine === ref) pass++
  else { fail++; console.log('MISMATCH at len=' + n + ' mine=' + mine + ' ref=' + ref) }
})
console.log('correctness: ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)

// 已知向量（空串 SHA-256）
console.log('empty-vector ok:',
  sha256HexBytes(new Uint8Array(0)) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

// ── 性能：典型 PNG 尺寸（node/V8 量级，JSC 同数量级参考）──
[50 * 1024, 200 * 1024, 500 * 1024, 1024 * 1024].forEach(function (n) {
  var buf = new Uint8Array(n)
  for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256)
  var rounds = 10
  var t0 = Date.now()
  for (var r = 0; r < rounds; r++) sha256HexBytes(buf)
  var ms = (Date.now() - t0) / rounds
  console.log('JS sha256 ' + (n / 1024) + 'KB: ' + ms.toFixed(1) + 'ms/次 (' +
    (n / 1024 / 1024 / (ms / 1000)).toFixed(1) + ' MB/s)')
})
