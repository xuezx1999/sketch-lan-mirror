#!/bin/bash
# LAN — Release 打包脚本（维护者用；最终用户不需要运行本脚本）
# 产出：dist/LAN-v<version>.zip —— 内含自带 Node runtime + server 的 LAN.sketchplugin
#       解压 → 双击 LAN.sketchplugin → 正式安装，用户机器无需安装 Node.js
#       dist/appcast.xml —— Sketch 自动更新清单（需 LAN_REPO，见 docs/RELEASE.md）
# 用法：./scripts/package.sh
#       LAN_REPO=owner/repo ./scripts/package.sh   # 生成带真实更新源的包
set -euo pipefail
cd "$(dirname "$0")/.."

# 内嵌 Node 运行时版本（darwin arm64 + x64 双架构；升级只改这里）
NODE_VERSION="22.23.2"

MANIFEST="plugin/src/sketch-lan-mirror.sketchplugin/Contents/Sketch/manifest.json"
VERSION=$(python3 -c "import json;print(json.load(open('$MANIFEST'))['version'])")
DIST="dist/LAN-v$VERSION"
CACHE="dist/.cache"
rm -rf "$DIST"
mkdir -p "$DIST" "$CACHE"

PLUGIN="$DIST/LAN.sketchplugin"
RES="$PLUGIN/Contents/Resources"

# 1) 插件骨架 → dist/LAN.sketchplugin（Sketch 双击安装的就是这个目录）
cp -R plugin/src/sketch-lan-mirror.sketchplugin "$PLUGIN"

# 2) server 内嵌到 Contents/Resources/server（插件运行时优先从这里找 server，
#    开发软链模式自动回退到仓库 server/——见 script.cocoascript findServerDir）
mkdir -p "$RES"
cp -R server "$RES/server"
rm -rf "$RES/server/node_modules"
rm -f "$RES/server/package-lock.json"
(
  cd "$RES/server"
  # ws 零必需依赖（bufferutil/utf-8-validate 均为 optional），omit 后 node_modules 极小
  npm install --omit=dev --omit=optional --no-audit --no-fund --loglevel=error
)

# 3) 内嵌 Node 通用二进制（arm64 + x64 lipo 合成）：用户机器无需安装 Node.js。
#    必须是单个 fat 二进制——Sketch 安装时会扫描包内 Mach-O，若存在与本机
#    架构不匹配的原生二进制会弹 "CPU architecture 不兼容"（ImageOptim #15 同源问题）。
#    运行时插件复制到 ~/.sketch-lan-mirror/ 去 quarantine 后 exec。
for arch in arm64 x64; do
  TARBALL="$CACHE/node-v$NODE_VERSION-darwin-$arch.tar.gz"
  if [ ! -f "$TARBALL" ]; then
    echo "下载 Node v$NODE_VERSION darwin-$arch …"
    curl -fL --retry 3 -o "$TARBALL" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$arch.tar.gz"
  fi
  tar -xzf "$TARBALL" -C "$CACHE" "node-v$NODE_VERSION-darwin-$arch/bin/node"
done
lipo -create \
  "$CACHE/node-v$NODE_VERSION-darwin-arm64/bin/node" \
  "$CACHE/node-v$NODE_VERSION-darwin-x64/bin/node" \
  -output "$RES/node"
rm -rf "$CACHE/node-v$NODE_VERSION-darwin-arm64" "$CACHE/node-v$NODE_VERSION-darwin-x64"

# 4) 使用说明内嵌（插件菜单 Plugins ▸ LAN ▸ Usage 打开）
cp README.md "$RES/README.md"

# 5) appcast 更新源：LAN_REPO 未设置时从 dist 副本移除（避免占位 URL 404），并跳过 appcast 生成
DIST_MANIFEST="$PLUGIN/Contents/Sketch/manifest.json"
if [ -n "${LAN_REPO:-}" ]; then
  python3 - "$DIST_MANIFEST" "https://github.com/$LAN_REPO/releases/latest/download/appcast.xml" <<'PY'
import json, sys
p, url = sys.argv[1], sys.argv[2]
m = json.load(open(p))
m['appcast'] = url
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
PY
else
  python3 - "$DIST_MANIFEST" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m.pop('appcast', None)
json.dump(m, open(p, 'w'), ensure_ascii=False, indent=2)
PY
  echo "提示：未设置 LAN_REPO，本包不含自动更新源（正式发布时用 LAN_REPO=owner/repo 重新打包）"
fi

# 6) zip：只含 LAN.sketchplugin（解压即插件，双击即装；不再套版本文件夹和散落 README）
(
  cd "$DIST"
  zip -rq "LAN-v$VERSION.zip" LAN.sketchplugin -x '*.DS_Store'
)
mv "$DIST/LAN-v$VERSION.zip" "dist/LAN-v$VERSION.zip"

# 7) appcast.xml（Sketch 插件更新清单，与 zip 一起上传到 GitHub Release）
if [ -n "${LAN_REPO:-}" ]; then
  SIZE=$(stat -f%z "dist/LAN-v$VERSION.zip")
  PUBDATE=$(date -u '+%a, %d %b %Y %H:%M:%S +0000')
  cat > "dist/appcast.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>LAN</title>
    <link>https://github.com/$LAN_REPO/releases/latest/download/appcast.xml</link>
    <description>LAN — Sketch 画板实时镜像到 iPhone</description>
    <item>
      <title>Version $VERSION</title>
      <pubDate>$PUBDATE</pubDate>
      <enclosure url="https://github.com/$LAN_REPO/releases/download/v$VERSION/LAN-v$VERSION.zip" sparkle:version="$VERSION" length="$SIZE" type="application/zip"/>
    </item>
  </channel>
</rss>
XML
fi

echo "OK: dist/LAN-v$VERSION.zip"
echo "    安装方式：解压 → 双击 LAN.sketchplugin → Sketch 菜单 Plugins ▸ LAN ▸ Start LAN"
if [ -n "${LAN_REPO:-}" ]; then
  echo "    更新源： dist/appcast.xml（与 zip 一起上传到 GitHub Release v${VERSION}）"
fi
