<p align="center"><img src="brand/logo.svg" width="96" alt="LAN"></p>

# LAN

**Real-time Sketch preview over LAN.**

Preview your Sketch Artboards on your phone, in real time, over your local network.

```
Sketch ──LAN──► iPhone
```

从 Sketch 打开一扇窗，让手机看到里面的画面。

**状态：v0.5.0（M4-D 单文件分发，READY FOR MANUAL ACCEPTANCE）**

## Quick Start

**前提**：Mac 和 iPhone 连接**同一局域网**（Wi-Fi）。插件内嵌 Node 运行时，**Mac 无需安装 Node.js**（Sketch 2025.3.4 实测通过）。

1. **Install LAN plugin** — 下载 Release 包（`LAN-v0.5.0.zip`），解压后双击 `LAN.sketchplugin` 安装（插件自带 Node 运行时与 server，无需 clone 仓库、无需 npm install）
2. **Start LAN** — Sketch 菜单 `Plugins ▸ LAN ▸ Start LAN`，本地 server 自动启动（已运行则复用）
3. **Wait for LAN ready** — 弹窗显示访问地址
4. **Scan QR code with iPhone** — Mac 上 `Plugins ▸ LAN ▸ Open LAN Viewer` 打开扫码页，手机扫码
5. **Open Viewer** — 手机 Safari 打开，立即看到当前选中的 Artboard
6. **Optionally Add to Home Screen** — Safari 分享 → 添加到主屏幕，之后从桌面直达（PWA）

使用中有疑问：菜单 `Plugins ▸ LAN ▸ Usage` 查看内嵌使用说明。
不需要终端运行 `node`，不需要理解 localhost / port / WebSocket。
有新版本时 Sketch 会自动提示更新（Release 托管于 GitHub Releases，appcast 分发）。

## 从源码安装（开发者）

Release 包自带内嵌 server（含依赖），最终用户无需本节。若直接 clone 本仓库：

```bash
git clone <repo-url> && cd lan
LAN_REPO=owner/repo ./scripts/package.sh   # 生成 dist/LAN-v0.5.0.zip + appcast.xml
```

解压后双击 `LAN.sketchplugin` 安装（内嵌 Node 运行时 + server + node_modules，
`LAN_REPO` 用于写入自动更新源，本地测试可省略）。开发调试也可将
`plugin/src/sketch-lan-mirror.sketchplugin` 软链到 Sketch Plugins 目录
（插件自动发现仓库内 `server/` 与系统 node，前提：`cd server && npm install`）。

## 工作方式

```
Sketch 插件（选中 Artboard）
   │  export PNG → SHA-256（无变化不推送）
   │  事件加速（编辑后 ~100-400ms）+ 1s 兜底轮询
   ↓ POST /frame
Node LAN Server（Start LAN 自动启动，端口 9777 起）
   ↓ WebSocket
iPhone Safari / PWA 实时刷新
```

- **内容未变化不重复推送**：每次检查计算 PNG SHA-256，与最近一次成功 POST 的帧一致则跳过（静止画板只有首帧走网络，ADR-017）
- **事件驱动加速**：编辑触发 Sketch Action → 80ms 合并窗口 → 立即检查；事件失效时 1s 轮询兜底（ADR-018）
- **Server 生命周期**：`Start LAN` 自动启动/复用（`~/.sketch-lan-mirror/runtime.json` 记录 PID/端口，只精确停止自己启动的进程，ADR-019）
- 手机端：断线重连、pinch zoom、双击沉浸模式、跨 Page/画板切换、删除画板保持最后一帧（M3-C 真机验收）

## 兼容性

Tested with:

- Sketch 2025.3.4
- macOS
- iPhone Safari / iOS PWA

不声称支持其他 Sketch 版本。

## 安全

LAN 是**本地网络工具**，无登录/鉴权/云端。**同一局域网内的任何人都可能访问 Viewer。** 在不可信网络（公共 Wi-Fi）使用请自行注意。

## 菜单

```
Plugins ▸ LAN
├── Send Current Frame   # 单帧发送（调试用）
├── Start LAN            # 启动 Server + Mirror
├── Stop LAN             # 停止 Mirror + Server
└── Open LAN Viewer      # 打开扫码入口页（未运行时提示 Start LAN first）
```

手动运行 server（可选）：`cd server && node index.js`——启动时终端直接显示 QR。

## 目录结构

```
brand/                 Logo / 图标（窗台 mark，docs/BRAND.md）
docs/ARCHITECTURE.md   总体技术方案（M0）
docs/DECISIONS.md      实测决策记录（必读，含 API 真实行为与坑）
docs/BRAND.md          品牌与 Logo 设计记录
docs/RELEASE.md        发布流程
server/                Node 服务（原生 http + ws + qrcode-generator）
plugin/src/*.sketchplugin  Sketch 插件（手写 bundle，零构建链）
scripts/package.sh     Release 打包（维护者用）
```

## 已知限制（按设计）

- 每次检查仍全量导出（渲染缓存刷新 + 内容检测依赖最新导出），M4-A 优化的是
  无变化帧的 POST 次数，M4-B 优化的是变化帧的响应延迟（ADR-017/018）
- 同步 POST 在主线程执行（loopback 实测 1–5ms，详见 DECISIONS ADR-004）
- 中文画板名经 header 百分号编码传输（ADR-005）
- 仅支持 `type === 'Artboard'` 的顶层容器（2025.1+ Frames/Graphics 中的 legacy 标记类型）
