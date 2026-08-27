# Mobile Viewer Architecture Rewrite（M3-C 设计文档）

> 状态：**已完成并真机验收（2026-08-27）**。
> 范围：仅改 `server/public/index.html`（单文件）。禁止改 `server/index.js` / `plugin/`。
> 实施偏差：① Immersive 未用 fixed 覆盖层，改为流布局（body.mode-immersive 可滚动），
> 更贴合「图片到物理屏底 + home indicator 浮在图片上」的需求；② PWA 底部布局
> 追加两态方案（ADR-014~016：bootViewportRecalc + pwa-strip/pwa-tight）。

---

## 1. 为什么要重构

M3-B 的 fullscreen 在 iOS PWA standalone 下经过多轮 patch（`100lvh` / `screen.height` / `fixed inset:0` / `absolute` / `sizeToScreen`）仍不稳定。根因不是某一个 CSS 值选错，而是**架构层面的问题**：

1. **普通模式禁止滚动**：`#stage` 用 `overflow:hidden + touch-action:none` 把图片锁在可见区内，画板高度超过 stage 就被裁断（用户截图 IMG_2616 实证）。违反 brief 第十七条。
2. **fullscreen 与 normal 共用 body 上下文**：fullscreen 用 `fixed inset:0` 模拟全屏，但在 iOS PWA 中 `fixed inset:0` 只到 layout viewport（= `innerHeight`），底部 34px 是 home indicator 系统 UI 区无法覆盖。多轮 patch 试图"撑到 852"全部被 layout viewport 锁死。
3. **没有明确状态机**：normal 用 `view = {scale,tx,ty,mode}`，fullscreen 用 `fsScale/fsTx/fsTy/isFull` 散落变量，靠 `isFull` 布尔 + DOM class 切换，没有统一的 `viewerMode` 状态。
4. **normal 模式也用 transform scale 做 fit**：复杂且与 fullscreen 的缩放逻辑耦合，普通模式本应只是"宽度填充 + 浏览器滚动"。

---

## 2. fullscreen bug 根因（最终结论）

### 2.1 iOS PWA layout viewport 锁

**iOS PWA standalone 模式下，元素的渲染高度被 WebKit layout viewport（= `window.innerHeight`）锁死。** 无论 CSS 设 `height: 852px` / `100lvh` / `100dvh` 还是 JS 设 `style.height = window.screen.height`，元素实际渲染高度最多到 `innerHeight`，多出的部分不可见（被 layout viewport 裁断）。

实证（多轮截图）：
- `height: 100lvh` → 仍只到 innerHeight，meta 文字延伸到 layout viewport 外被切（IMG_2620）
- `window.screen.height` 设像素值 → 同样被 layout viewport 截断
- `position: fixed; bottom: 0` → 解析到 layout viewport 底（= innerHeight 底），不是物理屏底

### 2.2 home indicator 系统 UI 区

iOS PWA 底部 34px 是 home indicator 系统 UI 区（半透明白横线 + 渐变浮层），**网页永远无法覆盖**。任何内容延伸到该区域都会被系统浮层遮盖。这是 iOS 物理限制，不是 CSS/JS 能解决的。

### 2.3 结论

**fullscreen 的目标不是"覆盖到物理屏底"（不可能），而是"让图片成为 Web App 内容区域的唯一主体"**（brief 第五条）。即覆盖到 layout viewport（= innerHeight），接受底部 34px 是 home indicator 区。新架构不再做任何"撑到 852"的尝试。

---

## 3. 当前 DOM hierarchy

```
body (flex column, padding 含 safe-area)
├── header (status dot + title)
├── main (flex:1)
│   ├── #stage (flex:1, overflow:hidden, touch-action:none)  ← 禁止滚动，画板被裁
│   │   ├── #placeholder
│   │   └── #canvas (absolute, transform: translate3d+scale)
│   │       └── #img
│   └── #meta (流布局, padding-bottom: safeB)
└── #fullscreen (fixed inset:0, display:none→block)  ← 只到 layout viewport
    └── #fsImg (width:100%, transform: scale)
```

**问题**：
- `#stage` 的 `overflow:hidden + touch-action:none` 禁止普通模式滚动
- normal 和 fullscreen 都用 `transform: scale` 做 fit/cover，两套缩放逻辑耦合
- fullscreen 用 `fixed inset:0` 与 body 共用 viewport 上下文，无法独立 layout

---

## 4. 新 DOM architecture

```
<html>
  <head> meta + <style> </head>
  <body> (app shell, flex column, safe-area padding)
    <header> (status dot + title)
    <main id="normalViewer"> (普通模式, 浏览器原生滚动)
      <div class="imageWrap"> (width: 100%)
        <img id="normalImg"> (width: 100%, height: auto)
      </div>
    </main>
    <footer id="docInfo"> (Artboard 一行 + 尺寸·时间一行)
    <div id="immersiveViewer" data-mode="hidden"> (全屏, fixed inset:0, 独立 gesture)
      <div class="gestureSurface"> (touch-action: none)
        <img id="immersiveImg"> (width-fit, transform: translate3d+scale)
      </div>
    </div>
  </body>
</html>
```

### 关键设计

- **普通模式**：`<main>` 用浏览器原生滚动（`overflow-y: auto` + `-webkit-overflow-scrolling: touch`），图片 `width: 100%; height: auto`，高度按比例自然计算，超出视口就滚动。**不用 transform scale，不用 overflow hidden，不用 touch-action none**。
- **沉浸模式**：`#immersiveViewer` 用 `position: fixed; inset: 0; z-index: 50`，覆盖到 layout viewport。内部 `.gestureSurface` 用 `touch-action: none` + JS Pointer Events 接管手势。图片 width-fit（width = viewport content width）。
- **两个 img 元素**：`#normalImg` 和 `#immersiveImg` 独立，但共用同一个 Blob URL（`img.src = objectUrl`）。不同时渲染（immersive 隐藏时 `display:none`）。
- **独立 layout context**：normal 在 body 流内（浏览器滚动），immersive 是 fixed 覆盖层（独立 transform）。不通过大量 position/overflow/transform 互相覆盖模拟 fullscreen。

---

## 5. 状态模型

```js
var state = {
  // 连接状态
  connection: 'connecting',  // 'connecting' | 'online' | 'offline'

  // 图片状态
  image: {
    hasFrame: false,
    dims: { w: 0, h: 0 },    // 设计像素（metadata 或 PNG IHDR）
    name: null,               // 最近画板名（null = 未知，如重连补帧）
    lastName: null,           // 上一帧画板名（用于切换判定）
    objectUrl: null,          // 当前 Blob URL
  },

  // Viewer 模式
  viewerMode: 'NORMAL',       // 'NORMAL' | 'IMMERSIVE'

  // 缩放状态（仅 IMMERSIVE 用）
  zoom: {
    scale: 1,                 // 1 = width-fit
    offsetX: 0,               // translate X（gestureSurface 坐标系）
    offsetY: 0,               // translate Y
  },
}
```

### 状态转换

```
connection: connecting → online → offline → connecting ...
viewerMode: NORMAL ⇄ IMMERSIVE（双击切换）

进入 IMMERSIVE: resetZoomState() → zoom = {scale: fitScale, offsetX:0, offsetY:0}
退出 IMMERSIVE: 不保存 zoom（下次进入重新 reset）
新画板到达 + IMMERSIVE: 退出 IMMERSIVE → NORMAL（brief 第十九条）
```

### 不做的事

- 不靠 DOM class 反推业务状态（`if (el.classList.contains('show'))`）
- 不保存 `lastFullscreenZoom` / `lastFullscreenPan`
- 不在 normal 模式用 transform scale

---

## 6. fullscreen（IMMERSIVE）模型

### 6.1 进入条件

- 在 `#normalImg` 上检测双击（tap detector：< 10px 位移 + < 350ms 间隔）
- 不 preventDefault pointermove（允许普通模式滚动）

### 6.2 进入瞬间

```js
function enterImmersive() {
  state.viewerMode = 'IMMERSIVE'
  resetZoomState()           // scale=fitScale, offsetX=0, offsetY=0
  immersiveImg.src = state.image.objectUrl
  immersiveViewer.setAttribute('data-mode', 'immersive')  // display:block
  renderImmersive()
}
```

### 6.3 width-fit 计算

```js
function fitScale() {
  var vw = gestureSurface.clientWidth
  if (!state.image.dims.w) return 1
  return vw / state.image.dims.w   // width-fit: 图片宽度 = viewport 宽度
}
```

### 6.4 退出

- 在 `#immersiveViewer` 上检测双击 → `exitImmersive()`
- `immersiveViewer.setAttribute('data-mode', 'hidden')` → display:none
- 不保存 zoom state

### 6.5 viewport 策略

- `#immersiveViewer { position: fixed; inset: 0; }` 覆盖到 layout viewport
- **不依赖 `100vh` / `100dvh` / `100lvh`**（iOS PWA 行为不一致）
- **接受底部 34px 是 home indicator 区**（iOS 物理限制，无法覆盖）
- 用 `inset: 0` 让浏览器决定（最可靠）

---

## 7. gesture 策略

### 7.1 NORMAL 模式

- **浏览器原生滚动**（main `overflow-y: auto`）
- 不拦截 pointer events（允许滚动）
- 仅在 `#normalImg` 上监听 pointerup 做 tap 检测（双击进入 IMMERSIVE）
- 不 preventDefault

### 7.2 IMMERSIVE 模式

- `.gestureSurface { touch-action: none }` + JS Pointer Events 接管
- `pointerdown`: 记录 pointers（Map）
- `pointermove`:
  - 双指 → pinch zoom（以两指中点为锚点）
  - 单指 → pan（仅 scale > fitScale 时有效位移）
- `pointerup`:
  - tap 检测（< 10px 位移）→ 双击退出
- `pointercancel`: 清理 pointers
- 屏蔽 `gesturestart/change/end` + `dblclick`（防 iOS 页面级缩放）

### 7.3 pinch 锚点

```js
// 以两指中点 (mx,my) 为锚点缩放到 ns
function zoomAt(ns, mx, my) {
  ns = clampScale(ns)
  zoom.offsetX = mx - (mx - zoom.offsetX) * ns / zoom.scale
  zoom.offsetY = my - (my - zoom.offsetY) * ns / zoom.scale
  zoom.scale = ns
  renderImmersive()
}
```

### 7.4 pan 边界

- 内容某轴 ≤ 视口时该轴锁定居中
- 大于视口时允许 ±48px edge overscroll，不可无限拖出

---

## 8. 滚动模型

| 模式 | 滚动方式 | body overflow | gestureSurface touch-action |
|---|---|---|---|
| NORMAL | 浏览器原生滚动 main | visible/auto | N/A |
| IMMERSIVE | JS transform 接管 | hidden | none |

- NORMAL：`main { overflow-y: auto; -webkit-overflow-scrolling: touch; }`
- IMMERSIVE：`body { overflow: hidden; }` + `gestureSurface { touch-action: none; }`
- 不同时用 scrollTop + translate 控制同一图片

---

## 9. 图片实时更新

### 9.1 数据流

```
WebSocket → Binary PNG Blob → URL.createObjectURL → img.src
```

- 不用 canvas / Base64 / pixel processing
- 每帧创建新 objectURL，替换 img.src 后 `URL.revokeObjectURL(previousURL)`

### 9.2 同画板更新

- Artboard 相同（尺寸不变 且 名称未变）⇒ 保留当前 viewer state
  - NORMAL：保留 scroll position
  - IMMERSIVE：保留 scale / offsetX / offsetY
- 仅更新 `img.src`（normalImg + immersiveImg 都更新）

### 9.3 画板切换

- 尺寸变化 或（双方名称已知且不同）⇒ 判定为切换
- NORMAL：更新图片，保持宽度填充
- IMMERSIVE：**退出 IMMERSIVE 回到 NORMAL**（brief 第十九条），新画板 width-fit
- 不把旧画板的 zoom/pan 带到新画板

### 9.4 尺寸来源

- 优先用 metadata.width / metadata.height
- 无 metadata 时从 PNG IHDR 解析（bytes 16–24，大端）
- Viewer 坐标计算基于 Artboard intrinsic dimensions，不只依赖 `img.naturalWidth`

---

## 10. PWA standalone 检测

```js
var isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true
```

- 检测但不因 standalone 走完全不同的 Viewer
- Normal / Immersive 行为一致
- 只有 safe-area / viewport 允许存在环境差异

---

## 11. safe-area 处理

- **App shell 负责 safe-area**（body padding 含 `env(safe-area-inset-*)`）
- **Viewer content 不直接作用 safe-area padding**（图片不被 safe-area 缩小/偏移）
- normalViewer 在 body padding 内，图片 width: 100% 填充 content width
- immersiveViewer 用 `fixed inset:0` 覆盖整个 layout viewport（含 safe-area 区），图片 width-fit 到 viewport width

---

## 12. 视觉原则

- 极简，不新增 Fit/100%/缩放百分比/fullscreen button/floating controls
- 交互保持：双击→Immersive，Pinch→Zoom，Pan→Move
- 底部信息：Artboard 一行 + 尺寸·时间一行（不变）

---

## 13. 文件结构

**保持单文件 `server/public/index.html`**（不拆分）。

理由：`server/index.js` 第 39 行 `const INDEX_HTML = fs.readFileSync(...)` 启动时缓存，且 GET / 只返回 index.html，**没有静态文件服务**。brief 第二条禁止改 server/index.js，所以拆分 styles.css/viewer.js 会导致 404。

内部结构清晰分段：
```html
<style>
  /* 1. Reset & App Shell */
  /* 2. Header */
  /* 3. Normal Viewer */
  /* 4. Doc Info */
  /* 5. Immersive Viewer */
</style>
<script>
  /* 1. State */
  /* 2. Connection (WS + reconnect) */
  /* 3. Image loading (Blob URL + IHDR) */
  /* 4. Normal Viewer (scroll + double-tap detect) */
  /* 5. Immersive Viewer (zoom + pan + pinch + double-tap) */
  /* 6. Frame processing (switch detection) */
  /* 7. Viewport change (orientation) */
  /* 8. Init */
</script>
```

---

## 14. 迁移策略

### 14.1 保留不变的部分

- WebSocket 连接逻辑（connect / onopen / onmessage / onclose / 指数退避重连）
- visibilitychange 回前台重连 + /current 补帧
- Blob URL 创建 + revoke 生命周期
- PNG IHDR 尺寸解析兜底
- 画板切换判定（尺寸变化 或 双方名称已知且不同）
- meta 文本更新（Artboard / 尺寸 / 更新时间）
- apple-mobile-web-app-capable / status-bar-style / viewport-fit=cover meta
- 屏蔽 gesturestart/change/end + dblclick

### 14.2 重写的部分

- DOM 结构（三层：app shell / normal viewer / immersive viewer）
- CSS（normal 允许滚动，immersive fixed inset:0 独立 gesture surface）
- 状态模型（统一 state 对象，viewerMode: NORMAL/IMMERSIVE）
- normal 模式手势（不拦截 pointer，仅 tap 检测）
- immersive 模式手势（Pointer Events + touch-action none）
- immersive 进入/退出（reset zoom state，不记忆）

### 14.3 删除的部分

- `#stage` / `#canvas` / `#placeholder`（normal 不再用 transform fit）
- `view = {scale, tx, ty, mode}`（normal 不再缩放）
- `fsScale/fsTx/fsTy/isFull` 散落变量（统一到 state.zoom + state.viewerMode）
- `sizeToScreen` / `safeInset` / `fsViewH`（不再撑到 852）
- `100lvh` / `-webkit-fill-available` / `screen.height`（layout viewport 锁已证无效）
- normal 模式的 `fitScale/clampScale/clampTranslate/zoomAt`（normal 不缩放）

---

## 15. 测试矩阵（brief 第二十三/二十四条）

### PWA standalone

| Case | 操作 | 预期 |
|---|---|---|
| PWA-01 | 打开 LAN → 收到 PNG → 双击 | 图片完整填充 Web App 内容区域 |
| PWA-02 | immersive → pinch zoom | 正常放大 |
| PWA-03 | immersive → pinch → pan | 正常移动 |
| PWA-04 | immersive → double tap exit | 回到 NORMAL |
| PWA-05 | immersive → exit → 再进入 | 重新 Width Fit，不恢复上次 zoom |
| PWA-06 | immersive → Sketch 修改 | 图片更新，viewport 不跳 |
| PWA-07 | lock screen → unlock | Viewer 恢复，WS 自动 reconnect |
| PWA-08 | Safari browser 重复全部测试 | 同上 |

### 重点验证

- 普通模式**可以上下滚动**（修复"画板被裁断"）
- 普通模式双击进入 immersive
- immersive pinch 中点稳定
- immersive pan 不无限拖出
- immersive 双击退出
- 再次进入 immersive 是 width-fit（不记忆）
- 新画板到达时 immersive 退出回 normal
- 长时间运行无 Blob URL 泄漏

---

## 16. 已知限制（接受）

1. **iOS PWA 底部 34px 是 home indicator 系统 UI 区**，网页无法覆盖。immersive 模式 `fixed inset:0` 覆盖到 layout viewport（= innerHeight），底部 34px 是系统区。这是 iOS 物理限制。
2. **Safari 直开**底部有 Safari URL bar / 工具栏（浏览器 chrome），网页无法消除。建议用 PWA（添加到主屏幕）获得更干净的底部。
3. **画板切换判定**受协议冻结限制（meta 无 artboard id），用「尺寸变化 或 双方名称已知且不同」启发式。重连补帧（/current 只有二进制）无名称，同尺寸的不同画板会被视为同画板（低频场景，可接受）。

---

## 17. 完成后更新

- `docs/VIEWER-REWRITE.md`（本文档，标记完成）
- `README.md`（M3-C 状态 + 行为说明）
- `docs/DECISIONS.md`（ADR-014：iOS PWA layout viewport 锁 + 重构决策）
