# Release Guide

> 发版前先过一遍 CHANGELOG.md 对应版本的条目，确认无遗漏。

## 固定流程

```bash
# 1. bump 版本
#    plugin/src/sketch-lan-mirror.sketchplugin/Contents/Sketch/manifest.json 的 "version"
#    以及 Info.plist 的 CFBundleShortVersionString（保持一致）

# 2. 更新 CHANGELOG.md（新版本条目置顶）

# 3. 打 tag 并推送
git tag v<X.Y.Z> && git push origin main --tags

# 4. 打包（必须带 LAN_REPO，会写入真实 appcast 更新源并生成 dist/appcast.xml）
LAN_REPO=xuezx1999/lan ./scripts/package.sh

# 5. 创建 Release 并上传 zip + appcast
GH_CONFIG_DIR=/tmp/gh-config /tmp/gh_2.76.2_macOS_arm64/bin/gh release create v<X.Y.Z> \
  dist/LAN-v<X.Y.Z>.zip dist/appcast.xml \
  --repo xuezx1999/lan \
  --title "LAN v<X.Y.Z> — <一句话主题>" \
  --notes "<changelog 摘要，markdown>"

# 6. 验证
#    - Release 页面两个附件齐全、非 draft
#    - curl -sL .../releases/download/v<X.Y.Z>/appcast.xml 的 enclosure 指向本次 zip
#    - 老版本插件 Sketch ▸ Manage Plugins ▸ Check for Updates 能看到新版本
```

## gh 登录说明

- 沙箱内 gh 的登录配置在 `/tmp/gh-config`，**系统重启后失效**，需重新登录：

```bash
export GH_CONFIG_DIR=/tmp/gh-config && mkdir -p $GH_CONFIG_DIR
/tmp/gh_2.76.2_macOS_arm64/bin/gh auth login --hostname github.com --git-protocol https --skip-ssh-key
# 浏览器打开 https://github.com/login/device 输入一次性代码完成授权
```

- 一劳永逸：本机 Terminal 里 `brew install gh && gh auth login`，之后第 5 步直接用 `gh`（无需 GH_CONFIG_DIR）。

## 注意事项

- 上传必须走 gh CLI（网页版 Release 上传单文件限 25MB，发布包 ~72MB）。
- zip 内含通用 node 二进制（arm64 + x64 lipo 合成），用户无需安装 Node.js。
- 首次发版后若修改 appcast 逻辑，记得老用户靠 manifest `appcast` 字段拉 `releases/latest/download/appcast.xml`——保持该 URL 命名不变。
