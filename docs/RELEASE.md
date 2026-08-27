# LAN — Release 流程（维护者用）

> 状态：本地 repository，尚未创建 GitHub remote。**不自动 push、不自动创建 Release。**

## 发布物形态

`dist/LAN-v0.5.0.zip`，**内含且仅含** `LAN.sketchplugin`（解压即插件，双击即正式安装）：

```
LAN.sketchplugin
└── Contents/
    ├── Sketch/              # script.cocoascript + manifest.json
    └── Resources/
        ├── server/          # 内嵌 Node server（含 node_modules）
        ├── node-arm64       # 内嵌 Node 运行时（Apple Silicon）
        ├── node-x64         # 内嵌 Node 运行时（Intel / Rosetta）
        └── README.md        # 使用说明（插件菜单 Usage 打开）
```

用户只需：解压 → 双击 `LAN.sketchplugin` → Sketch 菜单 `Plugins ▸ LAN ▸ Start LAN`。
**无需安装 Node.js**、无需 clone 仓库、无需 npm install（M4-D）。

`dist/appcast.xml`（设置了 `LAN_REPO` 时生成）：Sketch 自动更新清单，
与 zip 一起上传到 GitHub Release；已安装用户会收到新版本提示。

## 打包

```bash
./scripts/package.sh                              # 本地测试（不含自动更新源）
LAN_REPO=owner/repo ./scripts/package.sh          # 正式发布（生成 appcast.xml + 写入更新源）
```

脚本行为：

1. 读取 `plugin/src/.../manifest.json` 的 `version` 作为版本号；
2. 拷贝插件骨架到 `dist/LAN-v<version>/LAN.sketchplugin`；
3. 将 `server/` 内嵌到 `Contents/Resources/server`，并在其中
   `npm install --omit=dev --omit=optional`（ws 的 bufferutil/utf-8-validate
   均为 optional，omit 后 node_modules 极小；qrcode-generator 零依赖）；
4. 下载 Node `darwin-arm64` + `darwin-x64` 官方二进制（缓存于 `dist/.cache/`），
   内嵌为 `Resources/node-arm64` / `node-x64`；
5. `README.md` 内嵌为 `Resources/README.md`（菜单 Usage 打开）；
6. `LAN_REPO` 未设置 → 从 dist 副本的 manifest 移除 appcast 字段（避免占位 URL 404）；
   已设置 → 写入 `https://github.com/<repo>/releases/latest/download/appcast.xml` 并生成 `dist/appcast.xml`；
7. zip 只打包 `LAN.sketchplugin`（`dist/LAN-v<version>.zip`，排除 .DS_Store）。

插件运行时查找顺序：

- server：`Contents/Resources/server`（Release 安装）→ 开发软链安装时回退仓库 `server/`
  （见 script.cocoascript `findServerDir`）
- node：`Contents/Resources/node-<arch>`（先复制到 `~/.sketch-lan-mirror/` 并剥除
  com.apple.quarantine 后 exec，规避 Gatekeeper 拦截）→ 系统 PATH / 常见位置 / nvm
  （见 `findNodeExecutable` / `stageBundledNode`）

## 发布前检查清单

- [ ] `git status` / `git diff` 复查：无用户名意外提交、无绝对路径、无本机 IP
      （如开发机的局域网地址）、无 token / credential / debug log
- [ ] `dist/`、`node_modules/`、`~/.sketch-lan-mirror/` 不进入 git（.gitignore）
- [ ] `node -c`（`node --check`）通过 server/index.js
- [ ] manifest `version` bump（`bundleVersion` 同步 +1），CHANGELOG 补条目
- [ ] `LAN_REPO=owner/repo ./scripts/package.sh` 重新打包
- [ ] 按 README Quick Start 在干净环境走通全链路（重点：**未安装 Node.js 的机器**）

## Server / Node 分发决策摘要

- 方案 B（Release 包内嵌 server + node_modules）：目标用户是设计师，双击安装即用是
  M4-C 核心验收路径；依赖仅 ws + qrcode-generator，体积代价 <1MB（ADR-019）
- 方案 C（内嵌 Node 双架构二进制，M4-D）：消除"用户需自装 Node.js"这一最后外部依赖；
  代价为包体积 +~80MB。quarantine 处理：复制到运行时目录 + `xattr -d` 剥除

## GitHub Release（待指令）

收到明确指令后：

```bash
# 1. 确认远端与分支
git remote -v

# 2. 打 tag
git tag -a v0.5.0 -m "LAN v0.5.0 — single-file distribution"

# 3. push（需要用户明确授权）
git push origin main --tags

# 4. GitHub Release 页面：
#    - 标题：LAN v0.5.0
#    - 描述：引用 CHANGELOG.md v0.5.0 段落
#    - 附件：dist/LAN-v0.5.0.zip 和 dist/appcast.xml
#      （appcast.xml 必须上传；manifest 的更新源指向
#       releases/latest/download/appcast.xml，GitHub 会解析到最新 Release 的附件）
```
