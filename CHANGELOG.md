# Changelog

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
