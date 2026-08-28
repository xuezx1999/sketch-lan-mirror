# Changelog

## v0.5.1 — 览LAN Brand & Experience

### Changed

- 品牌统一为「览LAN」：插件名称/菜单标题/发布包 bundle 目录（`览LAN.sketchplugin`）、QR 扫码页、预览网页标题、PWA name/short_name
- 插件元数据：author 改为 LiminalDrift，新增中文描述（Sketch 画板实时镜像到手机端）
- 菜单精简为三项并改中英双语：开启预览 Start LAN / 停止预览 Stop LAN / 扫码预览 Open LAN Viewer（移除 Send Current Frame 与 Usage 入口）
- QR 扫码页文案改为中文，去除 iPhone 字样（安卓同样适用）

### Added

- 插件 icon（128×128 窗台 mark，`Contents/Resources/icon.png` + manifest `icon` 字段，Sketch 插件管理页显示）
- PWA 安装提示：手机浏览器首次访问弹出「添加到主屏幕」横幅（standalone / 桌面端 / 已关闭则不显示，localStorage 记忆；iOS/Android 分语文案）

### Fixed

- Immersive 模式下切换 Artboard 不再自动退回 Normal（由用户双击显式退出）；切换时重置缩放并回到图片顶端

### Compatibility

- Sketch 2025.3.4
- macOS（Apple Silicon / Intel）
- iPhone / Android Safari 及主流浏览器

---

## v0.5.0 — M4-D Single-file Distribution

### Added

- Bundled Node runtime（Release 包内嵌 darwin arm64 + x64 双架构 node 二进制，用户机器无需安装 Node.js）
- Gatekeeper/quarantine 处理（内嵌 node 首次使用时复制到 `~/.sketch-lan-mirror/` 并剥除 com.apple.quarantine 后 exec）
- Usage 菜单命令（插件内查看内嵌 README 使用说明）
- Auto-update via appcast（manifest `appcast` 字段 + `scripts/package.sh` 生成 `dist/appcast.xml`，配合 GitHub Releases 分发；`LAN_REPO=owner/repo` 打包时写入更新源）

### Changed

- Release zip 只含 `LAN.sketchplugin`（解压即插件，双击即装；不再套版本文件夹和散落 README，README 移入插件 Resources）
- Node 发现顺序：内嵌二进制优先 → 系统 PATH / 常见位置 / nvm（开发软链模式仍用系统 node）

### Compatibility

- Sketch 2025.3.4
- macOS（Apple Silicon / Intel）
- iPhone Safari

---

## v0.4.0 — M4-C Productized MVP

### Added

- LAN product branding（用户可见名称统一为 LAN，技术名 Sketch LAN Mirror 保留于仓库/代码/ADR）
- Window-sill inspired logo（负形窗台 mark；设计记录见 docs/BRAND.md）
- Automatic local server startup（Start LAN 自动启动/复用 Node server，ADR-019）
- LAN URL discovery（networkInterfaces 动态获取 + 网段排序，多网卡多地址，ADR-020）
- QR code access（终端 QR + `/qr` 扫码页，qrcode-generator 轻依赖）
- Open LAN Viewer 菜单命令（未运行时提示 Start LAN first）
- PWA branding（manifest name/short_name/icons 全部使用窗台 mark）
- Release packaging（`scripts/package.sh` 产出双击即装、内嵌 server 的 zip）

### Included (previously unreleased)

- M4-A Frame Change Detection：PNG SHA-256 相同且 artboard 身份一致则跳过 POST（ADR-017）
- M4-B Event-driven Mirror：事件加速（80ms debounce）+ 1s 轮询兜底（ADR-018）

### Compatibility

- Sketch 2025.3.4
- macOS
- iPhone Safari

---

## v0.3.2 — M3-C Mobile Viewer

- 手机端 Viewer 架构重写：fit-width、pinch zoom、双击沉浸模式、断线重连
- PWA + iOS standalone 视口/safe-area 两态布局方案（真机验收通过）

## v0.2.0 — M2 LAN Server

- 原生 Node HTTP + WebSocket 服务、端口占用自动递增、静态 Viewer 分发

## v0.1.0 — M1 Mirror 链路

- Sketch 插件导出 PNG → POST /frame → 手机 Safari 实时预览（MVP 链路打通）
