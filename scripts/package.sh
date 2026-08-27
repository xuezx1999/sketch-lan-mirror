#!/bin/bash
# LAN — Release 打包脚本（维护者用；最终用户不需要运行本脚本）
# 产出：dist/LAN-v<version>.zip，内含自带 server 的 LAN.sketchplugin（双击即装）
# 用法：./scripts/package.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(python3 -c "import json;print(json.load(open('plugin/src/sketch-lan-mirror.sketchplugin/Contents/Sketch/manifest.json'))['version'])")
DIST="dist/LAN-v$VERSION"
rm -rf "$DIST" "dist/LAN-v$VERSION.zip"
mkdir -p "$DIST"

# 1) 插件骨架 → dist/LAN.sketchplugin（Sketch 双击安装的就是这个目录）
cp -R plugin/src/sketch-lan-mirror.sketchplugin "$DIST/LAN.sketchplugin"

# 2) server 内嵌到 Contents/Resources/server（插件运行时优先从这里找 server，
#    开发软链模式自动回退到仓库 server/——见 script.cocoascript findServerDir）
mkdir -p "$DIST/LAN.sketchplugin/Contents/Resources"
cp -R server "$DIST/LAN.sketchplugin/Contents/Resources/server"
rm -rf "$DIST/LAN.sketchplugin/Contents/Resources/server/node_modules"
rm -f "$DIST/LAN.sketchplugin/Contents/Resources/server/package-lock.json"
(
  cd "$DIST/LAN.sketchplugin/Contents/Resources/server"
  # ws 零必需依赖（bufferutil/utf-8-validate 均为 optional），omit 后 node_modules 极小
  npm install --omit=dev --omit=optional --no-audit --no-fund --loglevel=error
)

# 3) 面向最终用户的说明（避免用户误以为需要 clone 仓库）
cp README.md "$DIST/README.md"

# 4) zip（解压后得到 LAN-v<version>/LAN.sketchplugin，双击安装）
(
  cd dist
  zip -rq "LAN-v$VERSION.zip" "LAN-v$VERSION" -x '*.DS_Store'
)

echo "OK: dist/LAN-v$VERSION.zip"
echo "    安装方式：解压 → 双击 LAN.sketchplugin → Sketch 菜单 Plugins ▸ LAN ▸ Start LAN"
