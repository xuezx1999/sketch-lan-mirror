# Sketch LAN Mirror — 技术方案（MVP v0）

> 状态：方案设计阶段，未开始业务编码
> 目标版本：Sketch 2026.2（Edinburgh）/ macOS / 手机端仅支持 Safari
> 信息标注约定：【Fact】= 官方文档已核实；【Inference】= 基于已知机制的推断，编码前需实测验证

---

## 1. 目标与非目标

**MVP 目标**：手机 Safari 打开 `http://<Mac 局域网 IP>:<port>`，实时看到 Sketch 当前选中 Artboard 的 PNG；Artboard 内容变化后自动更新。

**非目标（第一阶段明确不做）**：登录鉴权、云端、数据库、评论、标注、Prototype、AI、Figma 支持。

---

## 2. 总体架构

```
┌─ Mac ──────────────────────────────────────┐      ┌─ iPhone ─────────┐
│                                            │      │                  │
│  Sketch 2026.2                             │      │  Safari          │
│  └─ 插件（JavaScriptCore 环境）             │      │  └─ 页面          │
│     ├─ 监听：SelectionChanged /            │      │     ├─ <img> 显示 │
│     │        ArtboardChanged / 定时心跳     │      │     │    PNG      │
│     ├─ 防抖 → sketch.export() → PNG Buffer │      │     └─ 断线重连   │
│     └─ 经 Cocoa bridge 发 localhost POST ───┼──►  │                  │
│                                            │ PNG  │        ▲         │
│  Node 本机服务（独立进程）                    │      │        │         │
│  ├─ GET /        返回手机端页面              │      └────────┼─────────┘
│  ├─ POST /frame  接收 PNG                   │      WebSocket 广播
│  └─ WS 广播      推送给所有已连接手机 ────────┼──────────────┘
└────────────────────────────────────────────┘
```

核心决策一句话：**插件只做「感知变化 + 导出 PNG + 推帧」，Node 独立进程持有 HTTP + WebSocket 服务**。

---

## 3. 七个关键技术确认点

### 3.1 如何监听 document change

【Fact】官方 Actions Reference（2026.2）中**不存在 `ContentsChanged`**（子页面 404，索引列表中亦无）。旧资料里的 `onContentsChanged` 写法不可依赖。

可用的事实基础：

| Action | 触发时机 | actionContext |
|---|---|---|
| `SelectionChanged` | 用户改变所选图层 | `document` / `oldSelection` / `newSelection` |
| `ArtboardChanged` | 当前 Artboard 变化（新增/选中/删除） | `document` / `oldArtboard` / `newArtboard` |
| `TextChanged` / `LayersMoved` / `LayersResized` 等 | 各自的细粒度操作 | 见各子页 |

【Inference】细粒度 action 覆盖不了所有编辑路径（改填充色、调样式等未必有对应 action）。因此 MVP 的变化检测采用 **「事件加速 + 心跳兜底」**：

1. 注册 `SelectionChanged` + `ArtboardChanged` → 立即触发一次检查；
2. 插件常驻一个低频定时器（约 1s，NSTimer 经 bridge 创建）：对当前 Artboard 做 `sketch.export`（低 scale 或对上次 PNG 计算哈希对比）；
3. 内容真的变了才推帧 —— 用 PNG 字节哈希去重，天然过滤无效轮询。

这样不依赖任何不确定存在的 action，可靠性最高。响应延迟上限 ≈ 心跳间隔，对预览场景可接受。后续若要更低延迟，再按需叠加 `TextChanged` / `LayersMoved` 等做即时触发。

### 3.2 如何获取当前选中的 Artboard

【Fact】2025.1 起 Artboard 已被 Frames/Graphics 取代，`Artboard` 类保留为「顶层 Frame 的类型标记」，通过 `layer.type == sketch.Types.Artboard` 判定，`find('Artboard')` 仍可用。

```js
const sketch = require('sketch/dom')
const document = sketch.getSelectedDocument()   // 无打开文档时为 undefined
const layers = document?.selectedPage?.selectedLayers?.layers ?? []
const artboard = layers.find(l => l.type === sketch.Types.Artboard)
```

回退策略（MVP）：选区为空或不含 Artboard 时，保持上一次镜像的画面不变；从未有过则手机端显示等待提示。

### 3.3 如何通过 sketch.export() 获取 PNG Buffer

```js
const sketch = require('sketch')
const [buffer] = sketch.export(artboard, {
  formats: 'png',
  scales: '2',
  output: false,   // 关键：false = 不落盘，返回 Buffer 数组
})
```

【Fact】`output: false` 返回 Buffer 数组是官方 Export API 的标准行为（文档正文抓取被截断，此条置信度 High 但编码第一天先写最小验证脚本实测）。Buffer 可直接作为 HTTP body 发送；Node 端原样转发即可。

### 3.4 插件与本机 Node 服务如何通信

【Fact】Sketch 插件运行在宿主内的 JavaScriptCore（CocoaScript/Mocha bridge），**没有 Node 内置模块**——不能 `require('http'/'net'/'ws')`。可通过 bridge 调任意 Cocoa/Foundation 能力。

方向选择：**Plugin → Server 用 localhost HTTP POST（单向推帧）**，Server → 手机用 WebSocket 广播。

- 插件侧发请求：经 bridge 用 `NSMutableURLRequest` + `NSURLSession`（或信号量同步请求）向 `127.0.0.1:<port>/frame` POST PNG body + 元信息头（artboard 名、尺寸、时间戳）。PNG 数百 KB、走 loopback，耗时毫秒级。
- 为什么插件侧不用 WebSocket 客户端：JSC 里没有现成 ws 实现，手写 WS 帧协议不值得；MVP 只需要单向推帧，HTTP POST 最简单可靠。
- 备选记录：`@skpm/child_process`（底层 NSTask）可在构建链里使用；若不走 skpm，也可直接经 bridge 调 `NSTask`。MVP 不引入 skpm 构建链（见 §5）。

### 3.5 WebSocket 服务由谁启动

**结论：由独立 Node 进程启动并持有 HTTP + WebSocket 服务；插件只负责该进程的生命周期管理（拉起/复用/退出清理）。**

否决「插件内起服务」的理由：

| 维度 | 插件内起服务 | 独立 Node 进程 |
|---|---|---|
| TCP/WebSocket 实现 | 需经 ObjC bridge 手写 socket + WS 握手帧协议，高风险 | Node `ws` 一个依赖搞定 |
| 稳定性 | 与 Sketch 主线程耦合，卡顿/崩溃连坐 | 崩溃可独立重启，页面提示重连 |
| 开销 | 省一个进程 | 多一个 ~40MB 进程（可接受） |
| 复杂度 | 高 | 低 |

进程拉起方式分两步走：

1. **MVP 先手动**：开发期 `node server/index.js` 手动启动（用户本机有 Node）；
2. **第二步自动化**：插件启动命令时经 bridge 用 `NSTask` 拉起 `/usr/bin/env node …`，`Shutdown` 时 kill。接口设计现在就按「server 可被外部拉起」来做，后面只是加一层壳。

### 3.6 Sketch 插件的生命周期限制

【Fact / 成熟机制】

- 每个 command 是一次独立的脚本求值；跨调用持久状态放插件作用域的全局变量或 `context` 上（如 timer 句柄、当前 artboard id、上次哈希）。
- 经 bridge 创建的 `NSTimer` 可以在两次 command 调用之间持续运行——这是实现「常驻监听」的标准手段。
- 必须注册 `Shutdown` handler：停掉 timer、kill Node 子进程（未来）、清空全局状态。Sketch 退出/插件卸载时会触发。
- 边界情况必须处理：`getSelectedDocument()` 为 `undefined`（无文档）、文档切换、Artboard 被删除。
- 【Inference】同步 HTTP POST 会阻塞主线程；loopback 毫秒级可接受，但仍要做防抖（变化风暴时合并为一帧），必要时丢帧只发最新一帧。

### 3.7 macOS 本机局域网访问注意事项

- **防火墙**：首次有进程监听端口时 macOS 会弹「是否允许接受传入网络连接」。官方签名的 node 二进制只需允许一次；要在 README 里写明。
- **获取局域网 IP**：放在 **server 端**用 `os.networkInterfaces()` 过滤 IPv4 私有地址（比插件里跑 `ipconfig getifaddr en0` 稳，en0 不一定是活跃网卡）。server 启动后在控制台打印所有可访问的 `http://<ip>:<port>`。
- **端口**：固定高位端口（默认 `9777`，避开常用端口），被占用则递增并把实际端口打印出来。
- **iOS Safari 明文 http**：局域网 IP 直接访问没有问题，不需要也不建议自签 HTTPS（证书信任会劝退用户）。
- **iOS「本地网络」权限**：iOS 14+ 第一次访问局域网 IP 会弹权限，允许即可，README 说明。
- **手机息屏/切后台**：Safari 会断开 WS。页面必须实现：断线重连（指数退避）+ `visibilitychange` 回前台立即重连并拉取最新帧。
- **发现方式 MVP 从简**：不做 Bonjour，靠控制台打印 URL（后续可选加二维码终端输出）。

---

## 4. MVP 数据流（时序）

1. 用户在 Sketch 里执行插件命令「Start Mirror」（首次需手动启动过 Node 服务）。
2. 插件解析当前选中 Artboard，立即导出一帧并 POST 给 server；server 广播给已连接的手机。
3. 插件注册 `SelectionChanged` / `ArtboardChanged` + 启动 1s 心跳 timer。
4. 任一来源触发 → 取当前 Artboard → 导出 PNG → 与上一帧哈希比对 → 不同才 POST（防抖合并，只保留最新一帧）。
5. 手机页面收到 WS 二进制帧 → 更新 `<img>`；断线时自动重连并向 `GET /current` 补拉最新一帧。
6. 用户执行「Stop Mirror」或 Sketch 退出 → `Shutdown` 清理 timer 与状态。

---

## 5. 目录结构

```
sketch-lan-mirror/
├── docs/
│   ├── ARCHITECTURE.md          # 本方案
│   └── DECISIONS.md             # 关键决策记录（ADR 式追加）
├── plugin/                      # Sketch 插件（手写 bundle，零构建链）
│   ├── package.json             # 仅声明元信息与开发脚本，不含打包依赖
│   └── src/
│       ├── manifest.json        # commands + handlers.actions 注册
│       │                        #   actions: Startup / Shutdown /
│       │                        #           SelectionChanged / ArtboardChanged
│       ├── sketch-lan-mirror.sketchplugin/
│       │   └── Contents/
│       │       ├── Info.plist
│       │       └── Sketch/
│       │           ├── manifest.json
│       │           └── script.cocoascript   # 全部插件逻辑单文件起步
│       └── (逻辑拆分仅在超过 ~500 行后再考虑)
├── server/                      # 独立 Node 服务
│   ├── package.json             # 唯一运行时依赖：ws
│   ├── index.js                 # http 静态路由 + POST /frame + WS 广播 + LAN IP 打印
│   └── public/
│       └── index.html           # 手机端：WS 连接 / <img> 渲染 / 断线重连（自包含，无框架）
├── scripts/
│   └── dev.sh                   # 一键：起 server + 打开插件目录说明
└── README.md
```

取舍说明：

- **插件不引入 skpm/webpack 构建链**：逻辑量小，手写 `.sketchplugin` 目录（manifest.json + script）即可被 Sketch 直接加载，改完即测，零依赖风险。【Inference】skpm 近年维护活跃度未知，不赌它。
- **server 只依赖 `ws`**：静态文件路由手写（就一个 html），不引 express。
- **手机页面零框架**：原生 JS + `<img>`（blob URL 或 dataURL），单文件自包含。

## 6. 协议草案（server 内部接口）

| 方法/通道 | 路径 | 方向 | 载荷 |
|---|---|---|---|
| GET | `/` | 浏览器 ← server | index.html |
| GET | `/current` | 浏览器 ← server | 最新 PNG（重连补帧用） |
| POST | `/frame` | 插件 → server | body: PNG；headers: `x-artboard-name`、`x-width`、`x-height`、`x-ts` |
| WS | `/` upgrade | server → 浏览器 | 二进制帧 = PNG；首帧前发一条 JSON 文本帧（artboard 元信息） |

## 7. 风险与边界（MVP 接受 / 记录不解）

| 风险 | 处理 |
|---|---|
| 大 Artboard（超长页面）导出慢 | scales 固定 1x 起步；导出耗时超过心跳间隔则跳过本轮 |
| 编辑风暴（连续拖动） | 防抖 + 只发最新帧 |
| 心跳轮询空转耗电 | 哈希相同即丢弃，loopback + 本地导出成本可控 |
| `output:false` Buffer 行为差异 | 第一天写最小验证脚本实测 |
| 多显示器/多文档切换 | 以 `getSelectedDocument()` 为准，文档无 Artboard 时保持最后画面 |

## 8. 第二阶段候选（本期不设计）

Bonjour 自动发现、二维码展示、多 Artboard 缩略图墙、@2x 切换、深浅色背景切换、插件自动拉起 Node 进程。
