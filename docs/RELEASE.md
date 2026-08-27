# LAN — Release 流程（维护者用）

> 状态：本地 repository，尚未创建 GitHub remote。**不自动 push、不自动创建 Release。**

## 发布物形态

`dist/LAN-v0.4.0.zip`，解压后得到：

```
LAN-v0.4.0/
├── LAN.sketchplugin        # 双击安装（Sketch 自动拷入 Plugins 目录）
│   └── Contents/
│       ├── Sketch/          # script.cocoascript + manifest.json
│       └── Resources/server/  # 内嵌 Node server（含 node_modules）
└── README.md                # 面向最终用户的安装说明
```

用户只需：Mac 装有 Node.js → 解压 → 双击 `LAN.sketchplugin` → Sketch 菜单
`Plugins ▸ LAN ▸ Start LAN`。无需 clone 仓库、无需 npm install。

## 打包

```bash
./scripts/package.sh
```

脚本行为：

1. 读取 `plugin/src/.../manifest.json` 的 `version` 作为版本号；
2. 拷贝插件骨架到 `dist/LAN-v<version>/LAN.sketchplugin`；
3. 将 `server/` 内嵌到 `Contents/Resources/server`，并在其中
   `npm install --omit=dev --omit=optional`（ws 的 bufferutil/utf-8-validate
   均为 optional，omit 后 node_modules 极小；qrcode-generator 零依赖）；
4. 打包为 `dist/LAN-v<version>.zip`（排除 .DS_Store）。

插件运行时的 server 查找顺序：`Contents/Resources/server`（Release 安装）→
开发软链安装时自动回退到仓库 `server/`（见 script.cocoascript `findServerDir`）。

## 发布前检查清单

- [ ] `git status` / `git diff` 复查：无用户名意外提交、无绝对路径、无本机 IP
      （如开发机的局域网地址）、无 token / credential / debug log
- [ ] `dist/`、`node_modules/`、`~/.sketch-lan-mirror/` 不进入 git（.gitignore）
- [ ] `node -c`（`node --check`）通过 server/index.js
- [ ] `./scripts/package.sh` 重新打包（版本号与 manifest 一致）
- [ ] 按 README Quick Start 在干净环境走通全链路

## Server 分发决策摘要

方案 B（Release 包内嵌 server + node_modules），理由：目标用户是设计师，
双击安装即用是 M4-C 核心验收路径；依赖仅 ws + qrcode-generator，体积代价
<1MB。完整分析见 docs/DECISIONS.md ADR-019。

## GitHub Release（待指令）

收到明确指令后：

```bash
# 1. 确认远端与分支
git remote -v

# 2. 打 tag
git tag -a v0.4.0 -m "LAN v0.4.0 — Productized MVP"

# 3. push（需要用户明确授权）
git push origin main --tags

# 4. GitHub Release 页面：
#    - 标题：LAN v0.4.0
#    - 描述：引用 CHANGELOG.md v0.4.0 段落
#    - 附件：dist/LAN-v0.4.0.zip
```
