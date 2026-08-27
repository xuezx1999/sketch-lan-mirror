# Sketch LAN Mirror

通过同一局域网内的手机 Safari，实时查看 Mac 上 Sketch 当前选中的 Artboard。

**状态：M3-A 验收通过（2026-08-26，v0.3.2）；M3-C Viewer 架构重写完成并真机验收（2026-08-27）。**

## Mobile Viewer（M3-C，现行架构）

三层 DOM：app shell（body flex 列 + safe-area）/ Normal Viewer（固定视口 fit + pinch + pan）/ Immersive Viewer（流布局可滚动，双击进出）：

- **Normal**：默认 Fit to Screen 整板可见；双指 Pinch（以两指中点为锚，范围 `[fitScale, 5]`）；放大后单指 Pan（±48px 边缘 overscroll）；新帧不跳视口
- **Immersive**：双击进入，图片 width-fit + body 原生滚动（长图滑动）；pinch 焦点跟手（rAF 动画提交 scrollY，松手不跳）；双击退出；不记忆上次 zoom
- 画板切换自动退出 Immersive 回 Normal 并重新 Fit；跨 Page 切换正常推送（plugin 侧 pageId 检测）
- iOS PWA 布局：`bootViewportRecalc` 启动时把视口撑到全屏（见 DECISIONS ADR-014~016），docInfo 紧贴 Home Indicator 安全区上沿

> 注意：server 启动时缓存页面，改 `public/index.html` 后需重启 server。

```
Sketch 2026.2 插件 ──POST PNG──► Node LAN Server ──WebSocket──► iPhone Safari
     (选中 Artboard)               http://<lan-ip>:9777            <img> 实时刷新
```

## 快速开始

### 1. 启动 Server（Mac）

```bash
cd server
npm install        # 唯一依赖 ws，首次执行
node index.js      # 默认端口 9777，被占用自动递增
```

启动后打印 Local / LAN / WebSocket 地址。手机访问 **LAN 地址**。

> 注意：如果 shell 环境注入了 `NODE_OPTIONS=--use-system-ca` 会与 Node 22.12 冲突，
> 用 `env -u NODE_OPTIONS node index.js` 启动。

### 2. 安装插件（Mac）

插件目录已软链到 Sketch 插件目录：

```
~/Library/Application Support/com.bohemiancoding.sketch3/Plugins/sketch-lan-mirror.sketchplugin
  → 本仓库 plugin/src/sketch-lan-mirror.sketchplugin
```

**重启 Sketch** 后，菜单栏出现：

```
Plugins ▸ Sketch LAN Mirror ▸ Send Current Frame
```

### 3. 发送一帧 / 实时镜像

1. 手机 Safari 打开 server 打印的 LAN 地址（如 `http://192.168.x.x:9777`）
   - 首次访问 iOS 会请求「本地网络」权限，允许
   - 页面绿点 = 已连接
2. Sketch 菜单：

```
Plugins ▸ Sketch LAN Mirror
├── Send Current Frame   # 单帧发送
├── Start Mirror         # 开始 1s 自动轮询当前选中 Artboard
└── Stop Mirror          # 停止轮询
```

- `Start Mirror`：立即发第一帧，之后每秒自动推送；改 Sketch 内容手机最迟 ~1s 更新
- **选中画板内任意图层/组即可推送所属画板**（parent 链向上归属，无需点击外框选中整体）
- 重复 Start 会提示 "Mirror already running"，不会创建第二个定时器
- 未选中 Artboard（或选区不在任何画板内）时 tick 只记日志、保留手机最后一帧
- 切换选中的 Artboard 后下个 tick 立即切换画面；跨画板多选时优先保持当前画板
- 上一帧未发完时跳过本轮（latest-frame-only，不排队）
- 每 tick 导出前做渲染缓存刷新（定时器回调里的 `sketch.export` 可能拿到陈旧渲染，ADR-010）
- 运行中删除当前 Artboard：Sketch 的自动跳选**不会**被推送到手机（保持最后一帧），
  手动选中其他画板（含其内部图层）后恢复推送（ADR-011）

## 手动测试（无插件）

```bash
# 推一张本机图片
curl -X POST http://localhost:9777/frame \
  -H 'Content-Type: image/png' \
  -H 'x-artboard-name: TestBoard' -H 'x-width: 375' -H 'x-height: 812' \
  --data-binary @test.png
```

| 端点 | 说明 |
|---|---|
| `GET /` | 手机端页面 |
| `GET /health` | `{"ok":true,"service":"sketch-lan-mirror"}` |
| `GET /current` | 最新 PNG（无则 404） |
| `POST /frame` | PNG body + `x-artboard-name`/`x-width`/`x-height`/`x-ts`（非 ASCII 名称需百分号编码） |
| WebSocket `/` | 二进制 PNG 帧；连接即补发当前帧 |

手机端特性：断线指数退避重连（1s→15s）、回前台立即重连并拉取 `/current` 补帧。

## 目录结构

```
docs/ARCHITECTURE.md    总体技术方案（M0）
docs/DECISIONS.md       实测决策记录（必读，含 API 真实行为与坑）
server/                 M1：独立 Node 服务（仅依赖 ws）
plugin/src/*.sketchplugin   M2：Sketch 插件（手写 bundle，零构建链）
```

## 已知限制（按设计）

- M3-A 刻意最简：无 hash/diff/事件监听/防抖，每秒全量导出+推送（ADR-008）
- 同步 POST 在主线程执行（loopback 实测 1–5ms，详见 DECISIONS ADR-004）
- 中文画板名经 header 百分号编码传输（ADR-005）
- 仅支持 `type === 'Artboard'` 的顶层容器（2025.1+ Frames/Graphics 中的 legacy 标记类型）
